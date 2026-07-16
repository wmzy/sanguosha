// 界武圣(界关羽·转化技):将一张红色牌(手牌或装备区)当【杀】使用或打出。
//
// 模型(组合 action):前端两步 UI(点武圣给红牌加"杀"显示 → 点出杀选目标),
// 提交时一个 ClientMessage:preceding=[武圣.transform] + 主 action=杀.use。
// 后端 dispatch 先执行 武圣.transform(创建影子杀),再 杀.use validate 看到"杀"通过。
// 杀技能零感知武圣——它看到的永远是 cardMap 里的一张"杀"。
//
// 界限突破:红色牌包括装备区(原版仅手牌)。装备区红色牌转化时先卸下到手牌再「当作」。
import type { Card, EquipSlot, GameView, GameState, Json, Skill, FrontendAPI } from '../types';
import { registerAction, hasBlockingPending } from '../skill';
import { applyAtom } from '../create-engine';
import { viewCanAttack } from '../viewDistance';
import { defaultPlayActive, viewCanSlash } from '../action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界武圣',
    description: '你可以将一张红色牌(手牌或装备区)当【杀】使用或打出',
  };
}

/** 影子卡 id:${原id}#武圣 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#武圣`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把红色牌(手牌或装备区)转化为影子"杀"(新建 Card 实体,shadowOf 指向原卡)。
  // 作为 preceding 在 杀.use 之前执行。杀.validate 读 cardMap[影子id] 看到"杀"。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 无 pending + 存活 + 红牌
      const myTurn = state.currentPlayerIndex === ownerId;
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      // 界关羽武圣:红色牌包括手牌和装备区
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const cardInEquip = cardIdOk && Object.values(self.equipment).some((id) => id === cardId);
      const isRed = !!card && card.color === '红';
      const ok = myTurn && free && selfAlive && (cardInHand || cardInEquip) && isRed;
      return ok ? null : '现在不能使用武圣';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      const self = state.players[ownerId];
      // 装备区的红色牌:先卸下到手牌(产生 ViewEvent,清除武器距离 vars),
      // 再走「当作」(当作要求牌在手牌)。镜像奇袭.ts 的装备转化模式。
      const equipSlotEntry = Object.entries(self.equipment).find(([, id]) => id === cardId);
      if (equipSlotEntry) {
        const slot = equipSlotEntry[0] as EquipSlot;
        params['_origSlot'] = slot;
        await applyAtom(state, { type: '卸下', player: ownerId, slot });
      }
      // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '杀',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      const self = state.players[ownerId];
      const origSlot = params['_origSlot'] as EquipSlot | undefined;
      // 删除影子卡
      delete state.cardMap[sId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) {
        if (origSlot) {
          // 原是装备牌:从手牌移除影子,还原装备槽位
          self.hand.splice(idx, 1);
          self.equipment[origSlot] = cardId;
        } else {
          // 原是手牌:影子替换回原卡
          self.hand[idx] = cardId;
        }
      }
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:武圣是转化技,defineAction 声明红牌+目标。
  // 前端 UI 流程:选红牌 → 选目标 → 点武圣按钮 → 提交 preceding=[武圣.transform] + 主 action=杀.use。
  api.defineAction('transform', {
    label: '界武圣',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色牌当杀使用',
      cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 攻击范围检查(转化出的杀同样需距离):filter 仅为前端 UI 提示
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    transform: (card: Card) => ({ name: '杀', sourceCardId: card.id, fromSkill: skill.id }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      const hasRedInHand = p.hand?.some((c) => c.color === '红') ?? false;
      // 界关羽武圣:装备区红色牌也可转化
      const hasRedEquip = Object.values(p.equipment ?? {}).some((id) => {
        const card = id ? ctx.view.cardMap[id] : undefined;
        return card?.color === '红';
      });
      return (hasRedInHand || hasRedEquip) && viewCanSlash(ctx.view, ctx.perspectiveIdx);
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
