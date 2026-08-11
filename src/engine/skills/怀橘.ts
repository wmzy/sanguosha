// 怀橘(陆绩·吴·锁定技,OL hero/402 风林火山官方逐字):
//   "锁定技,游戏开始时,你获得3枚'橘'标记。当有'橘'的角色受到伤害时,防止此伤害
//    并移除1枚'橘'。有'橘'的角色摸牌阶段多摸一张牌。"
//
// 三段效果(均为锁定技,自动触发):
//   1. 游戏开始初始化:获得 3 枚橘标记。
//   2. 受到伤害时:目标有橘 → 移除 1 枚橘 + 完全防止伤害(cancel)。
//   3. 摸牌阶段:有橘的角色在自己摸牌阶段多摸一张(before-hook modify count+1)。
//
// 橘标记存储(参考 界矢北/护甲、界血裔/裔、界巧变/变):
//   每枚橘 = 一个 mark,id 形如 `怀橘/橘:N`(N=state.seq 唯一)。
//   count = marks 中此前缀数量。加/减经 加标记/去标记 atom(view 自动同步)。
//   橘标记可被 遗礼 给予其他角色(其他角色同样享有免伤+多摸)。
//
// 关键设计:怀橘是陆绩的技能,但橘的免伤/多摸效果作用于"持有橘的任意角色"。
//   故 受到伤害时/摸牌 的 hook 检查 atom.target/atom.player 是否有橘(不限 ownerId)。
//   一局通常只有一个陆绩,一个 怀橘 实例的 hook 即覆盖所有橘持有者。
//
// 跨技能共享:橘标记由 怀橘 创建、遗礼 给予、整论 获取。
//   本文件导出 juCount/addJu/removeJu 供 遗礼/整论 复用,避免跨文件协议碎片化。
import type { FrontendAPI, GameState, HookResult, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerBeforeHook, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';

const SKILL_ID = '怀橘';

/** 橘 mark id 前缀。每枚橘 = 1 个 mark。 */
export const JU_PREFIX = `${SKILL_ID}/橘:`;
/** 游戏开始初始化标记(localVars,per-owner,首次触发后置 true) */
const INIT_KEY = (ownerId: number) => `${SKILL_ID}/init/${ownerId}`;

/** 数当前玩家的橘标记数 */
export function juCount(state: GameState, player: number): number {
  return state.players[player]?.marks.filter((m) => m.id.startsWith(JU_PREFIX)).length ?? 0;
}

/** 加 1 枚橘 mark(经 加标记 atom,view 自动同步) */
export async function addJu(state: GameState, player: number): Promise<void> {
  await applyAtom(state, {
    type: '加标记',
    player,
    mark: { id: `${JU_PREFIX}${state.seq}`, scope: player },
  });
}

/** 移除 N 枚橘 mark(按 mark 加入顺序依次移除,经 去标记 atom,view 同步) */
export async function removeJu(state: GameState, player: number, count = 1): Promise<void> {
  const marks = state.players[player]?.marks ?? [];
  const toRemove: string[] = [];
  for (const m of marks) {
    if (toRemove.length >= count) break;
    if (m.id.startsWith(JU_PREFIX)) toRemove.push(m.id);
  }
  for (const markId of toRemove) {
    await applyAtom(state, { type: '去标记', player, markId });
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description:
      '锁定技:游戏开始时获得3枚橘标记;有橘的角色受到伤害时防止伤害并移除1枚橘;有橘的角色摸牌阶段多摸一张牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 游戏开始初始化(化身/界巧变/界矢北先例):'回合开始' after-hook,首次触发加 3 枚橘 ──
  //   主公首回合开始 ≈ 游戏开始,此时所有座次的 怀橘 实例同步初始化。
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;
    if (st.localVars[INIT_KEY(ownerId)]) return; // 仅首次触发
    st.localVars[INIT_KEY(ownerId)] = true;
    await addJu(st, ownerId);
    await addJu(st, ownerId);
    await addJu(st, ownerId);
  });

  // ── 橘免伤:before-hook on 受到伤害时,目标有橘 → 移除 1 枚橘 + cancel(完全防止) ──
  //   cancel 语义:编排函数跳到 伤害结算结束时,目标不扣体力(完全防止)。
  //   检查 atom.target(不限 ownerId):遗礼给的橘同样保护其他角色。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '受到伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      const target = atom.target;
      if (juCount(ctx.state, target) <= 0) return; // 目标无橘
      // 有橘:先移除 1 枚橘,再 cancel 防止伤害
      await removeJu(ctx.state, target);
      return { kind: 'cancel' };
    },
  );

  // ── 橘多摸:before-hook on 摸牌,有橘的角色在自己摸牌阶段额外摸一张 ──
  //   仅该玩家自己回合的摸牌阶段(排除无中生有/遗计/苦肉等其他摸牌)。
  //   锁定技:有橘即自动 +1,无需询问。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      const player = atom.player;
      if (ctx.state.currentPlayerIndex !== player) return;
      if (ctx.state.phase !== '摸牌') return;
      const p = ctx.state.players[player];
      if (!p?.alive) return;
      if (juCount(ctx.state, player) <= 0) return; // 无橘不额外摸
      const count = atom.count ?? 2;
      return { kind: 'modify', atom: { ...atom, count: count + 1 } as typeof atom };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技——无主动 action 声明
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
