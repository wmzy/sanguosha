// tests/skill-tests/move-flow.test.ts
// 模块 F:移动牌编排函数 runMoveCardFlow 时机顺序 + 牌堆耗尽重洗 + reason 透传验证
// (对齐 docs/flow-redesign.md 模块 F / move.md)。
//
// 不依赖具体技能——直接调用编排函数,断言 state.atomHistory 的 atom 时序、实质移动、
// 以及牌堆耗尽(非摸牌路径)自动重洗。另验证 弃置/获得/给予 经 afterApply 发出
// 「移动到目标区域后」时机标记并透传 reason(失去原因字段)。
//
// 验证点(对齐 docs/flow-redesign.md 模块 F 验收):
//   1. 时序:移动到目标区域前 → 移动牌 → 移动到目标区域后。
//   2. reason 透传到时机 atom。
//   3. 移动到目标区域前 before-hook modify to 改变实质移动目标。
//   4. 牌堆耗尽(非摸牌路径)→ 自动 重洗(deck+discardPile 合并)。
//   5. 弃置 afterApply 发 移动到目标区域后(reason='弃置', to='弃牌堆')。
//   6. 获得/给予 afterApply 发 移动到目标区域后(reason='获得'/'给予')。
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms'; // 注册所有 atom(含 move-timing)
import { createGameState } from '../../src/engine/types';
import type { Atom, Card, GameState, PlayerState, ZoneLoc } from '../../src/engine/types';
import { runMoveCardFlow } from '../../src/engine/move-flow';
import { applyAtom } from '../../src/engine/create-engine';
import { registerBeforeHook, registerAfterHook } from '../../src/engine/skill';

