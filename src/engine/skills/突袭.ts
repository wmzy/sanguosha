// 突袭(张辽·阶段替换技):摸牌阶段,你可以放弃摸牌,
//   改为获得最多两名其他角色的各一张手牌(获得的牌随机,不展示)。
//
// 模式:摸牌阶段开始时(阶段开始 before hook)询问是否发动;
//   发动 → 选 1~2 名有手牌的其他角色 → 各获得其一张随机手牌 → 跳过默认摸牌;
//   不发动 / 无有效目标 → 走默认摸牌(摸2张)。
//
// 跳过默认摸牌的手法同兵粮寸断:applyAtom(阶段结束, 摸牌) 把阶段推进到出牌,
//   再 return {kind:'cancel'} 取消本次 阶段开始(摸牌),使 回合管理 的 after hook
//   (自动摸2张)不再执行。
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameView,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';

const TRIGGER_RT = '突袭/trigger';
const SELECT_RT = '突袭/select';
const TRIGGERED_KEY = '突袭/triggered';
const TARGETS_KEY = '突袭/targets';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '突袭',
    description: '摸牌阶段,可放弃摸牌,改为获得最多两名其他角色各一张手牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 trigger(confirm) 与 select(choosePlayer) 两类询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== TRIGGER_RT && rt !== SELECT_RT) return '当前不是突袭回应';
      return null;
    },
    async (s, params) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === TRIGGER_RT) {
        s.localVars[TRIGGERED_KEY] = params.choice === true;
      } else if (rt === SELECT_RT) {
        // 兼容 targets(数组)与 target(单数)
        const targets = (params.targets as number[] | undefined) ??
          (typeof params.target === 'number' ? [params.target] : undefined);
        s.localVars[TARGETS_KEY] = targets ?? [];
      }
    },
  );

  // 阶段开始(摸牌) before:询问是否突袭,发动则偷牌并跳过默认摸牌
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '摸牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 发动条件:存在其他有手牌的存活角色
      const hasValidTarget = ctx.state.players.some(
        (p, i) => i !== ownerId && p.alive && p.hand.length > 0,
      );
      if (!hasValidTarget) return; // 无目标 → 默认摸牌

      // 询问是否发动突袭
      delete ctx.state.localVars[TRIGGERED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动突袭?(放弃摸牌,获得至多两名角色各一张手牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[TRIGGERED_KEY] !== true) return; // 不发动 → 默认摸牌

      // 选择 1~2 名有手牌的其他角色
      delete ctx.state.localVars[TARGETS_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: SELECT_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '突袭:选择至多两名角色(各获得一张手牌)',
          min: 1,
          max: 2,
          filter: (view: GameView, target: number) =>
            target !== ownerId &&
            view.players[target]?.alive === true &&
            (view.players[target]?.handCount ?? 0) > 0,
        },
        timeout: 15,
      });

      const rawTargets = ctx.state.localVars[TARGETS_KEY] as number[] | undefined;
      const targets = Array.isArray(rawTargets)
        ? rawTargets.filter(
            (t) =>
              t !== ownerId &&
              ctx.state.players[t]?.alive === true &&
              ctx.state.players[t].hand.length > 0,
          )
        : [];

      // 未选到有效目标 → 回退默认摸牌(不 cancel)
      if (targets.length === 0) return;

      // 各获得一张随机手牌
      for (const target of targets) {
        const tp = ctx.state.players[target];
        if (!tp || !tp.alive || tp.hand.length === 0) continue;
        const idx = Math.floor(Math.random() * tp.hand.length);
        const cardId = tp.hand[idx];
        await applyAtom(ctx.state, { type: '获得', player: ownerId, cardId, from: target });
      }

      // 跳过默认摸牌:推进到出牌阶段,并 cancel 本次摸牌阶段开始
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '摸牌' });
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '突袭',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动突袭?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}
