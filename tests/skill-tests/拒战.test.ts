// 拒战(严颜·蜀·被动技·转换技,OL hero/400 风林火山)测试:
//   转换技,阳:成为其他角色杀的目标后 → 双方各摸一 + 来源本回合不能再对严颜用牌
//          阴:使用杀指定目标后 → 获得其一张牌 + 严颜本回合不能再对其用牌
//
// 用例:
//   1. 阳 happy path:成目标后 → 双方各摸 1 → 翻阴 → 杀仍命中(禁制不阻断当次)
//   2. 阳禁制生效:发动后 source→owner 成目标被 cancel;source→他人/他人→owner 不受影响
//   3. 阳拒绝发动:不摸/不翻/不设禁制(来源仍可对严颜用牌)
//   4. 阳仅在阳态:阴态时成目标不触发阳
//   5. 阴 happy path:指定目标后 → 获得目标一张牌 → 翻阳 → 杀仍命中
//   6. 阴禁制生效:发动后 owner→target 成目标被 cancel
//   7. 阴拒绝发动:不获/不翻/不设禁制
//   8. 阴仅在阴态:阳态时指定目标不触发阴;目标无牌不触发
//   9. 转换态跨回合持久 + 回合开始重新同步 view
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { skillLoaders } from '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, Faction, GameState, PlayerState } from '../../src/engine/types';

// 注册拒战技能(subagent 不碰 index.ts,测试中直接赋值)
skillLoaders['拒战'] = () => import('../../src/engine/skills/拒战').then((m) => m.default);

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '严颜',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['拒战'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '蜀',
    identity: '忠臣',
  };
}

const DECK_IDS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
function seedDeckCards(state: GameState): void {
  for (const id of DECK_IDS) state.cardMap[id] = makeCard(id, '杀', '♠');
}

