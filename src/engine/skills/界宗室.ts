// 界宗室(界刘表·群·锁定技,OL 界限突破官方逐字):
//   锁定技,你的手牌上限+X(X为全场势力数)。其他角色对你造成伤害时,
//   防止此伤害改为令其摸一张牌,每种势力限一次。
//
// 与标版宗室(标版未实现)的区别:
//   - 标版:手牌上限+X。
//   - 界版:手牌上限+X + 防伤改摸牌(每种势力限一次)。
//   界版新增防伤机制,必须独立界版文件。
//
// 实现要点:
//   - 手牌上限+X:registerHandLimitProvider 返回 默认公式(health+bonus) + countFactions。
//     永久常驻,随技能实例注册/卸载。X 动态计算(玩家死亡会改变势力数)。
//   - 防伤改摸牌:造成伤害 before-hook(target=ownerId, source≠ownerId, source 存活, amount>0)
//     → 若 source.faction 未用过本技防伤:
//         1) 标记 source.faction 已用(player.vars[`宗室/防伤/${faction}`]=true)
//         2) 令 source 摸一张牌(applyAtom 摸牌)
//         3) cancel 原伤害(防止此伤害)
//   - 锁定技:不询问玩家,自动触发。
//   - "每种势力限一次":持久(per-game)限制,记录在 owner 的 player.vars。
//     (描述未说"本回合",默认整局;source 无 faction 时不触发,因无法归属势力)
//
// 命名:文件名/loader key/character skill name 均为 '界宗室'(避开标宗室冲突);
//   内部 Skill.name = '宗室'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerBeforeHook, type SkillModule } from '../skill';
import { registerHandLimitProvider } from '../hand-limit';

const DISPLAY_NAME = '宗室';

/** player.vars key 前缀:某势力已用过本技防伤。后接 faction 名。 */
const USED_PREFIX = '宗室/防伤/';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '锁定技:手牌上限+X(X为全场势力数);其他角色对你造成伤害时,防止此伤害改为令其摸一张牌,每种势力限一次',
    isLocked: true,
  };
}

/** 计算全场存活玩家的不同势力数(X)。 */
function countFactions(state: GameState): number {
  const factions = new Set<string>();
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.faction) factions.add(p.faction);
  }
  return factions.size;
}

/** 检查某势力是否已用过本技防伤。 */
function factionUsed(state: GameState, ownerId: number, faction: string): boolean {
  return state.players[ownerId]?.vars[USED_PREFIX + faction] === true;
}

/** 标记某势力已用过本技防伤。 */
function markFactionUsed(state: GameState, ownerId: number, faction: string): void {
  const p = state.players[ownerId];
  if (p) p.vars[USED_PREFIX + faction] = true;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 手牌上限覆盖提供者:默认公式 + countFactions ──
  //   永久常驻:随技能实例注册/卸载(走 setSkillInstanceUnload 统一清理)。
  //   返回 health + bonus + X,其中 X = 全场存活玩家不同势力数(动态)。
  const unloadProvider = registerHandLimitProvider(state, ownerId, (st, player) => {
    if (player !== ownerId) return undefined;
    const p = st.players[player];
    if (!p) return undefined;
    const bonus = (st.turn.vars[`手牌上限/bonus:${player}`] as number | undefined) ?? 0;
    return (p.health ?? 0) + bonus + countFactions(st);
  });

  // ── 造成伤害 before-hook:其他角色对 owner 造成伤害 → 防止 + 来源摸 1 ──
  //    锁定技,自动触发。每种势力限一次(per-game)。
  const unloadHook = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '受到伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      const amount = atom.amount ?? 0;
      if (amount <= 0) return;

      const source = atom.source;
      // 无来源(系统伤害如闪电)或自伤不触发
      if (source === undefined || source === ownerId) return;

      const self = ctx.state.players[ownerId];
      const sourcePlayer = ctx.state.players[source];
      if (!self?.alive) return;
      if (!sourcePlayer?.alive) return; // 来源须存活

      // 来源须有势力归属(无 faction 无法计"每种势力")
      const faction = sourcePlayer.faction;
      if (!faction) return;

      // 每种势力限一次:已用过的势力不再防止
      if (factionUsed(ctx.state, ownerId, faction)) return;

      // 1) 标记该势力已用(在读条件后立即设,防重入)
      markFactionUsed(ctx.state, ownerId, faction);

      // 2) 令来源摸一张牌
      await applyAtom(ctx.state, { type: '摸牌', player: source, count: 1 });

      // 3) 防止此伤害(cancel 原伤害)
      return { kind: 'cancel' };
    },
  );

  return () => {
    unloadProvider();
    unloadHook();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技:无主动 action / 无询问 prompt,前端不渲染交互控件。
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
