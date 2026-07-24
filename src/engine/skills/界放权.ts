// 界放权(界刘禅·主动技):你可以跳过出牌阶段,然后弃牌阶段开始时,
// 你可以弃置一张手牌并令一名角色(可为自己)进行一个额外回合。
//
// 实现:
//   - before hook 挂在「阶段开始」(出牌):询问是否发动;发动则跳过出牌阶段 +
//     设 放权/active 标记(弃牌阶段开始时消费)。
//   - before hook 挂在「阶段开始」(弃牌):放权代价 + 目标选择时机(对齐官方「弃牌阶段开始时」)。
//     若 active:请求弃一张手牌(代价) → 请求选额外回合目标 → 记 放权/extraTarget;
//     不 cancel,让正常弃牌阶段按手牌上限继续进行。
//   - before hook 挂在「回合结束」:额外回合的执行机制(目标在弃牌阶段已选定),处理两种情况——
//     情况1(刘禅回合结束 + extraTarget 已选):cancel 本回合结束
//       (阻止 回合管理 的 findNextAlive 路径,避免双重启动)→ 手动清理 per-turn 状态
//       → 亲自启动目标的额外回合(参考据守「亲自推进回合」先例)。
//     情况2(额外目标回合结束):cancel 本回合结束 → 手动清理 → 亲自启动正常下家(刘禅的正常下家)的回合,
//       恢复正常座次顺序。
//
//   额外回合机制完全在放权技能内部实现,不修改 回合管理.ts:
//   cancel 掉 回合结束 atom 后其 apply 与 after-hook(回合管理的 findNextAlive)都不执行,
//   故需手动复刻 回合结束 的 per-turn 清理(见 clearPerTurnState)。
//
// 跳过出牌阶段手法同神速/巧变:applyAtom(阶段结束, 出牌) 推进到弃牌,
//   再 return {kind:'cancel'} 取消本次 阶段开始(出牌)。
//
// 界限突破:额外回合目标可选择自己(原版仅限其他角色)。
import type {
  FrontendAPI,
  GameState,
  GameView,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { startTurn } from '../turn-flow';
import { registerAction, registerBeforeHook } from '../skill';

// requestType 前缀必须等于技能 id('界放权'):前端 resolvePendingRespond 按
// requestType 前缀解析 skillId 后提交 respond,前缀≠技能 id 则 dispatch 找不到
// respond handler(按钮不可点击)。早期从放权.ts 复制常量时误用 '放权' 前缀。
// 注:localVars key 仍用 '放权/' 前缀(内部状态,不参与前端路由,保持与测试断言一致)。
const TRIGGER_RT = '界放权/trigger';
const DISCARD_RT = '界放权/discard';
const CHOOSE_TARGET_RT = '界放权/chooseTarget';
const TRIGGERED_KEY = '放权/triggered';
const ACTIVE_KEY = '放权/active';
const DISCARD_CARD_KEY = '放权/discardCard';
const EXTRA_TARGET_KEY = '放权/extraTarget';
const ORIGINAL_NEXT_KEY = '放权/originalNext';
// 额外回合进行中标记:Case 1 启动额外回合时置 true,Case 2 恢复正常座次时清除。
// 必需:界放权可令自己进行额外回合,此时 刘禅主回合结束 与 刘禅额外回合结束 的 player 都是 ownerId,
// 须靠此标记区分(主回合结束→启动额外;额外回合结束→恢复正常下家),否则 Case 1 死循环。
const EXTRA_ACTIVE_KEY = '放权/extraActive';

/** 复刻「回合结束」atom 的 per-turn 清理(cancel 回合结束后 atom.apply 不执行,需手动清理)。
 *  清空 turn.vars、清所有玩家 duration='turn' 标记、清 /usedThisTurn|/healed|/givenCount|/givenTargets vars。
 *  marks 多数由 end action 的 清过期标记 已清(仅结束玩家),此处补全所有玩家以保持与 atom 一致。
 *  注意:不清理 state.localVars(放权内部标记 extraTarget/originalNext 须跨清理存活)。 */
function clearPerTurnState(state: GameState): void {
  state.turn.vars = {};
  for (const p of state.players) {
    p.marks = p.marks.filter((m) => m.duration !== 'turn');
    p.vars = Object.fromEntries(
      Object.entries(p.vars).filter(
        ([k]) =>
          !k.endsWith('/usedThisTurn') &&
          !k.endsWith('/healed') &&
          !k.endsWith('/givenCount') &&
          !k.endsWith('/givenTargets'),
      ),
    );
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界放权',
    description: '跳过出牌阶段,弃牌阶段开始时弃一张手牌,令一名角色(可为自己)进行一个额外回合',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 trigger(confirm)、discard(useCard)、chooseTarget(choosePlayer) 三类询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState, params: Record<string, Json>): string | null => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt === TRIGGER_RT) return null;
      if (rt === DISCARD_RT) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张手牌弃置';
        if (!s.players[ownerId].hand.includes(cardId)) return '牌不在手牌中';
        return null;
      }
      if (rt === CHOOSE_TARGET_RT) {
        const target = params.target as number | undefined;
        if (typeof target !== 'number') return '请选择一名角色';
        // 界刘禅放权可令自己进行额外回合
        if (!s.players[target]?.alive) return '目标已死亡';
        return null;
      }
      return '当前不是放权回应';
    },
    async (s: GameState, params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === TRIGGER_RT) {
        s.localVars[TRIGGERED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === DISCARD_RT) {
        s.localVars[DISCARD_CARD_KEY] = params.cardId;
      } else if (rt === CHOOSE_TARGET_RT) {
        s.localVars[EXTRA_TARGET_KEY] = params.target;
      }
    },
  );

  // ── 阶段开始(出牌) before:询问是否放权(跳过出牌) ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '出牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 询问是否发动放权
      delete ctx.state.localVars[TRIGGERED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动放权?(跳过出牌阶段,弃牌阶段开始时弃一张手牌令一名角色额外回合)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[TRIGGERED_KEY] !== true) return; // 不发动 → 出牌阶段正常进行

      // 设标记:弃牌阶段开始时消费
      ctx.state.localVars[ACTIVE_KEY] = true;

      // 跳过出牌阶段:推进到弃牌阶段,并 cancel 本次出牌阶段开始
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '出牌' });
      return { kind: 'cancel' };
    },
  );

  // ── 阶段开始(弃牌) before:放权代价(弃一张手牌)+ 选额外回合目标(对齐官方「弃牌阶段开始时」) ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '弃牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const st = ctx.state;
      if (st.localVars[ACTIVE_KEY] !== true) return; // 未发动放权跳过出牌 → 不触发
      delete st.localVars[ACTIVE_KEY]; // 消费 active 标记
      const self = st.players[ownerId];
      if (!self?.alive) return;

      // 请求弃一张手牌(放权代价):必须支付,未支付(无手牌/超时/不回应)则不发动额外回合
      if (self.hand.length === 0) return; // 无手牌无法支付代价 → 不发动,放行正常弃牌阶段
      delete st.localVars[DISCARD_CARD_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: DISCARD_RT,
        target: ownerId,
        prompt: {
          type: 'useCard',
          title: '放权:弃置一张手牌',
          cardFilter: { filter: () => true, min: 1, max: 1 },
        },
        timeout: 15,
      });
      const discardCardId = st.localVars[DISCARD_CARD_KEY] as string | undefined;
      delete st.localVars[DISCARD_CARD_KEY];
      if (!discardCardId || !self.hand.includes(discardCardId)) {
        return; // 超时/不回应 → 未支付代价,不发动额外回合,放行正常弃牌阶段
      }
      await applyAtom(st, { type: '弃置', player: ownerId, cardIds: [discardCardId] });

      // 请求选额外回合目标(界刘禅可令自己进行额外回合)
      delete st.localVars[EXTRA_TARGET_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CHOOSE_TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '放权:选择一名角色进行一个额外回合',
          min: 1,
          max: 1,
          filter: (view: GameView, target: number) => view.players[target]?.alive === true,
        },
        timeout: 15,
      });
      const extraTarget = st.localVars[EXTRA_TARGET_KEY] as number | undefined;
      if (typeof extraTarget !== 'number' || !st.players[extraTarget]?.alive) {
        // 无有效目标 → 清除标记,回合结束时不启动额外回合
        delete st.localVars[EXTRA_TARGET_KEY];
      }
      // 不 cancel:让正常弃牌阶段按手牌上限继续进行
    },
  );

  // ── 回合结束 before:放权额外回合的执行机制(目标已在弃牌阶段选定) ──
  // 比 回合管理 的 after-hook(按座次+注册序)更早(before 先于 after),cancel 后其 after-hook 不执行。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '回合结束',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '回合结束') return;
      const st = ctx.state;
      const player = atom.player;
      if (typeof player !== 'number') return;

      const extraActive = st.localVars[EXTRA_ACTIVE_KEY] === true;

      // ── 情况1:刘禅主回合结束 + 弃牌阶段已选定 extraTarget(且未在额外回合流程中)──
      if (player === ownerId && !extraActive) {
        const extraTarget = st.localVars[EXTRA_TARGET_KEY] as number | undefined;
        if (typeof extraTarget !== 'number' || !st.players[extraTarget]?.alive) {
          return; // 弃牌阶段未选定有效目标 → 放行正常回合结束
        }
        if (!st.players[ownerId]?.alive) {
          delete st.localVars[EXTRA_TARGET_KEY]; // 刘禅已死亡 → 清标记放行
          return;
        }

        // 记录正常下家(currentPlayerIndex 已被 end action 的 下一玩家 推进到正常下家)
        const originalNext = st.currentPlayerIndex;
        st.localVars[ORIGINAL_NEXT_KEY] = originalNext;
        st.localVars[EXTRA_ACTIVE_KEY] = true; // 标记额外回合进行中(防自选时 Case 1 死循环)

        // cancel 回合结束 → 手动清理 per-turn 状态(否则 apply 不执行,状态残留)
        clearPerTurnState(st);

        // 亲自启动额外目标的回合(嵌套:其 end action → 回合结束(extraTarget) → 触发情况2)
        st.currentPlayerIndex = extraTarget;
        await startTurn(st, extraTarget);

        return { kind: 'cancel' };
      }

      // ── 情况2:额外目标的回合结束(自选时 player===ownerId,靠 extraActive 区分)──
      const extraTargetStored = st.localVars[EXTRA_TARGET_KEY];
      if (extraActive && player === extraTargetStored) {
        const originalNext = st.localVars[ORIGINAL_NEXT_KEY] as number | undefined;
        delete st.localVars[EXTRA_TARGET_KEY];
        delete st.localVars[ORIGINAL_NEXT_KEY];
        delete st.localVars[EXTRA_ACTIVE_KEY];

        if (typeof originalNext !== 'number' || !st.players[originalNext]?.alive) {
          return; // 异常:无正常下家,放行
        }

        // cancel 回合结束 → 手动清理 per-turn 状态
        clearPerTurnState(st);

        // 亲自启动正常下家的回合(恢复正常座次顺序)。
        // originalNext 回合结束后,其 回合结束 before-hook 标记已清 → 放行 →
        // 回合管理 的 after-hook 经 findNextAlive 正常推进后续座次。
        st.currentPlayerIndex = originalNext;
        await startTurn(st, originalNext);

        return { kind: 'cancel' };
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '界放权',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动界放权?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
