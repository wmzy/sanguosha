// 系统规则(系统级):注册引擎级 after hooks——判定清理、技能生命周期、濒死流程。
// 以及选将/弃牌 respond action(注册到每个玩家座次)。
//
// 注意:系统规则不在 skillLoaders 中,player.skills 不应包含 '系统规则'。
// 它的 respond action 由 registerSkillsFromState 自动注册。
//
// 验证:
//   1. 正面:弃牌阶段 respond → 弃牌入弃牌堆
//   2. 正面:濒死求桃流程(造成伤害 → health≤0 → 濒死 → 求桃 → 出桃救援)
//   3. 正面:濒死无人救 → 击杀
//   4. 负面:非弃牌窗口 respond 被拒绝
//   5. 负面:空 cardIds 被拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import { findActionEntry } from '../../src/engine/skill';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('系统规则', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:弃牌阶段 respond → 弃牌入弃牌堆 ────────────────────

  it('正面:弃牌阶段 respond → 选定的牌进弃牌堆', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const c3 = makeCard('c3', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2', 'c3'], skills: [] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { c1, c2, c3 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 手动设置 __弃牌 pending(模拟弃牌阶段)
    harness.state.pendingSlots.set(0, {
      atom: {
        type: '请求回应',
        requestType: '__弃牌',
        target: 0,
        prompt: { type: 'useCard', title: '弃牌阶段', cardFilter: { filter: () => true, min: 2, max: 2 } },
        timeout: 30,
      },
      definition: {} as never,
      startTime: Date.now(),
      deadline: Date.now() + 30000,
      isBlocking: true,
      createdSeq: harness.state.seq,
      resolve: () => {},
      pause: () => {},
      isTimeout: false,
    });

    // P0 弃 c1 和 c2
    await P0.respond('系统规则', { cardIds: ['c1', 'c2'] });

    // 弃牌入弃牌堆
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'c2']));
    // c3 仍在手牌
    expect(harness.state.players[0].hand).toEqual(['c3']);
    // pending 已消费
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 正面:濒死求桃流程 ───────────────────────────────────────

  it('正面:造成伤害使目标 health≤0 → 濒死 → 求桃 → 出桃救援', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const peach = makeCard('p1', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['杀', '桃', '闪', '酒'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1'],
          skills: ['杀', '桃', '闪', '酒'],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash, p1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 出杀 → P1(HP=1)
    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 不出闪(手牌只有桃)
    await P1.pass();

    // P1 HP=0 → 系统规则造成伤害 after hook 触发濒死
    expect(harness.state.players[1].health).toBe(0);

    // 濒死流程:陷入濒死 → 求桃 pending
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slotAtom = [...harness.state.pendingSlots.values()][0].atom as {
      type?: string;
      requestType?: string;
    };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('桃/求桃');

    // P1 出桃救援
    await P1.respond('桃', { cardId: 'p1' });

    // P1 回复 1 点体力
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[1].alive).toBe(true);
    // 桃进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p1');
    restoreAutoCompare();
  });

  // ─── 正面:濒死无人救 → 击杀 ─────────────────────────────────

  it('正面:濒死无人救 → 击杀(死亡)', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪 → HP=0 → 濒死 → 求桃(P1)

    // P1 HP=0 → 濒死
    expect(harness.state.players[1].health).toBe(0);

    // 求桃循环:从濒死者(P1)开始,依次询问每个存活玩家
    // P1 被问 → P1 pass(不救自己)
    await P1.pass();
    // P0 被问 → P0 pass(不救 P1)
    await P0.pass();

    // 无人救 → 击杀
    expect(harness.state.players[1].alive).toBe(false);
    restoreAutoCompare();
  });

  // ─── Bug:求桃 prompt 从 confirm 改为 useCard ─────────────────
  // 原求桃用 confirm prompt(confirmLabel='出桃'),点"出桃"传 {choice:true} 无 cardId,
  // 桃.respond validate 不检查 cardId 可绕过,但 apply 不设救援标志 → 点了无法真正救援;
  // 且 confirm 不校验手牌,没桃也能点。改为 useCard prompt + cardFilter(桃/酒/急救红牌),
  // 没手牌则无可点高亮牌,手牌区只能点真实可救援的牌。

  it('Bug:求桃 pending 为 useCard 类型,cardFilter 只匹配桃/酒/急救红牌', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['杀', '桃', '闪', '酒'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['杀', '桃', '闪', '酒'],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // P1 HP=0 → 濒死 → 求桃 pending(P1 先被问)
    expect(harness.state.players[1].health).toBe(0);

    const slot = [...harness.state.pendingSlots.values()][0];
    const prompt = (slot.atom as { prompt: { type: string; cardFilter?: { filter?: (c: Card) => boolean } } }).prompt;
    // prompt 应为 useCard(原为 confirm)
    expect(prompt.type).toBe('useCard');
    // cardFilter 匹配桃、酒;不匹配杀/闪
    const filter = prompt.cardFilter?.filter!;
    expect(filter(makeCard('p', '桃', '♥'))).toBe(true);
    expect(filter(makeCard('w', '酒', '♠'))).toBe(true);
    expect(filter(makeCard('s', '杀', '♠'))).toBe(false);
    expect(filter(makeCard('d', '闪', '♦'))).toBe(false);
    restoreAutoCompare();
  });

  it('Bug:无手牌玩家被求桃时,confirm choice:true 不再误触发救援', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const peach = makeCard('p1', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1', 'p1'],
          skills: ['杀', '桃', '闪', '酒'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: slash, p1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // P1 HP=0 → 濒死 → 求桃先问 P1(无手牌)
    expect(harness.state.players[1].health).toBe(0);

    // P1 无手牌:旧 confirm 下点"出桃"传 {choice:true} 会误设救援标志;
    // 新 useCard 下 P1.respond 必须传 cardId,P1 无手牌无法响应 → pass 不救
    await P1.pass();
    // P0 有桃 → 出桃救 P1
    await P0.respond('桃', { cardId: 'p1' });
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[1].alive).toBe(true);
    restoreAutoCompare();
  });

  // ─── 负面:非弃牌窗口 respond 被拒绝 ──────────────────────────

  it('负面:无 pending 时弃牌 respond 被拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: [] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 无 pending → respond 被拒绝
    await P0.expectRejected({
      skillId: '系统规则',
      actionType: 'respond',
      params: { cardIds: ['c1'] },
    });
  });

  // ─── 负面:空 cardIds 被拒绝 ──────────────────────────────────

  it('负面:弃牌阶段提交空 cardIds → validate 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], skills: [] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);

    // 手动设置 __弃牌 pending
    harness.state.pendingSlots.set(0, {
      atom: {
        type: '请求回应',
        requestType: '__弃牌',
        target: 0,
        prompt: { type: 'useCard', title: '弃牌阶段', cardFilter: { filter: () => true, min: 1, max: 1 } },
        timeout: 30,
      },
      definition: {} as never,
      startTime: Date.now(),
      deadline: Date.now() + 30000,
      isBlocking: true,
      createdSeq: harness.state.seq,
      resolve: () => {},
      pause: () => {},
      isTimeout: false,
    });

    // 直接调 validate 检查空 cardIds 被拒
    const entry = findActionEntry(harness.state, '系统规则', 0, 'respond')!;
    expect(entry).toBeDefined();
    const error = entry.validate(harness.state, { cardIds: [] });
    expect(error).not.toBeNull();
    expect(error).toBe('不能弃 0 张牌');

    // 合法的 cardIds 仍应通过
    const ok = entry.validate(harness.state, { cardIds: ['c1'] });
    expect(ok).toBeNull();
  });
});
