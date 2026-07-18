// tests/skill-tests/界激将.test.ts
// 界激将(界刘备·主公技)测试:
//   主公技,其他蜀势力角色可以在你需要时使用或打出【杀】(视为由你使用或打出);
//   每回合限一次,其他蜀势力角色于其回合外使用、打出或替你使用或打出【杀】时,
//   其可以令你摸一张牌。
//
// OL 官方。与标激将区别:
//   - 标激将:仅主动技(主公 dispatch → 蜀角色出/不出杀)。
//   - 界激将:① 沿用主动技机制;② 新增被动触发——蜀角色回合外用杀时可令主公摸1张。
//
// 验证(主动技):
//   1. 正面:主公激将 → 蜀势力角色出杀 → killTarget 扣血
//   2. 正面:蜀势力角色不出杀 → 主公摸 1 张
//   3. 负面:非主公(ownerId≠0)不能使用
//   4. 负面:目标非蜀势力 → 拒绝
//
// 验证(新增被动触发):
//   5. 正面:蜀角色回合外用杀 → 询问 → 确认 → 主公摸1张
//   6. 正面:蜀角色回合外用杀 → 询问 → 拒绝 → 主公不摸
//   7. 负面:蜀角色自己回合用杀 → 不触发(须回合外)
//   8. 负面:非蜀角色用杀 → 不触发
//   9. 负面:每回合限一次(第二次用杀不触发)
//   10. 负面:界刘备非主公位(座次≠0) → 被动不触发
//
// 事实来源:OL 官方 界刘备·激将
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, Faction, GameState, PlayerState } from '../../src/engine/types';

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
  faction?: Faction;
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
    faction: opts.faction,
  };
}

