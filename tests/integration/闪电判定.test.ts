// tests/integration/闪电判定.test.ts
// 集成测试:闪电(延时锦囊)判定
//
// 注:闪电 skill 模块尚未实现,所以真实的"判定黑桃2-9则造成3点伤害"逻辑
// 只能等到 skill 实现后才能测。当前覆盖:
//   1. 闪电卡通过 添加延时锦囊 atom 进入判定区
//   2. 闪电卡通过 移除延时锦囊 atom 离开判定区
//   3. 闪电与其他延时锦囊(乐不思蜀)并存 → 各自按 name 独立移除
//   4. 判定 atom (judgeType='闪电') 通用行为:翻判定牌→after hooks→进弃牌堆
//      (无 闪电 skill 时 after hook 不消耗闪电,验证 plumbing 通路)
//
// 模式:不依赖 SkillTestHarness(dispatch 路径对判定 atom 不直接暴露),
// 用 applyAtom 直接驱动。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
  applyAtom,
} from '../../src/engine/create-engine';
import { getAtomDef } from '../../src/engine/atom';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, PendingTrick } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
  pendingTricks?: PendingTrick[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, rank, type };
}

describe('闪电:延时锦囊判定 plumbing', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:添加延时锦囊 atom → 闪电进 P0 判定区
  // ─────────────────────────────────────────────────────────────
  it('用例1:applyAtom(添加延时锦囊) → 闪电进 P0 判定区', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: [] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
      ],
      cardMap: { [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    expect(state.players[0].pendingTricks).toHaveLength(0);

    await applyAtom(state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 0, card: sd },
    });

    expect(state.players[0].pendingTricks).toHaveLength(1);
    expect(state.players[0].pendingTricks[0].name).toBe('闪电');
    expect(state.players[0].pendingTricks[0].source).toBe(0);
    expect(state.players[0].pendingTricks[0].card).toEqual(sd);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:移除延时锦囊 atom → 闪电离开判定区
  // ─────────────────────────────────────────────────────────────
  it('用例2:applyAtom(移除延时锦囊) → 闪电离开判定区', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          pendingTricks: [{ name: '闪电', source: 0, card: sd }],
        }),
      ],
      cardMap: { [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await registerSkillsFromState(state);

    expect(state.players[0].pendingTricks).toHaveLength(1);

    await applyAtom(state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '闪电',
    });

    expect(state.players[0].pendingTricks).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:判定区有 闪电 + 乐不思蜀 两个延时锦囊 → 按 name 独立移除
  // ─────────────────────────────────────────────────────────────
  it('用例3:判定区同时有 闪电 + 乐不思蜀 → 移除一个不影响另一个', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♥', 'K');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          pendingTricks: [
            { name: '闪电', source: 0, card: sd },
            { name: '乐不思蜀', source: 1, card: lb },
          ],
        }),
      ],
      cardMap: { [sd.id]: sd, [lb.id]: lb },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await registerSkillsFromState(state);

    expect(state.players[0].pendingTricks).toHaveLength(2);

    // 移除闪电
    await applyAtom(state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '闪电',
    });

    expect(state.players[0].pendingTricks).toHaveLength(1);
    expect(state.players[0].pendingTricks[0].name).toBe('乐不思蜀');
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:判定 atom (judgeType='闪电') → 翻判定牌进处理区,after hooks 不消耗延时锦囊
  // (因为当前无 闪电 skill 监听该 after hook,所以原子层 plumbing 验证)
  // ─────────────────────────────────────────────────────────────
  it('用例4:判定 atom → 翻判定牌到处理区,after hooks 跑完入弃牌堆;闪电仍在判定区(无 skill 处理)', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const judgeCard: Card = makeCard('jd1', '杀', '♥', '7', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          pendingTricks: [{ name: '闪电', source: 0, card: sd }],
        }),
      ],
      cardMap: { [sd.id]: sd, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    // 触发判定 atom
    await applyAtom(state, { type: '判定', player: 0, judgeType: '闪电' });

    // 判定牌已被翻到处理区后转入弃牌堆(atom 的 afterHooks 收尾)
    expect(state.zones.deck).not.toContain(judgeCard.id);
    expect(state.zones.processing).not.toContain(judgeCard.id);
    expect(state.zones.discardPile).toContain(judgeCard.id);

    // 闪电仍在判定区(无 skill 处理 → 不移除)
    expect(state.players[0].pendingTricks).toHaveLength(1);
    expect(state.players[0].pendingTricks[0].name).toBe('闪电');
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5:添加延时锦囊 atom 的去重行为(同 name 已存在则不再 push)
  // ─────────────────────────────────────────────────────────────
  it('用例5:同一个 trick name 重复添加 → 不会重复入判定区', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          pendingTricks: [{ name: '闪电', source: 0, card: sd }],
        }),
      ],
      cardMap: { [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await registerSkillsFromState(state);

    expect(state.players[0].pendingTricks).toHaveLength(1);

    // 重复添加(同名)
    await applyAtom(state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 1, card: sd },
    });

    // 不会重复入栈(去重)
    expect(state.players[0].pendingTricks).toHaveLength(1);
    // 原本的 source 保持不变(去重,不会覆盖)
    expect(state.players[0].pendingTricks[0].source).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 6:validate 拒绝——给不存在的玩家添加延时锦囊
  // ─────────────────────────────────────────────────────────────
  it('用例6:applyAtom(添加延时锦囊) → player 不存在时 validate 拒绝', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0' }),
      ],
      cardMap: { [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await registerSkillsFromState(state);

    // validate 直接调用:不存在的 player=5 → 应返回错误字符串
    const def = getAtomDef('添加延时锦囊');
    const err = def.validate(state, {
      type: '添加延时锦囊',
      player: 5,
      trick: { name: '闪电', source: 0, card: sd },
    });
    expect(err).not.toBeNull();
    expect(String(err)).toContain('player 5 not found');
    // 没真正进判定区
    expect(state.players[0].pendingTricks).toHaveLength(0);
  });
});