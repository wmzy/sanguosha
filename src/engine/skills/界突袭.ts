// 界突袭(界张辽·摸牌阶段弹性替换技):
//   摸牌阶段,你可以少摸任意张牌并获得等量其他角色的各一张手牌。
//
// OL 官方(hero 逐字):
//   "摸牌阶段,你可以少摸任意张牌并获得等量其他角色的各一张手牌。"
//
// 与标版突袭区别:
//   - 标版:放弃摸牌(固定少摸全部,即 2 张),获得至多 2 名角色各一张手牌。
//   - 界版:弹性少摸任意张(1 至本回合摸牌数),获得等量其他角色各一张手牌,
//     且仍摸"剩余"的牌。即:选择 N 名有手牌的其他角色 → 各获得其一张随机手牌,
//     本次摸牌数 -N(少摸 N 张,以等量偷牌补足)。N=0 时等同不发动(默认摸牌)。
//   - 标版是"全或无"(放弃全部摸牌偷至多 2 张);界版是"弹性分配"(可偷 1 或 2 张,
//     偷几张就少摸几张,剩余照常摸)。
//
// 实现:before-hook 挂在「摸牌」atom(同裸衣/英姿模式,仅自己摸牌阶段的摸牌触发,
//   排除无中生有/遗计/苦肉等其他摸牌场景)。
//   发动 → 选 1~baseCount 名有手牌的其他角色 → 各获得其一张随机手牌 →
//   modify 摸牌 count 为 baseCount-N(N=baseCount 时 cancel,本次不摸牌)。
//   不发动 / 无有效目标 / 未选到有效目标 → 不 modify,默认摸牌。
//
// 内部 localVars/requestType 键名保持原前缀 '突袭/xxx'(不改为 '界突袭/xxx'):
//   界版与标版互斥不共存(同一武将只会实例化其一),键名沿用便于对照。
import type {
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
    name: '界突袭',
    description: '摸牌阶段,你可以少摸任意张牌并获得等量其他角色的各一张手牌',
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

  // 摸牌 before-hook:仅自己摸牌阶段的摸牌触发(同裸衣/英姿,排除其他摸牌场景)
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      // 仅自己回合的摸牌阶段(排除无中生有/遗计/苦肉/激将等其他摸牌)
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      if (ctx.state.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 基础摸牌数(英姿/好施等可能已 modify 为 3+,界突袭在此基础上少摸)
      const baseCount = atom.count ?? 2;
      if (baseCount <= 0) return; // 已被减到 0(理论上不会,防御性)

      // 发动条件:存在其他有手牌的存活角色
      const stealablePlayers = ctx.state.players.filter(
        (p, i) => i !== ownerId && p.alive && p.hand.length > 0,
      );
      if (stealablePlayers.length === 0) return; // 无目标 → 默认摸牌

      // 询问是否发动突袭
      delete ctx.state.localVars[TRIGGERED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动界突袭?(少摸任意张牌并获得等量其他角色的各一张手牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[TRIGGERED_KEY] !== true) return; // 不发动 → 默认摸牌

      // 选择 1~maxTargets 名有手牌的其他角色(选 N 人 = 少摸 N 张 = 偷 N 张各一张)
      const maxTargets = Math.min(baseCount, stealablePlayers.length);
      delete ctx.state.localVars[TARGETS_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: SELECT_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: `界突袭:选择 1~${maxTargets} 名角色(各获得一张手牌;少摸等量张)`,
          min: 1,
          max: maxTargets,
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

      // 未选到有效目标 → 不 modify,默认摸牌
      if (targets.length === 0) return;

      // 各获得一张随机手牌(在 modify 摸牌数之前完成偷牌)
      for (const target of targets) {
        const tp = ctx.state.players[target];
        if (!tp || !tp.alive || tp.hand.length === 0) continue;
        const idx = Math.floor(Math.random() * tp.hand.length);
        const cardId = tp.hand[idx];
        await applyAtom(ctx.state, { type: '获得', player: ownerId, cardId, from: target });
      }

      // 少摸 N 张:modify 摸牌 atom 的 count;N=baseCount 时 cancel(摸牌 atom validate 要求 count>0)
      const newCount = baseCount - targets.length;
      if (newCount <= 0) {
        return { kind: 'cancel' };
      }
      return { kind: 'modify', atom: { ...ctx.atom, count: newCount } as typeof ctx.atom };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界突袭',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动界突袭?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
