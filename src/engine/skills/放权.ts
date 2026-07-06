// 放权(刘禅·主动技):你可以跳过出牌阶段,然后在回合结束时弃置一张手牌,
// 令一名其他角色进行一个额外回合。
//
// 实现:
//   - before hook 挂在「阶段开始」(出牌):询问是否发动;发动则跳过出牌阶段 +
//     设 turn.vars['放权/active'] 标记(回合结束时消费)。
//   - after hook 挂在「回合结束」:检查 放权/active → 请求弃一张手牌。
//   - 额外回合部分:引擎当前不支持额外回合机制(需修改回合管理的座次推进逻辑,
//     涉及嵌套回合+座次恢复,风险高)。标记 TODO,仅实现跳过出牌+弃牌部分。
//
// 跳过出牌阶段手法同神速/巧变:applyAtom(阶段结束, 出牌) 推进到弃牌,
//   再 return {kind:'cancel'} 取消本次 阶段开始(出牌)。
import type {
  AtomBeforeContext,
  AtomAfterContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook, registerAfterHook } from '../skill';

const TRIGGER_RT = '放权/trigger';
const DISCARD_RT = '放权/discard';
const TRIGGERED_KEY = '放权/triggered';
const ACTIVE_KEY = '放权/active';
const DISCARD_CARD_KEY = '放权/discardCard';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '放权',
    description: '跳过出牌阶段,回合结束时弃一张手牌,令一名其他角色进行额外回合(额外回合待实现)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 trigger(confirm) 与 discard(useCard) 两类询问
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
      return '当前不是放权回应';
    },
    async (s: GameState, params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === TRIGGER_RT) {
        s.localVars[TRIGGERED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === DISCARD_RT) {
        s.localVars[DISCARD_CARD_KEY] = params.cardId as string;
      }
    },
  );

  // ── 阶段开始(出牌) before:询问是否放权(跳过出牌) ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
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
          title: '是否发动放权?(跳过出牌阶段,回合结束时弃一张手牌令其他角色额外回合)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[TRIGGERED_KEY] !== true) return; // 不发动 → 出牌阶段正常进行

      // 设标记:回合结束时消费(用 localVars 而非 turn.vars,因 回合结束 apply 会清空 turn.vars)
      ctx.state.localVars[ACTIVE_KEY] = true;

      // 跳过出牌阶段:推进到弃牌阶段,并 cancel 本次出牌阶段开始
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '出牌' });
      return { kind: 'cancel' };
    },
  );

  // ── 回合结束 after:放权标记 → 弃一张手牌 ──
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '回合结束') return;
    if (atom.player !== ownerId) return;
    if (ctx.state.localVars[ACTIVE_KEY] !== true) return;
    delete ctx.state.localVars[ACTIVE_KEY];

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (self.hand.length === 0) return; // 无手牌可弃 → 跳过

    // 请求弃一张手牌
    delete ctx.state.localVars[DISCARD_CARD_KEY];
    await applyAtom(ctx.state, {
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

    const discardCardId = ctx.state.localVars[DISCARD_CARD_KEY] as string | undefined;
    delete ctx.state.localVars[DISCARD_CARD_KEY];
    if (discardCardId && self.hand.includes(discardCardId)) {
      await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCardId] });
    }

    // TODO: 额外回合机制——令一名其他角色进行一个额外回合。
    // 引擎当前不支持额外回合(需修改回合管理的座次推进逻辑,涉及嵌套回合+座次恢复)。
    // 理想实现:在 回合结束 after hook 中,设一个 extraTurnQueue,
    // 回合管理的 回合结束 after hook 检测队列:有排队 → 启动额外回合(不走 findNextAlive),
    // 额外回合结束后恢复原座次顺序。
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '放权',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动放权?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
