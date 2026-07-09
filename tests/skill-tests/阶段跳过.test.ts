// tests/skill-tests/阶段跳过.test.ts
// 阶段跳过机制(skipPhase)集成测试。
//
// 验证经 skipPhase 标准化后,各技能的阶段跳过在「回合管理」驱动的完整阶段链中正确联动:
//   1. 兵粮寸断判定生效 → 跳过摸牌阶段 → 出牌阶段正常可用(可出杀)
//   2. 神速选项1 → 跳过判定+摸牌 → 出牌阶段正常可用(可出杀)
//   3. 多个跳过效果叠加:兵粮寸断(跳过摸牌)+ 乐不思蜀(跳过出牌)同时生效
//
// 这些测试覆盖 skipPhase 的两种用法:
//   - 标签型 skipPhase(state, atom, tag):兵粮寸断/乐不思蜀/神速标签跳过
//   - 直接型 skipPhase(state, atom):神速①当场跳过判定
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  tags?: string[];
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '默认',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: opts.tags ?? [],
    judgeZone: [],
  };
}

describe('阶段跳过 skipPhase 集成', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 兵粮寸断:判定生效(非梅花)→ 跳过摸牌 → 出牌阶段正常可用
  //    模拟判定生效后状态:P2 带「兵粮寸断/跳过摸牌」标签,从判定阶段末推进。
  //    期望:摸牌被 cancel+跳过(不摸牌,牌堆不减少),出牌阶段可达且可正常出杀。
  // ─────────────────────────────────────────────────────────────
  it('兵粮寸断:跳过摸牌阶段,出牌阶段正常可出杀', async () => {
    const sha = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['闪', '回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['s1'],
          skills: ['兵粮寸断', '杀', '回合管理'],
          tags: ['兵粮寸断/跳过摸牌'],
        }),
      ],
      cardMap: { s1: sha },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    const handBefore = harness.state.players[1].hand.length;
    const deckBefore = harness.state.zones.deck.length;

    // 判定阶段结束 → 回合管理推进:摸牌被兵粮寸断 cancel+跳过 → 出牌
    void applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '判定' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 摸牌阶段被跳过:手牌未增加,牌堆未减少
    expect(harness.state.players[1].hand.length).toBe(handBefore);
    expect(harness.state.zones.deck.length).toBe(deckBefore);
    // 跳过标签已清除(避免下回合重复触发)
    expect(harness.state.players[1].tags).not.toContain('兵粮寸断/跳过摸牌');
    // 阶段推进到出牌(未 soft-lock)
    expect(harness.state.phase).toBe('出牌');

    // 出牌阶段正常可用:P2 出杀打 P1
    // (关闭视图自检:出牌窗口 IIFE 与增量视图存在已知时序竞争,非引擎 bug)
    const restoreCompare = disableAutoCompare();
    try {
      await P2.useCardAndTarget('杀', 's1', [0]);
      // P1 不出闪
      await harness.player('P1').pass();
    } finally {
      restoreCompare();
    }

    // P1 受 1 点伤害 → 出牌阶段功能正常
    expect(harness.state.players[0].health).toBe(3);
    // 杀进入弃牌堆
    expect(harness.state.zones.discardPile).toContain('s1');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 神速选项1:跳过判定 + 摸牌 → 出牌阶段正常可用
  //    从判定阶段开始触发神速①,验证:判定被直接跳过、摸牌被标签跳过、
  //    出牌阶段可达且仍可正常出杀(神速的虚拟杀不消耗手牌/不占出杀次数)。
  // ─────────────────────────────────────────────────────────────
  it('神速①:跳过判定+摸牌,出牌阶段正常可出杀', async () => {
    const sha = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['s1'],
          skills: ['神速', '杀', '回合管理'],
          character: '夏侯渊',
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪', '回合管理'], character: '曹操' }),
      ],
      cardMap: { s1: sha },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const handBefore = harness.state.players[0].hand.length;
    const deckBefore = harness.state.zones.deck.length;

    // 触发判定阶段 → 神速①询问
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await harness.waitForStable();
    P1.expectPending('请求回应');
    // 发动神速①
    await P1.respond('神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // 选目标 P2
    P1.expectPending('请求回应');
    await P1.respond('神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();
    // 虚拟杀:P2 被询问闪 → 不闪
    P2.expectPending('询问闪');
    await P2.pass();
    await harness.waitForStable();
    harness.processAllEvents();

    // 神速①虚拟杀:P2 受 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
    // 判定被直接跳过(skipPhase 直接型)+ 摸牌被标签跳过(skipPhase 标签型)
    expect(harness.state.players[0].tags).not.toContain('神速/跳过摸牌');
    expect(harness.state.players[0].hand.length).toBe(handBefore); // 未摸牌
    expect(harness.state.zones.deck.length).toBe(deckBefore); // 牌堆未减少
    // 阶段推进到出牌(未 soft-lock)
    expect(harness.state.phase).toBe('出牌');

    // 出牌阶段正常可用:P1 仍可出杀(神速虚拟杀不占次数、不消耗手牌)
    // (关闭视图自检:出牌窗口 IIFE 与增量视图存在已知时序竞争,非引擎 bug)
    const restoreCompare = disableAutoCompare();
    try {
      await P1.useCardAndTarget('杀', 's1', [1]);
      await P2.pass();
    } finally {
      restoreCompare();
    }
    // P2 再次受 1 点伤害 → 出牌阶段功能正常
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 多个跳过效果叠加:兵粮寸断(跳过摸牌)+ 乐不思蜀(跳过出牌)同时生效
  //    P2 同时携带两个跳过标签,从判定阶段末推进。
  //    期望:摸牌被兵粮寸断跳过、出牌被乐不思蜀跳过、阶段直达弃牌,两个标签均清除。
  // ─────────────────────────────────────────────────────────────
  it('叠加:兵粮寸断(跳过摸牌)+ 乐不思蜀(跳过出牌)同时生效', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['兵粮寸断', '乐不思蜀', '回合管理'],
          tags: ['兵粮寸断/跳过摸牌', '乐不思蜀/跳过出牌'],
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    const handBefore = harness.state.players[1].hand.length;
    const deckBefore = harness.state.zones.deck.length;

    // 判定阶段结束 → 回合管理推进:
    //   摸牌(兵粮寸断跳过)→ 出牌(乐不思蜀跳过)→ 弃牌
    void applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '判定' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 摸牌被跳过:未摸牌,牌堆未减少
    expect(harness.state.players[1].hand.length).toBe(handBefore);
    expect(harness.state.zones.deck.length).toBe(deckBefore);
    // 出牌被跳过:无出牌窗口 pending(出牌阶段被 cancel,回合管理不启动出牌循环)
    const hasPlayWindow = [...harness.state.pendingSlots.values()].some(
      (s) => (s.atom as { type: string }).type === '出牌窗口',
    );
    expect(hasPlayWindow).toBe(false);
    // 两个跳过标签均清除
    expect(harness.state.players[1].tags).not.toContain('兵粮寸断/跳过摸牌');
    expect(harness.state.players[1].tags).not.toContain('乐不思蜀/跳过出牌');
    // 阶段直达弃牌(摸牌+出牌都被跳过,未 soft-lock)
    expect(harness.state.phase).toBe('弃牌');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 回归:无跳过标签时阶段链正常(摸牌+出牌都进行)
  //    对照组:确认 skipPhase 仅在标签存在时介入,正常回合不受影响。
  // ─────────────────────────────────────────────────────────────
  it('回归:无跳过标签 → 摸牌阶段正常摸 2 张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['兵粮寸断', '回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['兵粮寸断', '乐不思蜀', '回合管理'],
          // 无任何跳过标签
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    const handBefore = harness.state.players[1].hand.length;

    // 判定阶段结束 → 回合管理推进:摸牌(正常摸 2)→ 出牌
    void applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '判定' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 摸牌正常:手牌 +2
    expect(harness.state.players[1].hand.length).toBe(handBefore + 2);
    // 阶段推进到出牌
    expect(harness.state.phase).toBe('出牌');
  });
});
