// 界酒池(界董卓·转化技,OL 界限突破官方逐字):
//   你可以将一张黑桃手牌当【酒】使用。
//   你使用【酒】无次数限制。
//   当你使用【酒】【杀】造成伤害后,本回合"崩坏"失效。
//
// 与标版区别(标版仅"黑桃手牌当酒"):
//   1. 显式声明"无次数限制"(引擎标版酒.use 已无次数限制,等同语义,此处保留以贴合官方文本)
//   2. 新增第三段效果:使用酒杀造成伤害后,本回合崩坏失效。
//      机制:after-hook on '去标记' 检测 酒/nextKillDamageBonus mark 被消耗(即酒增伤生效)
//      → 设 turn.vars['崩坏/disabled']=true,供 界崩坏 读取跳过本回合触发。
//
// 模型(组合 action,镜像标版酒池):前端选一张黑桃手牌 → 点界酒池 → 提交
// preceding=[界酒池.transform] + 主 action=酒.use。
// 后端 dispatch 先执行 界酒池.transform(创建影子酒),再 酒.use validate 看到"酒"通过。
// 酒技能零感知界酒池——它看到的永远是 cardMap 里的一张"酒"。
//
// 关键点:
//   - 黑桃 = ♠(仅黑桃,非黑色;与红颜/断粮的"黑色"语义不同)
//   - 影子卡 id:${原id}#界酒池(与标版酒池隔离,不互相干扰)
//   - "酒杀造成伤害"= 酒/nextKillDamageBonus mark 被消耗(由 酒.ts before-hook on 造成伤害 触发)
//   - turn.vars['崩坏/disabled'] 随「回合结束」atom 自动清空(语义贴合"本回合")
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, registerAfterHook, hasBlockingPending } from '../skill';
import { applyAtom } from '../create-engine';
import { defaultPlayActive } from '../action-active';

const DISABLE_BENGHUAI_VAR = '崩坏/disabled';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '酒池',
    description:
      '转化技:黑桃手牌当酒使用,无次数限制;使用酒杀造成伤害后本回合崩坏失效',
  };
}

/** 影子卡 id:${原id}#界酒池(与标版酒池隔离) */
function shadowIdOf(cardId: string): string {
  return `${cardId}#界酒池`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // transform action:把黑桃手牌转化为影子"酒"(新建 Card 实体,shadowOf 指向原卡)。
  // 作为 preceding 在 酒.use 之前执行。酒.validate 读 cardMap[影子id] 看到"酒"。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 无 pending + 存活 + 手牌 + 黑桃
      const myTurn = state.currentPlayerIndex === ownerId;
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isSpade = !!card && card.suit === '♠';
      const ok = myTurn && free && selfAlive && cardInHand && isSpade;
      return ok ? null : '现在不能使用界酒池';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '酒',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete state.cardMap[sId];
      const self = state.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );

  // ── after-hook on '去标记':酒/nextKillDamageBonus 被消耗(酒增伤生效)
  //    → 设 turn.vars['崩坏/disabled']=true,本回合崩坏失效。
  //    去标记 的发生时机:酒.ts before-hook on '造成伤害' 在增伤时调用 applyAtom(去标记)
  //    消费 mark。此 hook 据此判定"酒杀伤害已造成",贴合官方"造成伤害后"语义。
  registerAfterHook(state, skill.id, ownerId, '去标记', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '去标记') return;
    if (atom.player !== ownerId) return;
    if (atom.markId !== '酒/nextKillDamageBonus') return;
    // 酒增伤已生效 → 本回合崩坏失效
    ctx.state.turn.vars[DISABLE_BENGHUAI_VAR] = true;
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:界酒池是转化技,defineAction 声明黑桃手牌。
  // 前端 UI 流程:选黑桃手牌 → 点界酒池 → 提交 preceding=[界酒池.transform] + 主 action=酒.use。
  // 酒.use 自带 selfTarget:true(对自己使用),无需额外选目标。
  api.defineAction('transform', {
    label: '界酒池',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张黑桃手牌当酒使用(无次数限制;酒杀造成伤害后本回合崩坏失效)',
      cardFilter: { filter: (c: Card) => c.suit === '♠', min: 1, max: 1 },
    },
    transform: (card: Card) => ({ name: '酒', sourceCardId: card.id, fromSkill: skill.id }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return p.hand?.some((c) => c.suit === '♠') ?? false;
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
