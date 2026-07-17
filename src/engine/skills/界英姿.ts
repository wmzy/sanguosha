// 界英姿(界周瑜·吴·锁定技):摸牌阶段，你多摸一张牌。你的手牌上限为你的体力上限。
//
// 官方来源:三国杀 OL 界限突破 hero/308(逐字):
//   "锁定技，摸牌阶段，你多摸一张牌。你的手牌上限为你的体力上限。"
//
// 界版变化(相对标版 src/engine/skills/英姿.ts):
//   - 锁定技:摸牌阶段强制多摸 1 张(不再询问玩家是否发动)。
//   - 手牌上限恒等于体力上限(maxHealth):通过 hand-limit 覆盖型提供者注册,
//     只要技能实例在场就生效(永久常驻,非本回合临时、不依赖当前体力值、不依赖是否多摸过)。
//     弃牌阶段(回合管理.ts)与弃牌超时(请求回应.ts)统一经 handLimit() 读取。
//
// 内部键名保持标版前缀('英姿/xxx'):界版与标版互斥不共存(界裸衣规范)。
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { registerBeforeHook } from '../skill';
import { registerHandLimitProvider } from '../hand-limit';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界英姿',
    description: '锁定技:摸牌阶段你多摸一张牌;你的手牌上限为你的体力上限',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 摸牌 before hook:锁定技,自己摸牌阶段强制多摸 1 张(不询问) ──
  // 仅自己回合的摸牌阶段(排除无中生有/遗计/苦肉等其他摸牌场景)。
  const unloadHook = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number; count?: number };
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      if (ctx.state.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      // 锁定技:无条件多摸一张
      const count = atom.count ?? 2;
      return { kind: 'modify', atom: { ...ctx.atom, count: count + 1 } as typeof ctx.atom };
    },
  );

  // ── 手牌上限覆盖提供者:恒等于体力上限(maxHealth)──
  // 永久常驻:随技能实例注册/卸载(走 setSkillInstanceUnload 统一清理)。
  const unloadProvider = registerHandLimitProvider(state, ownerId, (st, player) => {
    return st.players[player]?.maxHealth;
  });

  return () => {
    unloadHook();
    unloadProvider();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技:无主动 action / 无询问 prompt,前端不渲染交互控件。
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
