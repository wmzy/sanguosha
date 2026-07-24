// 八卦阵(防具):当你需要出闪时,可以判定,若为红色则视为出闪。
// 实现:在 询问闪 before hook 中
//   1. 先 请求回应 询问是否发动(requestType=八卦阵/confirm)
//   2. 玩家选发动 → applyAtom(判定) → 判定牌进弃牌堆,读花色
//   3. 红色 → 往处理区放入一张虚拟闪牌,再 cancel 主 询问闪 atom
//      (判定红色即视为出闪,不再询问目标出闪)。杀.execute 检测处理区有闪 →
//      走"被抵消"分支 → 武器技(贯石斧/青龙腰月刀)正常触发。
//   4. 黑色 / 玩家选不发动 / 超时 → 不干预,直接进入正常询问闪
// 杀不需要知道八卦阵——只看处理区有没有闪牌。
// cancel 询问闪不会跳过杀.execute 的后续逻辑:杀.execute 在 applyAtom(询问闪)
// 返回后自己检查处理区,与询问闪是否被 cancel 无关。武器技挂在独立的"被抵消"
// atom after(非询问闪 after),故不受询问闪 cancel 影响。
import type { Card, FrontendAPI, GameState, HookResult, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { runJudgeFlow } from '../judge-flow';
import { registerAction, registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '八卦阵',
    description: '防具技:当你需要出闪时,可以判定,若为红色则视为出闪',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // respond:被询问"是否发动八卦阵"时回应,设 localVars 标记结果
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, _params) => {
      if (state.pendingSlots.get(ownerId)?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (
        state.pendingSlots.get(ownerId)!.atom as unknown as Record<string, unknown>
      ).requestType as string;
      if (requestType !== '八卦阵/confirm') return '当前不是八卦阵确认';
      return null;
    },
    async (state, params) => {
      state.localVars['八卦阵/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx): Promise<HookResult | void> => {
      if ((ctx.atom).target !== ownerId) return;
      if (ctx.state.zones.deck.length === 0) return;

      // 询问是否发动八卦阵
      delete ctx.state.localVars['八卦阵/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: '八卦阵/confirm',
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动八卦阵?',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars['八卦阵/confirmed']) return;

      // 判定:牌堆顶→处理区→技能 after hooks 读取→afterHooks 清理(处理区→弃牌堆)
      await runJudgeFlow(ctx.state, ownerId, '八卦阵');

      // 判定完成后判定牌已进弃牌堆,读弃牌堆顶
      const discardPile = ctx.state.zones.discardPile;
      if (discardPile.length === 0) return;
      const judgeCardId = discardPile[discardPile.length - 1];
      const judgeCard = ctx.state.cardMap[judgeCardId];
      if (!judgeCard) return;

      // 红色:往处理区放虚拟闪牌(通过移动牌 atom 产生 ViewEvent,保持 processedView 同步)
      // 然后 cancel 主 询问闪 atom —— 判定红色即视为出闪,不再询问目标出闪。
      // 杀.execute 检测处理区有闪 → 走"被抵消"分支 → 武器技正常触发。
      // 武器技挂在"被抵消" atom after(非询问闪 after),不受询问闪 cancel 影响。
      if (judgeCard.suit === '♥' || judgeCard.suit === '♦') {
        const dodgeId = `八卦阵:${ownerId}:${judgeCardId}`;
        const virtualDodge: Card = {
          id: dodgeId,
          name: '闪',
          suit: judgeCard.suit,
          color: judgeCard.color,
          rank: judgeCard.rank,
          type: '基本牌',
        };
        ctx.state.cardMap[dodgeId] = virtualDodge;
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: dodgeId,
          from: { zone: '处理区' },
          to: { zone: '处理区' },
        });
        return { kind: 'cancel' };
      }
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '八卦阵',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动八卦阵？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}
