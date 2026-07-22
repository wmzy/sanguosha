// 界醇醪(界程普·吴·被动技,OL 界限突破官方逐字):
//   你或你相邻角色的【杀】因弃置置入弃牌堆后,将之置于我的武将牌上,称为"醇"。
//   当一名角色处于濒死状态时,你可以移去X张"醇"视为其使用一张【酒】
//   (X为本轮以此法使用【酒】的次数,首次 X=1,第二次 X=2,依此类推)。
//
// 与标版醇醪(程普)区别:
//   1. 标版:结束阶段主动将任意张杀置于武将牌上为"醇"(若你无醇)。
//      界版:改为被动——你或相邻角色弃置置入弃牌堆的杀自动变为"醇"。
//   2. 标版:濒死时移去一张醇视为一张酒(固定 1:1)。
//      界版:移去 X 张醇视为一张酒,X=本轮以此法使用酒的次数(递增代价)。
//
// 实现:
//   ① 弃置 after-hook:
//      若 atom.cardIds 中存在杀 + atom.player 是 owner 或 owner 的相邻角色 →
//      将这些杀 cardId 追加到 owner.vars['醇醪/醇']。
//      杀物理上仍在弃牌堆(discardPile),"醇"仅是 owner vars 中的 cardId 列表 earmark。
//      (buildView 不投影 player.vars['醇醪/醇'],故不破坏视图一致性。)
//   ② respond action(respondFor='桃/求桃'):owner 在濒死求桃循环中可选移醇当酒。
//      X = usedThisRound + 1(轮次切换时重置 usedThisRound);
//      若醇数 >= X:从 vars['醇醪/醇'] 移除前 X 个 cardId + 设 localVars['求桃/已救']=true +
//      usedThisRound += 1。runDyingFlow 据已救标志对濒死角色回复 1 体力。
//   ③ 轮次切换:state.turn.round 由「下一玩家」atom 在新轮次开始时自增。
//      respond 在使用前对比 lastRound 与当前 round,不同则重置 usedThisRound=0。
//
//   相邻角色:n 人局,owner 在位置 i 的相邻 = ((i-1+n)%n, (i+1)%n)。双人局互为相邻。
//
// 命名:文件名/loader key/character skill name 均为 '界醇醪'(避开标醇醪冲突);
//   内部 Skill.name = '醇醪'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, registerAfterHook } from '../skill';

const SKILL_ID = '界醇醪';
const DISPLAY_NAME = '醇醪';
const 醇_KEY = '醇醪/醇';
const USED_ROUND_KEY = '醇醪/usedThisRound';
const LAST_ROUND_KEY = '醇醪/lastRound';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '你或相邻角色的【杀】因弃置置入弃牌堆后,将之置于你的武将牌上为"醇";濒死时你可移去X张"醇"视为一张【酒】(X为本轮以此法使用酒的次数)',
  };
}

/** 取 owner 当前的醇列表(可变引用,直接修改即可) */
function 醇列表(state: GameState, ownerId: number): string[] {
  const v = state.players[ownerId].vars[醇_KEY];
  return Array.isArray(v) ? (v as string[]) : [];
}

/** 取 owner 的相邻角色座次列表(存活) */
function 相邻角色(state: GameState, ownerId: number): number[] {
  const n = state.players.length;
  if (n <= 1) return [];
  const prev = (ownerId - 1 + n) % n;
  const next = (ownerId + 1) % n;
  const result: number[] = [];
  if (prev !== ownerId && state.players[prev]?.alive) result.push(prev);
  if (next !== ownerId && next !== prev && state.players[next]?.alive) result.push(next);
  return result;
}

/** 计算本次使用的 X 值(并按需重置轮次计数) */
function computeX(state: GameState, ownerId: number): number {
  const player = state.players[ownerId];
  const lastRound = player.vars[LAST_ROUND_KEY] as number | undefined;
  const currentRound = state.turn.round;
  if (lastRound !== currentRound) {
    // 新轮次:重置
    player.vars[USED_ROUND_KEY] = 0;
    player.vars[LAST_ROUND_KEY] = currentRound;
  }
  const used = (player.vars[USED_ROUND_KEY] as number | undefined) ?? 0;
  return used + 1;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── 弃置 after-hook:拦截 owner / 相邻角色弃置的杀,加为醇 ──────
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom as { player: number; cardIds: string[] };
    const discardPlayer = atom.player;
    if (discardPlayer === ownerId) {
      // owner 自己弃置:符合
    } else {
      // 相邻角色弃置:符合
      const neighbors = 相邻角色(ctx.state, ownerId);
      if (!neighbors.includes(discardPlayer)) return;
    }
    // 找出被弃的杀 cardId
    const slashIds = atom.cardIds.filter((id) => {
      const c = ctx.state.cardMap[id];
      return !!c && c.name === '杀';
    });
    if (slashIds.length === 0) return;
    // 追加到醇列表(去重,避免同一 id 重复入库)
    const list = 醇列表(ctx.state, ownerId);
    const existing = new Set(list);
    for (const id of slashIds) {
      if (!existing.has(id)) {
        list.push(id);
        existing.add(id);
      }
    }
    ctx.state.players[ownerId].vars[醇_KEY] = list;
  });

  // ─── respond:求桃循环中,owner 可移去 X 张醇视为一张酒 ──────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) => {
      // 必须有针对 owner 的 桃/求桃 pending(求桃循环轮到 owner 时)
      const slot = s.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target?: number }).target !== ownerId) return '不是问你的';
      if (slot.atom.type !== '请求回应') return '当前不是求桃';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== '桃/求桃') return '当前不是求桃';
      // 计算 X 并校验醇数
      const x = computeX(s, ownerId);
      const list = 醇列表(s, ownerId);
      if (list.length < x) return '醇数不足';
      return null;
    },
    async (s) => {
      const x = computeX(s, ownerId);
      const list = 醇列表(s, ownerId);
      // 移去前 X 张醇(物理牌仍留弃牌堆,"移去"= 从醇 earmark 列表删除)
      const removed = list.splice(0, x);
      s.players[ownerId].vars[醇_KEY] = list;
      // 增加本轮使用计数
      const used = (s.players[ownerId].vars[USED_ROUND_KEY] as number | undefined) ?? 0;
      s.players[ownerId].vars[USED_ROUND_KEY] = used + 1;
      // 标记已救援(用 removed 个 cardId 作记录,便于追溯)
      s.localVars['求桃/已救'] = true;
      s.localVars['醇醪/lastUsed'] = removed;
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '醇醪',
    style: 'primary',
    respondFor: '桃/求桃',
    prompt: {
      type: 'confirm',
      title: '醇醪:移去 X 张"醇"视为一张【酒】救援?',
      confirmLabel: '移醇当酒',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