function makePlayer(opts: {
  index: number;
  name: string;
  health?: number;
  maxHealth?: number;
  hand?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(id: string, name = '杀', suit: '♠' | '♥' | '♦' | '♣' = '♠'): Card {
  return {
    id,
    name,
    suit,
    color: suit === '♥' || suit === '♦' ? '红' : '黑',
    rank: '7',
    type: name === '诸葛连弩' ? '装备牌' : '基本牌',
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

describe('模块 F:移动牌编排函数 runMoveCardFlow', () => {
  let state: GameState;
  beforeEach(() => {
    state = makeState();
  });

  // ── 时序 + 实质移动 ─────────────────────────────────────────
  it('时序:移动到目标区域前 → 移动牌 → 移动到目标区域后', async () => {
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');
    state.zones.deck = ['top']; // 非空牌堆,避免触发重洗(纯时序验证)

    await runMoveCardFlow(state, 'c1', { zone: '手牌', player: 0 }, { zone: '弃牌堆' });

    expect(atomTypes(state)).toEqual([
      '移动到目标区域前',
      '移动牌',
      '移动到目标区域后',
    ]);
    // 实质移动:手牌→弃牌堆
    expect(state.players[0].hand).toEqual([]);
    expect(state.zones.discardPile).toEqual(['c1']);
  });

  // ── reason 透传 ────────────────────────────────────────────
  it('reason 透传到 移动到目标区域前/后 atom', async () => {
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');
    state.zones.deck = ['top'];

    await runMoveCardFlow(
      state,
      'c1',
      { zone: '手牌', player: 0 },
      { zone: '弃牌堆' },
      '弃置',
    );

    const before = findAtom<Extract<Atom, { type: '移动到目标区域前' }>>(state, '移动到目标区域前');
    const after = findAtom<Extract<Atom, { type: '移动到目标区域后' }>>(state, '移动到目标区域后');
    expect(before.reason).toBe('弃置');
    expect(after.reason).toBe('弃置');
  });

  it('reason 缺省时为 undefined', async () => {
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');
    state.zones.deck = ['top'];

    await runMoveCardFlow(state, 'c1', { zone: '手牌', player: 0 }, { zone: '弃牌堆' });

    const after = findAtom<Extract<Atom, { type: '移动到目标区域后' }>>(state, '移动到目标区域后');
    expect(after.reason).toBeUndefined();
  });

  // ── 移动到目标区域前 before-hook modify to ─────────────────
  it('移动到目标区域前 before-hook modify to 可改变实质移动目标(纵玄/章武② 语义)', async () => {
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');
    state.zones.deck = ['top'];

    // 注册一个 before-hook:把目标从 弃牌堆 改为 P1 手牌
    registerBeforeHook(state, 'mockRedirect', 0, '移动到目标区域前', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '移动到目标区域前') return;
      return {
        kind: 'modify',
        atom: { ...atom, to: { zone: '手牌', player: 1 } },
      };
    });

    await runMoveCardFlow(state, 'c1', { zone: '手牌', player: 0 }, { zone: '弃牌堆' });

    // 实质移动落到 P1 手牌(被 before-hook 改向),而非 弃牌堆
    expect(state.players[1].hand).toEqual(['c1']);
    expect(state.zones.discardPile).toEqual([]);
    // 移动牌 atom 的 to 反映改向后的目标
    const move = findAtom<Extract<Atom, { type: '移动牌' }>>(state, '移动牌');
    expect(move.to).toEqual({ zone: '手牌', player: 1 });
  });

  // ── 牌堆耗尽自动重洗(非摸牌路径) ──────────────────────────
  it('牌堆耗尽(非摸牌路径)→ 自动 重洗(deck+discardPile 合并)', async () => {
    // 牌堆空,弃牌堆有牌;c1 在 P0 手牌
    state.zones.deck = [];
    state.zones.discardPile = ['d1', 'd2'];
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');
    state.cardMap.d1 = makeCard('d1', '桃', '♥');
    state.cardMap.d2 = makeCard('d2', '闪', '♦');

    await runMoveCardFlow(state, 'c1', { zone: '手牌', player: 0 }, { zone: '弃牌堆' });

    const types = atomTypes(state);
    // 末尾触发 重洗
    expect(types).toEqual([
      '移动到目标区域前',
      '移动牌',
      '移动到目标区域后',
      '重洗',
    ]);
    // 重洗后:deck 含原 deck+discardPile(c1 已入弃牌堆后再重洗),弃牌堆清空
    expect(state.zones.discardPile).toEqual([]);
    expect(state.zones.deck.length).toBe(3); // d1 + d2 + c1
    expect(state.zones.deck).toEqual(expect.arrayContaining(['d1', 'd2', 'c1']));
  });

  it('牌堆非空时不触发 重洗', async () => {
    state.zones.deck = ['top'];
    state.zones.discardPile = ['d1'];
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');
    state.cardMap.d1 = makeCard('d1', '桃', '♥');
    state.cardMap.top = makeCard('top');

    await runMoveCardFlow(state, 'c1', { zone: '手牌', player: 0 }, { zone: '弃牌堆' });

    // 无 重洗 atom
    expect(atomTypes(state)).not.toContain('重洗');
    expect(state.zones.deck).toEqual(['top']); // 未被动
  });

  it('牌堆空但弃牌堆也空时不触发 重洗(移动不涉及弃牌堆)', async () => {
    state.zones.deck = [];
    state.zones.discardPile = [];
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');

    // 手牌→手牌移动:不涉及牌堆/弃牌堆,二者皆空 → 不重洗
    await runMoveCardFlow(state, 'c1', { zone: '手牌', player: 0 }, { zone: '手牌', player: 1 });

    expect(atomTypes(state)).not.toContain('重洗');
  });

  // ── 弃置/获得/给予 迁移:afterApply 发 移动到目标区域后(reason) ──
  it('弃置 afterApply 为手牌弃置发 移动到目标区域后(reason="弃置")', async () => {
    state.players[0].hand = ['c1', 'c2'];
    state.cardMap.c1 = makeCard('c1');
    state.cardMap.c2 = makeCard('c2');

    await applyAtom(state, { type: '弃置', player: 0, cardIds: ['c1', 'c2'] });

    const afterMarkers = state.atomHistory
      .filter((e) => e.kind === 'atom')
      .map((e) => (e as { atom: Atom }).atom)
      .filter((a) => a.type === '移动到目标区域后') as Extract<
      Atom,
      { type: '移动到目标区域后' }
    >[];
    // 两张手牌各发一个标记
    expect(afterMarkers.length).toBe(2);
    for (const m of afterMarkers) {
      expect(m.reason).toBe('弃置');
      expect(m.to).toEqual({ zone: '弃牌堆' });
      expect(m.from).toEqual({ zone: '手牌', player: 0 });
    }
  });

  it('弃置装备区牌不发 移动到目标区域后(ZoneLoc 不含装备)', async () => {
    state.players[0].hand = [];
    state.players[0].equipment = { 武器: 'w1' };
    state.cardMap.w1 = makeCard('w1', '诸葛连弩', '♣');

    await applyAtom(state, { type: '弃置', player: 0, cardIds: ['w1'] });

    const afterMarkers = atomTypes(state).filter((t) => t === '移动到目标区域后');
    expect(afterMarkers.length).toBe(0);
  });

  it('获得(从他人手牌)afterApply 发 移动到目标区域后(reason="获得")', async () => {
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');

    await applyAtom(state, { type: '获得', player: 1, cardId: 'c1', from: 0 });

    const m = findAtom<Extract<Atom, { type: '移动到目标区域后' }>>(state, '移动到目标区域后');
    expect(m.reason).toBe('获得');
    expect(m.from).toEqual({ zone: '手牌', player: 0 });
    expect(m.to).toEqual({ zone: '手牌', player: 1 });
  });

  it('给予 afterApply 发 移动到目标区域后(reason="给予")', async () => {
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');

    await applyAtom(state, { type: '给予', cardId: 'c1', from: 0, to: 1 });

    const m = findAtom<Extract<Atom, { type: '移动到目标区域后' }>>(state, '移动到目标区域后');
    expect(m.reason).toBe('给予');
    expect(m.from).toEqual({ zone: '手牌', player: 0 });
    expect(m.to).toEqual({ zone: '手牌', player: 1 });
  });

  // ── 技能可挂 移动到目标区域后(失去原因消费示例) ──────────────
  it('技能可注册 移动到目标区域后 after-hook,按 reason 区分触发', async () => {
    state.players[0].hand = ['c1'];
    state.cardMap.c1 = makeCard('c1');

    const observed: { reason?: string; to: ZoneLoc }[] = [];
    registerAfterHook(state, 'mockObserver', -1, '移动到目标区域后', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '移动到目标区域后') return;
      observed.push({ reason: atom.reason, to: atom.to });
    });

    await applyAtom(state, { type: '弃置', player: 0, cardIds: ['c1'] });

    expect(observed).toEqual([{ reason: '弃置', to: { zone: '弃牌堆' } }]);
  });
});
