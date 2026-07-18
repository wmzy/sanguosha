// 烈弓(黄忠·被动技,OL 标版官方逐字):
//   当你于出牌阶段使用【杀】指定目标后,若其手牌数不小于你的体力值
//   或不大于你的攻击范围,你可以令其不能抵消此【杀】。
//
// 发动条件(两分支均基于目标手牌数):
//   分支1: target.hand.length >= owner.health   (目标手牌数 ≥ 自己体力值)
//   分支2: target.hand.length <= owner.attackRange (目标手牌数 ≤ 自己攻击范围)
//   攻击范围取 owner.vars['距离/出杀范围'],默认 1(徒手)。
//
// 实现(与铁骑同构的禁闪横切机制):
//   1. 指定目标 after hook(source===ownerId, card 是杀):
//        若上述条件满足 → 询问"是否发动烈弓" → 若发动 → 给目标加标签 '烈弓/禁闪'。
//   2. 询问闪 before hook(source===ownerId 且 target 有 '烈弓/禁闪' 标签):
//        去标签 + cancel(跳过询问闪 → 处理区无闪 → 杀.execute 造成伤害,强制命中)。
//
// 标签生命周期:阶段1(指定目标)产出,阶段2(询问闪)消费并清除——天然按单次杀结算。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const TAG = '烈弓/禁闪';
const CONFIRM = '烈弓/confirmed';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '烈弓',
    description:
      '使用杀指定目标后,若其手牌数不小于你的体力值或不大于你的攻击范围,可令其不能抵消此杀',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:被询问"是否发动烈弓"时回应,设 localVars 标记结果
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, _params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是请求回应';
      if (atom.requestType !== '烈弓/confirm') return '当前不是烈弓确认';
      return null;
    },
    async (state, params) => {
      state.localVars[CONFIRM] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 指定目标 after:条件满足 → 询问 → 加禁闪标签 ──
  registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
    if (atom.source !== ownerId) return;
    if (atom.target === undefined) return;
    const target = atom.target;
    if (atom.cardId !== undefined) {
      const card = ctx.state.cardMap[atom.cardId];
      if (card?.name !== '杀') return;
    }
    const self = ctx.state.players[ownerId];
    const targetPlayer = ctx.state.players[target];
    if (!self?.alive || !targetPlayer?.alive) return;

    // 发动条件(官方):目标手牌数 ≥ 自己体力值,或 目标手牌数 ≤ 自己攻击范围
    const attackRange = (self.vars['距离/出杀范围'] as number) ?? 1;
    const condMet =
      targetPlayer.hand.length >= self.health || targetPlayer.hand.length <= attackRange;
    if (!condMet) return;

    // 询问是否发动烈弓("你可以令其不能出闪"——可选)
    delete ctx.state.localVars[CONFIRM];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '烈弓/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动烈弓(令目标不能出闪)?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRM]) return;

    await applyAtom(ctx.state, { type: '加标签', player: target, tag: TAG });
  });

  // ── 询问闪 before:目标有禁闪标签 → 去标签 + cancel(强制命中) ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { target?: number; source?: number };
      if (atom.source !== ownerId) return;
      const target = atom.target;
      if (target === undefined) return;
      const player = ctx.state.players[target];
      if (!player?.tags.includes(TAG)) return;
      await applyAtom(ctx.state, { type: '去标签', player: target, tag: TAG });
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '烈弓',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动烈弓？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}
