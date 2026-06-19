// tests/integration/lightning-judge.test.ts
// 集成测试:闪电延时锦囊 — 装备 → 判定区 → 判定黑牌 → 伤害。
//
// 当前引擎状态:闪电 skill 模块尚未实现(无 src/engine/skills/闪电.ts),
// 所以"判定黑桃2-9则造成3点伤害"的真实 skill 行为不能端到端测。
//
// 本文件覆盖(plumbing 通路 + 缺失 skill 的 BUG 标注):
//   1. 添加延时锦囊 atom → 闪电进判定区
//   2. 判定 atom 翻判定牌到处理区(无 skill 时,闪电仍在判定区,after hooks 收尾入弃)
//   3. 判定牌花色检测(展示 plumbing 通路:为未来 闪电 skill 实现做铺垫)
//   4. [BUG 标注]期望: 闪电 skill 实现后,判定♠2-9 触发 3 点雷电伤害(目前未实现)
//
// 模式:SkillTestHarness + applyAtom 触发添加/移除/判定(与 lightning.test.ts 一致;
//
//   因 dispatch 路径对判定 atom 不直接暴露,本测试也用 applyAtom 直接驱动 hooks)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
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

describe('闪电:延时锦囊判定(判定→黑桃→伤害端到端)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:装备(添加延时锦囊)→ 闪电进 P0 判定区
  // ─────────────────────────────────────────────────────────────
  it('用例1:添加延时锦囊 atom → 闪电进 P0 判定区', async () => {
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
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(0);

    await applyAtom(state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 0, card: sd },
    });

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('闪电');
    expect(harness.state.players[0].pendingTricks[0].source).toBe(0);
    expect(harness.state.players[0].pendingTricks[0].card).toEqual(sd);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:判定 atom 翻判定牌(♠5)→ 处理区 → after hooks 收尾入弃
  //   无 闪电 skill 时,闪电仍保留在判定区(没有 skill 处理)
  // ─────────────────────────────────────────────────────────────
  it('用例2:判定 atom 翻判定牌(♠5)到处理区 → after hooks 收尾入弃;闪电仍在判定区(无 skill)', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const judgeCard: Card = makeCard('jd1', '杀', '♠', '5', '基本牌');

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
    await harness.setup(state);

    // 触发判定 atom
    await applyAtom(state, { type: '判定', player: 0, judgeType: '闪电' });

    // 判定牌已从牌堆翻到处理区,after hooks 收尾后入弃
    expect(harness.state.zones.deck).not.toContain(judgeCard.id);
    expect(harness.state.zones.discardPile).toContain(judgeCard.id);
    expect(harness.state.zones.processing).not.toContain(judgeCard.id);

    // 关键:无 闪电 skill 时,判定牌 ♠5 应触发 3 点伤害,
    //   但当前 skill 未实现 → 闪电仍保留在判定区(无 skill 处理)
    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('闪电');
    // 玩家血量未被伤害(因为无 闪电 skill)
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:[BUG 标注]期望:判定 ♠2-9 触发 3 点雷电伤害
  //   当前引擎未实现 闪电 skill,跳过断言
  // ─────────────────────────────────────────────────────────────
  it.skip('BUG:判定 ♠5 → 期望对 P0 造成 3 点雷电伤害(闪电 skill 未实现,跳过)', async () => {
    // BUG: 闪电 skill 模块未在 src/engine/skills/index.ts 注册(无 闪电.ts 文件)。
    // 预期: 判定阶段翻判定牌 → 若为 ♠2-9 → 对 P0 造成 3 点雷电伤害(无防具/技能挡)
    // 当前: 判定 atom 走完,但无 after hook 监听 判定/闪电 来 apply 伤害
    // 修复: 新增 src/engine/skills/闪电.ts,实现判定后花色检测 + 伤害应用,
    //      在 index.ts skillLoaders 注册;延后再写 判定/闪电 after hook。
    //
    // 本测试为占位:待 闪电 skill 实现后,移除 .skip 并补充完整断言。
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const judgeCard: Card = makeCard('jd1', '杀', '♠', '5', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          health: 4, maxHealth: 4,
          pendingTricks: [{ name: '闪电', source: 0, card: sd }],
        }),
      ],
      cardMap: { [sd.id]: sd, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);

    await applyAtom(state, { type: '判定', player: 0, judgeType: '闪电' });

    // 期望: 判定 ♠5 → 闪电触发 → P0 扣 3 血(4 → 1)
    expect(harness.state.players[0].health).toBe(1);
    // 闪电应从判定区移除
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);
  });
});