describe('界激将', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 主动技:沿用标激将机制 ──────────────────────────────

  it('主动技:主公激将 → 蜀势力角色出杀 → killTarget 扣血', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['杀'], faction: '蜀' }),
        makePlayer({ index: 2, name: 'P2', skills: ['闪'], faction: '群' }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    // P0(主公）发动激将，请求 P1（蜀）出杀指定 P2
    await P0.triggerAction('界激将', 'use', { target: 1, killTarget: 2 });

    // P1 被询问是否出杀
    const slot = harness.state.pendingSlots.get(1);
    expect(slot?.atom.type).toBe('请求回应');
    expect((slot?.atom as { requestType?: string }).requestType).toBe('杀/respondKill');

    // P1 出杀
    await harness.player('P1').respond('杀', { cardId: 'k1' });

    // 出杀后触发界激将被动（P1 回合外用杀）→ 询问 P1 是否令主公摸1张
    const drawSlot = harness.state.pendingSlots.get(1);
    expect(drawSlot?.atom.type).toBe('请求回应');
    expect((drawSlot?.atom as { requestType?: string }).requestType).toBe('界激将/drawChoice');
    // P1 拒绝令主公摸牌（避免影响后续新掉流程的 pending 检查）
    await harness.player('P1').respond('界激将', { choice: false });

    // P2 被询问闪
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    // P2 扣1血
    expect(harness.state.players[2].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('k1');
    restoreAutoCompare();
  });

  it('主动技:蜀势力角色不出杀 → 主公摸 1 张', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['杀'], faction: '蜀' }),
        makePlayer({ index: 2, name: 'P2', skills: [], faction: '群' }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length;
    await P0.triggerAction('界激将', 'use', { target: 1 });

    await P1.pass(); // 不出杀

    // 主公摸 1 张
    expect(harness.state.players[0].hand.length).toBe(handBefore + 1);
    // P1 的杀未消耗
    expect(harness.state.players[1].hand).toContain('k1');
  });

  it('负面:非主公(ownerId≠0)使用界激将 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: [], faction: '蜀' }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['界激将', '杀'],
          faction: '蜀',
        }),
        makePlayer({ index: 2, name: 'P2', skills: [], faction: '蜀' }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界激将',
      actionType: 'use',
      params: { target: 2, killTarget: 0 },
    });
  });

  it('负面:目标非蜀势力 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'], faction: '魏' }),
        makePlayer({ index: 2, name: 'P2', skills: [], faction: '群' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界激将',
      actionType: 'use',
      params: { target: 1, killTarget: 2 },
    });
  });

  // ─── 新增被动触发:蜀角色回合外用杀 ──────────────────────────

  it('被动:蜀角色回合外用杀 → 确认 → 主公摸1张', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const draw = makeCard('draw1', '杀', '♠', '3');
    // 模拟蜀角色(P1)用杀的卡
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // P0 = 界刘备(主公位,蜀),空手便于断言摸牌
        makePlayer({
          index: 0,
          name: '界刘备',
          skills: ['界激将'],
          faction: '蜀',
        }),
        // P1 = 蜀势力角色(关羽),用杀者
        makePlayer({
          index: 1,
          name: '关羽',
          hand: ['s1'],
          skills: ['杀'],
          faction: '蜀',
        }),
        // P2 = 杀的目标(群势力),有闪防止死亡影响流程
        makePlayer({ index: 2, name: '张角', hand: [], skills: [], faction: '群' }),
      ],
      cardMap: { draw1: draw, s1: slash },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, // 刘备的回合 → P1 在回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接 applyAtom 指定目标,模拟 P1 在 P0 回合外用杀
    void applyAtom(harness.state, {
      type: '指定目标',
      source: 1,
      target: 2,
      cardId: 's1',
    });
    await harness.waitForStable();

    // 触发界激将询问:询问 P1 是否令主公摸1张
    const slot = harness.state.pendingSlots.get(1);
    expect(slot?.atom.type).toBe('请求回应');
    expect((slot?.atom as { requestType?: string }).requestType).toBe('界激将/drawChoice');

    await harness.player('关羽').respond('界激将', { choice: true });
    await harness.waitForStable();

    // 主公(刘备)摸1张
    expect(harness.state.players[0].hand).toEqual(['draw1']);
    expect(harness.state.zones.deck).toEqual([]);
    restoreAutoCompare();
  });

  it('被动:蜀角色回合外用杀 → 拒绝 → 主公不摸', async () => {
    const draw = makeCard('draw1', '杀', '♠', '3');
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界刘备', skills: ['界激将'], faction: '蜀' }),
        makePlayer({
          index: 1,
          name: '关羽',
          hand: ['s1'],
          skills: ['杀'],
          faction: '蜀',
        }),
        makePlayer({ index: 2, name: '张角', skills: [], faction: '群' }),
      ],
      cardMap: { draw1: draw, s1: slash },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '指定目标', source: 1, target: 2, cardId: 's1' });
    await harness.waitForStable();

    await harness.player('关羽').respond('界激将', { choice: false });
    await harness.waitForStable();

    // 拒绝:主公不摸牌,牌堆未变
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['draw1']);
  });

  it('负面:蜀角色自己回合用杀 → 不触发(须回合外)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界刘备', skills: ['界激将'], faction: '蜀' }),
        makePlayer({
          index: 1,
          name: '关羽',
          hand: ['s1'],
          skills: ['杀'],
          faction: '蜀',
        }),
        makePlayer({ index: 2, name: '张角', skills: [], faction: '群' }),
      ],
      cardMap: { s1: slash },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1, // P1(关羽)的回合 → P1 在自己回合内 → 不触发
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '指定目标', source: 1, target: 2, cardId: 's1' });
    await harness.waitForStable();

    // 不触发:无 pending 询问
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('负面:非蜀角色用杀 → 不触发', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界刘备', skills: ['界激将'], faction: '蜀' }),
        // P1 = 魏势力角色(非蜀)
        makePlayer({
          index: 1,
          name: '夏侯惇',
          hand: ['s1'],
          skills: ['杀'],
          faction: '魏',
        }),
        makePlayer({ index: 2, name: '张角', skills: [], faction: '群' }),
      ],
      cardMap: { s1: slash },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0, // 刘备回合,P1 在回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '指定目标', source: 1, target: 2, cardId: 's1' });
    await harness.waitForStable();

    // 非蜀角色 → 不触发:无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('负面:每回合限一次(第二次用杀不触发)', async () => {
    const draw = makeCard('draw1', '杀', '♠', '3');
    const slash1 = makeCard('s1', '杀', '♠', '7');
    const slash2 = makeCard('s2', '杀', '♠', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界刘备', skills: ['界激将'], faction: '蜀' }),
        // 两个蜀角色,会各自用杀
        makePlayer({
          index: 1,
          name: '关羽',
          hand: ['s1'],
          skills: ['杀'],
          faction: '蜀',
        }),
        makePlayer({
          index: 2,
          name: '张飞',
          hand: ['s2'],
          skills: ['杀'],
          faction: '蜀',
        }),
        makePlayer({ index: 3, name: '目标', skills: [], faction: '群' }),
      ],
      cardMap: { draw1: draw, s1: slash1, s2: slash2 },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 第一次:P1(关羽)回合外用杀 → 触发
    void applyAtom(harness.state, { type: '指定目标', source: 1, target: 3, cardId: 's1' });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(1);
    // 关羽拒绝
    await harness.player('关羽').respond('界激将', { choice: false });
    await harness.waitForStable();

    // 第二次:P2(张飞)回合外用杀 → 不触发(每回合限一次)
    void applyAtom(harness.state, { type: '指定目标', source: 2, target: 3, cardId: 's2' });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);

    // 主公未摸牌
    expect(harness.state.players[0].hand).toEqual([]);
  });

  it('负面:界刘备非主公位(座次≠0) → 被动不触发', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // P0 = 关羽(蜀),用杀者;占据座次 0
        makePlayer({
          index: 0,
          name: '关羽',
          hand: ['s1'],
          skills: ['杀'],
          faction: '蜀',
        }),
        // P1 = 界刘备,座次 1(非主公位)
        makePlayer({ index: 1, name: '界刘备', skills: ['界激将'], faction: '蜀' }),
        makePlayer({ index: 2, name: '张角', skills: [], faction: '群' }),
      ],
      cardMap: { s1: slash },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1, // 界刘备回合 → 关羽在回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '指定目标', source: 0, target: 2, cardId: 's1' });
    await harness.waitForStable();

    // 界刘备不在主公位 → 不触发:无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
