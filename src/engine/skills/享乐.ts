// 享乐(刘禅·锁定技):当其他角色使用【杀】指定你为目标时,需额外弃置一张基本牌,
//   否则该【杀】对你无效。
//
// 分析(步骤1):
//   类型:锁定技 | 时机:杀的"使用结算开始时:检测有效性"(与仁王盾同时机)
//   触发条件:target=刘禅 且 source≠刘禅 且 当前结算牌是 杀
//   原子操作分解:
//     1. before-hook 在 检测有效性:
//        - 若 source 无基本牌 → cancel(杀对刘禅无效,等同于"无法支付代价")
//        - 若 source 有基本牌 → 请求回应(requestType='享乐/discard',target=source)
//          让 source 选一张基本牌弃置;弃了 → pass(杀有效),没弃/超时 → cancel(杀无效)
//     2. 弃置选中的基本牌(弃置 atom)
//   钩子:registerBeforeHook('检测有效性')
//   契约:读 localVars['享乐/discardCard'];无写 vars(锁定技,无限次)
//   基本牌:type==='基本牌'(杀/闪/桃)
//   说明:与仁王盾同 atom(检测有效性)天然互斥——cancel 后后续 hook 与 杀结算跳过。
//        source 是其他玩家,故 respond 需为所有玩家注册(参考驱虎)。
import type { AtomBeforeContext, FrontendAPI, GameState, HookResult, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';

/** 是否基本牌(杀/闪/桃) */
function isBasicCard(state: GameState, cardId: string): boolean {
  return state.cardMap[cardId]?.type === '基本牌';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '享乐',
    description: '锁定技:其他角色用杀指定你为目标时,需额外弃一张基本牌,否则杀对你无效',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── respond action:为所有玩家注册(source 可能是任意其他玩家) ───
  // validate 严格检查 pending requestType='享乐/discard',非享乐 pending 一律拒绝(无副作用)。
  for (const p of state.players) {
    const pid = p.index;
    registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        if (slot.atom.type !== '请求回应') return '当前不需要回应';
        const reqType = (slot.atom as { requestType?: string }).requestType;
        if (reqType !== '享乐/discard') return '当前不是享乐回应';
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张基本牌';
        if (!st.players[pid].hand.includes(cardId)) return '牌不在手牌中';
        if (!isBasicCard(st, cardId)) return '只能弃置基本牌(杀/闪/桃)';
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        st.localVars['享乐/discardCard'] = params.cardId as string;
      },
    );
  }

  // ─── before-hook:检测有效性(杀指定刘禅为目标时) ───
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '检测有效性',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { target?: number; source?: number; cardId?: string };
      if (atom.target !== ownerId) return;
      const source = atom.source;
      if (source === undefined || source === ownerId) return; // 仅其他角色
      const killCardId = atom.cardId;
      if (!killCardId) return;
      if (ctx.state.cardMap[killCardId]?.name !== '杀') return;

      const sourcePlayer = ctx.state.players[source];
      if (!sourcePlayer?.alive) return;

      // source 无基本牌 → 无法支付代价 → 杀无效
      const hasBasic = sourcePlayer.hand.some((id) => isBasicCard(ctx.state, id));
      if (!hasBasic) {
        return { kind: 'cancel' };
      }

      // 请求 source 弃一张基本牌
      delete ctx.state.localVars['享乐/discardCard'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: '享乐/discard',
        target: source,
        prompt: {
          type: 'useCard',
          title: `享乐:弃置一张基本牌,否则杀对 ${ctx.state.players[ownerId].name} 无效`,
          cardFilter: { filter: (c) => c.type === '基本牌', min: 1, max: 1 },
        },
        timeout: 20,
      });

      const discardCardId = ctx.state.localVars['享乐/discardCard'] as string | undefined;
      delete ctx.state.localVars['享乐/discardCard'];

      if (discardCardId && sourcePlayer.hand.includes(discardCardId)) {
        // 弃了基本牌 → 杀有效(pass)
        await applyAtom(ctx.state, { type: '弃置', player: source, cardIds: [discardCardId] });
        return;
      }
      // 没弃/超时 → 杀对刘禅无效
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '享乐',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '享乐:弃置一张基本牌',
      cardFilter: { filter: (c) => c.type === '基本牌', min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount };
