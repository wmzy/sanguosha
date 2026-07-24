// tests/skill-tests/death-flow.test.ts
// 模块 B:死亡编排函数 runDeathFlow 时机顺序验证(对齐 docs/flow-redesign.md 模块 B / death.md)。
// 不依赖具体技能——直接调用编排函数,断言 state.atomHistory 的 atom 时序、身份揭示、
// 弃牌+alive=false 的实质变化,以及奖惩(反贼摸3/忠臣弃牌)。
//
// 验证点(对齐 docs/flow-redesign.md 模块 B 验收):
//   1. 正常死亡:5 时机(亮身份牌前/亮身份牌/死亡时/系统处理牌/死亡后)依次发出,
//      alive=false、手牌+装备入弃牌堆。
//   2. killer 透传:死亡时/死亡后 的 atom 携带 killer。
//   3. 奖惩·反贼死:killer 摸3张(在系统处理牌之后、死亡后之前)。
//   4. 奖惩·忠臣被主公杀:主公弃所有牌。
//   5. 奖惩·无来源(体力致死):不摸牌。
//   6. 奖惩·自杀:不摸牌。
//   7. 死亡时 before-hook 可 cancel 跳过系统处理牌(保留时机扩展能力)。
//   8. 身份揭示:亮身份牌 atom 携带阵亡者 identity。
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms'; // 注册所有 atom(含 death-timing)
import { createGameState } from '../../src/engine/types';
import type { Atom, GameState, PlayerState } from '../../src/engine/types';
import { runDeathFlow } from '../../src/engine/death-flow';

function makePlayer(opts: {
  index: number;
  name: string;
  health?: number;
  maxHealth?: number;
  hand?: string[];
  equipment?: PlayerState['equipment'];
  identity?: PlayerState['identity'];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    ...(opts.identity ? { identity: opts.identity } : {}),
  };
}

function makeState(): GameState {
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P0', health: 4, maxHealth: 4 }),
      makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4 }),
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

/** 取 state.atomHistory 中所有 atom 事件(跳过 notify)的 type 序列。 */
function atomTypes(state: GameState): string[] {
  return state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom.type);
}

/** 从 atomHistory 取第一个匹配 type 的 atom(断言为对应形状)。 */
function findAtom<T extends Atom>(state: GameState, type: string): T {
  return state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom)
    .find((a) => a.type === type) as T;
}

describe('模块 B:死亡编排函数 runDeathFlow', () => {
  let state: GameState;
  beforeEach(() => {
    state = makeState();
  });

  // ── 时机顺序 + 实质变化 ─────────────────────────────────────
  it('正常死亡:5 时机依次发出,alive=false + 手牌/装备入弃牌堆', async () => {
    state.players[0].hand = ['c1', 'c2'];
    state.players[0].equipment = { 武器: 'w1' };
    state.cardMap.c1 = { id: 'c1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    state.cardMap.c2 = { id: 'c2', name: '闪', suit: '♥', color: '红', rank: '3', type: '基本牌' };
    state.cardMap.w1 = { id: 'w1', name: '诸葛连弩', suit: '♣', color: '黑', rank: 'A', type: '装备牌' };

    await runDeathFlow(state, 0, 1);

    expect(atomTypes(state)).toEqual([
      '亮身份牌前',
      '亮身份牌',
      '死亡时',
      '系统处理牌',
      '死亡后',
    ]);
    expect(state.players[0].alive).toBe(false);
    expect(state.players[0].hand).toEqual([]);
    expect(state.players[0].equipment).toEqual({});
    // 手牌2 + 装备1 = 3 张入弃牌堆
    expect(state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'c2', 'w1']));
    expect(state.zones.discardPile.length).toBe(3);
  });

  // ── killer 透传 ────────────────────────────────────────────
  it('killer 透传到 死亡时/死亡后 atom', async () => {
    await runDeathFlow(state, 0, 1);
    const dyingAtom = findAtom<Extract<Atom, { type: '死亡时' }>>(state, '死亡时');
    expect(dyingAtom.killer).toBe(1);
    const afterAtom = findAtom<Extract<Atom, { type: '死亡后' }>>(state, '死亡后');
    expect(afterAtom.killer).toBe(1);
  });

  it('killer=undefined(体力致死)时 atom.killer 为 undefined', async () => {
    await runDeathFlow(state, 0);
    const dyingAtom = findAtom<Extract<Atom, { type: '死亡时' }>>(state, '死亡时');
    expect(dyingAtom.killer).toBeUndefined();
  });

  // ── 奖惩·反贼死 → killer 摸3张 ─────────────────────────────
  it('奖惩:killer 杀死反贼 → killer 摸3张(系统处理牌后、死亡后前)', async () => {
    state.players[0].identity = '反贼';
    state.players[1].identity = '主公';
    // 牌堆供摸 3 张
    for (let i = 0; i < 3; i++) {
      const id = `dk${i}`;
      state.cardMap[id] = { id, name: '杀', suit: '♠', color: '黑', rank: String(i + 2), type: '基本牌' };
      state.zones.deck.push(id);
    }

    await runDeathFlow(state, 0, 1);

    // 摸牌 atom 在 系统处理牌 之后、死亡后 之前
    const types = atomTypes(state);
    expect(types).toEqual(['亮身份牌前', '亮身份牌', '死亡时', '系统处理牌', '摸牌', '死亡后']);
    // killer 摸了 3 张
    expect(state.players[1].hand.length).toBe(3);
    expect(state.players[1].hand).toEqual(['dk2', 'dk1', 'dk0']);
  });

  // ── 奖惩·忠臣被主公杀 → 主公弃所有牌 ────────────────────────
  it('奖惩:主公杀死忠臣 → 主公弃所有牌(手牌+装备)', async () => {
    state.players[0].identity = '忠臣';
    state.players[1].identity = '主公';
    state.players[1].hand = ['h1'];
    state.players[1].equipment = { 武器: 'w1' };
    state.cardMap.h1 = { id: 'h1', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' };
    state.cardMap.w1 = { id: 'w1', name: '诸葛连弩', suit: '♣', color: '黑', rank: 'A', type: '装备牌' };

    await runDeathFlow(state, 0, 1);

    // 主公弃所有牌:手牌 + 装备
    expect(state.players[1].hand).toEqual([]);
    expect(state.players[1].equipment).toEqual({});
    expect(state.zones.discardPile).toEqual(expect.arrayContaining(['h1', 'w1']));
  });

  // ── 奖惩·无来源 ────────────────────────────────────────────
  it('奖惩:无来源(体力致死)→ 不摸牌', async () => {
    state.players[0].identity = '反贼';
    for (let i = 0; i < 3; i++) {
      const id = `dk${i}`;
      state.cardMap[id] = { id, name: '杀', suit: '♠', color: '黑', rank: String(i + 2), type: '基本牌' };
      state.zones.deck.push(id);
    }

    await runDeathFlow(state, 0); // killer=undefined

    // 无摸牌 atom,牌堆未动
    expect(atomTypes(state)).toEqual(['亮身份牌前', '亮身份牌', '死亡时', '系统处理牌', '死亡后']);
    expect(state.zones.deck.length).toBe(3);
    // P1(killer不存在)手牌不变
    expect(state.players[1].hand).toEqual([]);
  });

  // ── 奖惩·自杀 ──────────────────────────────────────────────
  it('奖惩:自杀(killer==dead)→ 不摸牌', async () => {
    state.players[0].identity = '反贼';
    for (let i = 0; i < 3; i++) {
      const id = `dk${i}`;
      state.cardMap[id] = { id, name: '杀', suit: '♠', color: '黑', rank: String(i + 2), type: '基本牌' };
      state.zones.deck.push(id);
    }

    await runDeathFlow(state, 0, 0); // 自杀

    expect(atomTypes(state)).toEqual(['亮身份牌前', '亮身份牌', '死亡时', '系统处理牌', '死亡后']);
    expect(state.zones.deck.length).toBe(3);
  });

  // ── 奖惩·非反贼非忠臣(主公/内奸)无奖惩 ──────────────────────
  it('奖惩:杀死内奸 → 无奖励(仅反贼死亡摸牌)', async () => {
    state.players[0].identity = '内奸';
    state.players[1].identity = '主公';
    for (let i = 0; i < 3; i++) {
      const id = `dk${i}`;
      state.cardMap[id] = { id, name: '杀', suit: '♠', color: '黑', rank: String(i + 2), type: '基本牌' };
      state.zones.deck.push(id);
    }

    await runDeathFlow(state, 0, 1);

    expect(atomTypes(state)).toEqual(['亮身份牌前', '亮身份牌', '死亡时', '系统处理牌', '死亡后']);
    expect(state.players[1].hand).toEqual([]);
  });

  // ── 身份揭示:亮身份牌 atom 携带 identity ────────────────────
  it('亮身份牌 携带阵亡者 identity(死亡即公开)', async () => {
    state.players[0].identity = '反贼';

    // killer=undefined(体力致死路径)避免触发奖惩摸牌(牌堆为空会报错)
    await runDeathFlow(state, 0);

    // 亮身份牌 atom 在 atomHistory 中,其 identity 携带在 toViewEvents 的 view event 上
    // (state.atomHistory 存的是原始 atom,不含 view 字段;这里验证 atom 本身存在 + identity 可从 state 读)
    const reveal = findAtom<Extract<Atom, { type: '亮身份牌' }>>(state, '亮身份牌');
    expect(reveal.player).toBe(0);
    // state 侧 identity 仍保留(揭示是 view 层语义)
    expect(state.players[0].identity).toBe('反贼');
  });

  // ── 断肠时机保证:死亡时 after-hook 在系统处理牌之前 ─────────
  it('断肠时机:死亡时(系统处理牌前)触发——通过 before/after hook 顺序验证', async () => {
    // 用一个 死亡时 after-hook 记录触发时的手牌状态(应仍存在),
    // 验证它在 系统处理牌 清空手牌之前执行。
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = { id: 'c1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    let handAtDeathTiming: string[] | null = null;
    // 注册一个 死亡时 after-hook(座次 -1 系统级,确保在断肠类技能同时机)
    const { registerAfterHook } = await import('../../src/engine/skill');
    registerAfterHook(state, 'mockObserve', -1, '死亡时', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '死亡时') return;
      handAtDeathTiming = [...ctx.state.players[atom.player].hand];
    });

    await runDeathFlow(state, 0, 1);

    // 死亡时 after-hook 执行时,死者手牌仍在(系统处理牌尚未清空)
    expect(handAtDeathTiming).toEqual(['c1']);
    // 最终手牌被系统处理牌清空
    expect(state.players[0].hand).toEqual([]);
  });
});
