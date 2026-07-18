// 界烈弓(界黄忠·被动技,OL 界限突破官方逐字):
//   你【杀】的攻击范围为此【杀】点数。当你使用【杀】指定目标后,你可以执行以下效果:
//     1. 若其手牌数不大于你,其不能抵消此【杀】。
//     2. 若其体力值不小于你,此【杀】伤害值 +1。
//
// 与原版烈弓(src/engine/skills/烈弓.ts)的差异:
//   - 攻击范围:原版固定武器范围;界版以「max(武器范围, 杀点数)」为出杀范围(由 杀.ts
//     validate 检测本技能持有者并放宽距离)。
//   - 禁闪条件:原版「体力或手牌不小于你」单一条件 → 禁闪;界版拆为效果1「手牌数不大于你」
//     → 不能抵消(禁闪)。
//   - 加伤:界版新增效果2「体力值不小于你」→ 此杀伤害 +1(原版无加伤)。
//
// 实现:
//   1. 攻击范围:杀.ts use.validate 检测 skills.includes('界烈弓') 后,用 max(武器范围, 杀点数)
//      作为有效范围。本技能文件不重复实现距离逻辑(权威在 distance.ts + 杀.ts)。
//   2. 指定目标 after hook(source===ownerId, card 是杀):
//        计算两条件:
//          condBlock = target.hand.length <= self.hand.length   → 效果1(禁闪)
//          condBonus = target.health    >= self.health          → 效果2(加伤)
//        若至少一条件成立 → 询问「是否发动烈弓」(单次发动,统一管理两效果)。
//        发动后按成立的条件给目标加相应标签:
//          '界烈弓/禁闪' → 询问闪 before hook 消费并 cancel。
//          '界烈弓/加伤' → 造成伤害 before hook 消费并 modify(amount+1)。
//   3. 询问闪 before hook:目标有 '界烈弓/禁闪' 标签 → 去标签 + cancel(强制命中)。
//   4. 造成伤害 before hook:目标有 '界烈弓/加伤' 标签 → 去标签 + modify(amount+1)。
//
// 标签生命周期:由 指定目标 after 产出,由对应 before hook 消费清除——天然按单次杀结算,
// 多目标杀时各目标的标签互不干扰(标签挂在目标身上)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const TAG_BLOCK = '界烈弓/禁闪';
const TAG_BONUS = '界烈弓/加伤';
const CONFIRM = '界烈弓/confirmed';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界烈弓',
    description:
      '你的杀攻击范围为此杀点数;指定目标后,若其手牌数不大于你,其不能抵消;若其体力值不小于你,伤害+1',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // respond:界黄忠本人回应「是否发动烈弓」的 confirm 询问,结果写入 localVars。
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是请求回应';
      if (atom.requestType !== '界烈弓/confirm') return '当前不是界烈弓确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRM] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 指定目标 after:条件满足 → 询问 → 按条件加标签 ──
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

    // 两条件独立判定
    const condBlock = targetPlayer.hand.length <= self.hand.length; // 效果1:手牌不大于自己
    const condBonus = targetPlayer.health >= self.health; // 效果2:体力不小于自己
    if (!condBlock && !condBonus) return;

    // 询问是否发动(单次发动,统一管理两效果)
    delete ctx.state.localVars[CONFIRM];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '界烈弓/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动烈弓?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRM]) return;

    // 按成立条件加标签(同一杀对同一目标可同时叠加禁闪+加伤)
    if (condBlock) {
      await applyAtom(ctx.state, { type: '加标签', player: target, tag: TAG_BLOCK });
    }
    if (condBonus) {
      await applyAtom(ctx.state, { type: '加标签', player: target, tag: TAG_BONUS });
    }
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
      if (!player?.tags.includes(TAG_BLOCK)) return;
      await applyAtom(ctx.state, { type: '去标签', player: target, tag: TAG_BLOCK });
      return { kind: 'cancel' };
    },
  );

  // ── 造成伤害 before:目标有加伤标签 → 去标签 + modify(amount+1) ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as {
        source?: number;
        target?: number;
        amount?: number;
        cardId?: string;
      };
      if (atom.source !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      const target = atom.target;
      if (target === undefined) return;
      const cardId = atom.cardId;
      if (typeof cardId === 'string') {
        const card = ctx.state.cardMap[cardId];
        if (card?.name !== '杀') return;
      }
      const player = ctx.state.players[target];
      if (!player?.tags.includes(TAG_BONUS)) return;
      await applyAtom(ctx.state, { type: '去标签', player: target, tag: TAG_BONUS });
      return {
        kind: 'modify',
        atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom,
      };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界烈弓',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动烈弓?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