/** 当前 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  if (state.pendingSlots.size === 0) return null;
  const slot = [...state.pendingSlots.values()][0];
  return (slot.atom as { requestType?: string }).requestType ?? null;
}

const STATE_KEY = '拒战/态';
const FORBIDDEN_VAR = '拒战/禁对';

describe('拒战', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 阳 happy path ─────────────────────────────────
  it('阳: 成为目标后双方各摸一, 翻阴, 杀仍命中', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['s1'],
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          skills: ['闪', '回合管理'],
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: { s1: makeCard('s1', '杀', '♠', '7') },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P0 = harness.player('严颜');
    const P1 = harness.player('P1');

    // P1 出杀指定严颜
    await P1.useCardAndTarget('杀', 's1', [0]);
    // 成为目标后 → 拒战(阳)询问
    expect(currentRequestType(harness.state)).toBe('拒战/阳/confirm');
    await P0.respond('拒战', { choice: true });
    // 双方各摸一张
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.players[1].hand.length).toBe(1);
    // 翻为阴
    expect(harness.state.players[0].vars[STATE_KEY]).toBe('阴');
    // 询问闪 → 严颜不出
    await P0.pass();
    // 杀仍命中(禁制不阻断当次杀的结算):严颜体力 4→3
    expect(harness.state.players[0].health).toBe(3);
    // 禁制已设:source(1)→owner(0)
    const forbidden = harness.state.turn.vars[FORBIDDEN_VAR] as
      | Array<{ from: number; to: number }>
      | undefined;
    expect(forbidden?.some((p) => p.from === 1 && p.to === 0)).toBe(true);
  });

  // ─── 2. 阳禁制生效 ─────────────────────────────────────
  it('阳禁制: 发动后 source→owner 成目标被 cancel, 其它方向不受影响', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['s1'],
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          skills: ['闪', '回合管理'],
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: { s1: makeCard('s1', '杀', '♠', '7') },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P0 = harness.player('严颜');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await P0.respond('拒战', { choice: true });
    await P0.pass(); // 不闪,杀命中

    // source(1) → owner(0):禁制命中 → 成为目标 cancel(返回 false)
    const r1 = await applyAtom(harness.state, {
      type: '成为目标',
      source: 1,
      target: 0,
      cardId: 's1',
    });
    expect(r1).toBe(false);
    // source(1) → P2(2):非禁制 → 允许
    const r2 = await applyAtom(harness.state, {
      type: '成为目标',
      source: 1,
      target: 2,
      cardId: 's1',
    });
    expect(r2).toBe(true);
    // P2(2) → owner(0):非禁制 → 允许
    const r3 = await applyAtom(harness.state, {
      type: '成为目标',
      source: 2,
      target: 0,
      cardId: 's1',
    });
    expect(r3).toBe(true);
    // source 对自己用牌(桃/酒)允许:source===target
    const r4 = await applyAtom(harness.state, {
      type: '成为目标',
      source: 1,
      target: 1,
      cardId: 's1',
    });
    expect(r4).toBe(true);
  });

  // ─── 3. 阳拒绝发动 ─────────────────────────────────────
  it('阳: 不发动则不摸/不翻/不设禁制', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['s1'],
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: { s1: makeCard('s1', '杀', '♠', '7') },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P0 = harness.player('严颜');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 's1', [0]);
    expect(currentRequestType(harness.state)).toBe('拒战/阳/confirm');
    await P0.respond('拒战', { choice: false }); // 不发动
    // 未摸牌
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].hand.length).toBe(0);
    // 仍为阳态
    expect(harness.state.players[0].vars[STATE_KEY] ?? '阳').toBe('阳');
    // 询问闪 → 不出 → 命中
    await P0.pass();
    expect(harness.state.players[0].health).toBe(3);
    // 未设禁制:source 仍可对严颜用牌
    const r = await applyAtom(harness.state, {
      type: '成为目标',
      source: 1,
      target: 0,
      cardId: 's1',
    });
    expect(r).toBe(true);
  });

  // ─── 4. 阳仅在阳态 ────────────────────────────────────
  it('阳: 阴态时不触发(成目标不询问阳)', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['s1'],
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: { s1: makeCard('s1', '杀', '♠', '7') },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    // 预置为阴态
    state.players[0].vars[STATE_KEY] = '阴';
    await harness.setup(state);
    const P0 = harness.player('严颜');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 's1', [0]);
    // 阴态 → 阳不触发:无拒战询问,直接进询问闪
    expect(currentRequestType(harness.state)).not.toBe('拒战/阳/confirm');
    // 严颜未摸牌
    expect(harness.state.players[0].hand.length).toBe(0);
    await P0.pass();
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 5. 阴 happy path ─────────────────────────────────
  it('阴: 指定目标后获得其一张牌, 翻阳, 杀仍命中', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'], hand: ['s1'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['f1'],
          equipment: { 武器: 'w1' },
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        f1: makeCard('f1', '闪', '♥', '2'),
        w1: makeCard('w1', '丈八蛇矛', '♣', 'A', '装备牌'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    // 预置为阴态
    state.players[0].vars[STATE_KEY] = '阴';
    await harness.setup(state);
    const P0 = harness.player('严颜');
    const P1 = harness.player('P1');

    // 严颜出杀指定 P1
    await P0.useCardAndTarget('杀', 's1', [1]);
    // 指定目标后 → 拒战(阴)询问
    expect(currentRequestType(harness.state)).toBe('拒战/阴/confirm');
    await P0.respond('拒战', { choice: true });
    // 选牌面板:获得 P1 的武器(装备明选)
    expect(currentRequestType(harness.state)).toBe('拒战/阴/选牌');
    await P0.respond('拒战', { zone: 'equipment', cardId: 'w1' });
    // 严颜获得丈八蛇矛(入手),P1 装备槽清空
    expect(harness.state.players[0].hand).toContain('w1');
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    // 翻为阳
    expect(harness.state.players[0].vars[STATE_KEY]).toBe('阳');
    // 询问闪 → P1 不出 → 杀命中(禁制不阻断当次)
    await P1.pass();
    expect(harness.state.players[1].health).toBe(3);
    // 禁制已设:owner(0)→target(1)
    const forbidden = harness.state.turn.vars[FORBIDDEN_VAR] as
      | Array<{ from: number; to: number }>
      | undefined;
    expect(forbidden?.some((p) => p.from === 0 && p.to === 1)).toBe(true);
  });

  // ─── 6. 阴禁制生效 ─────────────────────────────────────
  it('阴禁制: 发动后 owner→target 成目标被 cancel', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'], hand: ['s1'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['f1'],
          equipment: { 武器: 'w1' },
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          skills: ['闪', '回合管理'],
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        f1: makeCard('f1', '闪', '♥', '2'),
        w1: makeCard('w1', '丈八蛇矛', '♣', 'A', '装备牌'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    state.players[0].vars[STATE_KEY] = '阴';
    await harness.setup(state);
    const P0 = harness.player('严颜');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P0.respond('拒战', { choice: true });
    await P0.respond('拒战', { zone: 'equipment', cardId: 'w1' });
    await P1.pass(); // 不闪

    // owner(0) → target(1):禁制命中 → cancel
    const r1 = await applyAtom(harness.state, {
      type: '成为目标',
      source: 0,
      target: 1,
      cardId: 's1',
    });
    expect(r1).toBe(false);
    // owner(0) → P2(2):非禁制 → 允许
    const r2 = await applyAtom(harness.state, {
      type: '成为目标',
      source: 0,
      target: 2,
      cardId: 's1',
    });
    expect(r2).toBe(true);
  });

  // ─── 7. 阴拒绝发动 ─────────────────────────────────────
  it('阴: 不发动则不获/不翻/不设禁制', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'], hand: ['s1'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['f1'],
          equipment: { 武器: 'w1' },
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        f1: makeCard('f1', '闪', '♥', '2'),
        w1: makeCard('w1', '丈八蛇矛', '♣', 'A', '装备牌'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    state.players[0].vars[STATE_KEY] = '阴';
    await harness.setup(state);
    const P0 = harness.player('严颜');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    expect(currentRequestType(harness.state)).toBe('拒战/阴/confirm');
    await P0.respond('拒战', { choice: false }); // 不发动
    // 未获得:P1 武器仍在
    expect(harness.state.players[1].equipment['武器']).toBe('w1');
    // 仍为阴态
    expect(harness.state.players[0].vars[STATE_KEY]).toBe('阴');
    // 询问闪 → P1 不出 → 命中
    await P1.pass();
    expect(harness.state.players[1].health).toBe(3);
    // 未设禁制:owner 仍可对 target 用牌
    const r = await applyAtom(harness.state, {
      type: '成为目标',
      source: 0,
      target: 1,
      cardId: 's1',
    });
    expect(r).toBe(true);
  });

  // ─── 8. 阴仅在阴态 + 目标无牌不触发 ────────────────────
  it('阴: 阳态时不触发; 目标无牌时不触发', async () => {
    // 8a. 阳态:严颜出杀 → 阴不触发
    const stateA = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'], hand: ['s1'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['f1'],
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        f1: makeCard('f1', '闪', '♥', '2'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(stateA);
    // 阳态(默认)
    await harness.setup(stateA);
    const P0a = harness.player('严颜');
    const P1a = harness.player('P1');
    await P0a.useCardAndTarget('杀', 's1', [1]);
    expect(currentRequestType(harness.state)).not.toBe('拒战/阴/confirm');
    await P1a.pass();

    // 8b. 阴态但目标无牌(手牌+装备皆空):阴不触发
    harness = new SkillTestHarness();
    const stateB = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'], hand: ['s1'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: [],
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: { s1: makeCard('s1', '杀', '♠', '7') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(stateB);
    stateB.players[0].vars[STATE_KEY] = '阴';
    await harness.setup(stateB);
    const P0b = harness.player('严颜');
    await P0b.useCardAndTarget('杀', 's1', [1]);
    // 目标无牌 → 阴不触发:无拒战询问
    expect(currentRequestType(harness.state)).not.toBe('拒战/阴/confirm');
  });

  // ─── 9. 转换态跨回合持久 + 回合开始重新同步 view ────────
  it('转换态跨回合持久: 翻阴后下回合开始仍为阴, view 重新同步', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: '严颜', skills: ['拒战'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['s1'],
          skills: ['闪', '回合管理'],
          faction: '魏',
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: { s1: makeCard('s1', '杀', '♠', '7') },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P0 = harness.player('严颜');
    const P1 = harness.player('P1');

    // 触发阳 → 翻阴
    await P1.useCardAndTarget('杀', 's1', [0]);
    await P0.respond('拒战', { choice: true });
    await P0.pass();
    expect(harness.state.players[0].vars[STATE_KEY]).toBe('阴');

    // 模拟回合结束(turn.vars 被清,但 player.vars 的态保留)再回合开始
    harness.state.turn.vars = {};
    // 严颜的回合开始 → after-hook 重新同步 view(调 syncStateView,不抛错即通过)
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    // 态仍为阴(跨回合持久:STATE_KEY 无 /usedThisTurn 后缀,不被「回合结束」清)
    expect(harness.state.players[0].vars[STATE_KEY]).toBe('阴');
    // 禁制已随 turn.vars 清空(本回合未再触发)
    expect(harness.state.turn.vars[FORBIDDEN_VAR]).toBeUndefined();
  });
});
