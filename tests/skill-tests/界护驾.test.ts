// tests/skill-tests/界护驾.test.ts
// 界护驾(界曹操·主公技)测试:
//   主公技,其他魏势力角色可以在你需要时代替你使用或打出【闪】(视为由你使用或打出);
//   每回合限一次,当其他魏势力角色于其回合外使用或打出【闪】时,
//   其可以令你摸一张牌。
//
// OL 官方。与标护驾区别:
//   - 标护驾:仅主动技(曹操被询问闪 → 魏角色代出闪)。
//   - 界护驾:① 沿用主动技机制;② 新增被动触发——魏角色回合外用闪时可令曹操摸1张。
//
// 验证(主动技):
//   1. 正面:曹操被杀 → 护驾 → 魏势力角色代出闪 → 伤害抵消
//   2. 正面:魏势力角色拒绝 → 曹操受伤
//   3. 负面:无魏势力角色 → 护驾被拒绝
//   4. 负面:非主公(ownerId≠0) → 护驾被拒绝
//
// 验证(新增被动触发):
//   5. 正面:魏角色回合外用闪 → 询问 → 确认 → 曹操摸1张
//   6. 正面:魏角色回合外用闪 → 询问 → 拒绝 → 曹操不摸
//   7. 负面:魏角色自己回合用闪 → 不触发(须回合外)
//   8. 负面:非魏角色用闪 → 不触发
//   9. 负面:每回合限一次(第二次用闪不触发)
//   10. 负面:界曹操非主公位(座次≠0) → 被动不触发
//
// 事实来源:OL 官方 界曹操·护驾
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
  character?: string;
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界曹操',
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
    faction: opts.faction ?? '魏',
  };
}

describe('界护驾', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 主动技:沿用标护驾机制 ──────────────────────────────

  it('主动技:曹操被杀 → 护驾 → 魏势力角色代出闪 → 伤害抵消', async () => {
    // P2(群)攻击 P0(曹操,主公)→ P0 护驾 → P1(魏)代出闪。
    // P1 在 P2 的回合外,代出闪也会触发界护驾被动(询问是否令曹操摸牌)。
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('s1', '闪', '♥', '2');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '界曹操',
          skills: ['界护驾'],
          faction: '魏',
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '张辽',
          hand: ['s1'],
          skills: ['闪'],
          faction: '魏',
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '吕布',
          hand: ['k1'],
          skills: ['杀'],
          faction: '群',
        }),
      ],
      cardMap: { k1: slash, s1: dodge },
      currentPlayerIndex: 2, // P2 的回合 → P1(魏)在回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P2 出杀指定 P0
    await P2.useCardAndTarget('杀', 'k1', [0]);
    await harness.waitForStable();

    // P0 被询问闪
    P0.expectPending('询问闪');

    // P0 发动护驾
    await P0.respond('界护驾', {});
    await harness.waitForStable();

    // P1(魏势力)被询问是否代出闪
    const p1Slot = harness.state.pendingSlots.get(1);
    expect(p1Slot?.atom.type).toBe('请求回应');
    expect((p1Slot?.atom as { requestType?: string }).requestType).toBe('界护驾/出闪');
    await P1.respond('界护驾', { cardId: 's1' });
    await harness.waitForStable();

    // 代出闪会触发界护驾被动(P1 在 P2 回合外用闪)→ 询问 P1 是否令曹操摸1张
    const drawSlot = harness.state.pendingSlots.get(1);
    expect(drawSlot?.atom.type).toBe('请求回应');
    expect((drawSlot?.atom as { requestType?: string }).requestType).toBe('界护驾/drawChoice');
    // P1 拒绝令曹操摸牌
    await P1.respond('界护驾', { choice: false });
    await harness.waitForStable();

    // 闪被移入处理区 → 杀被抵消 → P0 不受伤
    expect(harness.state.players[0].health).toBe(4);
    // P1 的闪已消耗
    expect(harness.state.players[1].hand).not.toContain('s1');
    restoreAutoCompare();
  });

  it('主动技:魏势力角色拒绝 → 曹操受伤', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('s1', '闪', '♥', '2');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '界曹操',
          skills: ['界护驾'],
          faction: '魏',
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '张辽',
          hand: ['k1', 's1'],
          skills: ['杀', '闪'],
          faction: '魏',
        }),
      ],
      cardMap: { k1: slash, s1: dodge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await harness.waitForStable();
    P0.expectPending('询问闪');

    // P0 发动护驾
    await P0.respond('界护驾', {});
    await harness.waitForStable();

    // P1 被询问但拒绝出闪
    const p1Slot = harness.state.pendingSlots.get(1);
    expect(p1Slot?.atom.type).toBe('请求回应');
    await P1.pass();

    // 无人代出闪 → P0 受伤
    expect(harness.state.players[0].health).toBe(3);
    // P1 仍持有闪(未消耗)
    expect(harness.state.players[1].hand).toContain('s1');
    restoreAutoCompare();
  });

  it('负面:无魏势力角色 → 护驾被拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '界曹操',
          skills: ['界护驾'],
          faction: '魏',
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '关羽',
          hand: ['k1'],
          skills: ['杀'],
          faction: '蜀',
        }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await harness.waitForStable();
    P0.expectPending('询问闪');

    // P0 尝试护驾 → 被拒绝(无魏势力角色)
    await P0.expectRejected({
      skillId: '界护驾',
      actionType: 'respond',
      params: {},
    });

    // 护驾被拒绝后,询问闪仍在 → P0 pass
    await P0.pass();
    expect(harness.state.players[0].health).toBe(3);
  });

  it('负面:非主公(ownerId≠0) → 护驾被拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('s1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        // P0 = 张辽(主公位,魏),用杀者
        makePlayer({
          index: 0,
          name: 'P0',
          character: '张辽',
          hand: ['k1', 's1'],
          skills: ['杀', '闪'],
          faction: '魏',
        }),
        // P1 = 界曹操,座次 1(非主公位)
        makePlayer({
          index: 1,
          name: 'P1',
          character: '界曹操',
          skills: ['界护驾'],
          faction: '魏',
        }),
      ],
      cardMap: { k1: slash, s1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 出杀指定 P1
    await P0.useCardAndTarget('杀', 'k1', [1]);
    await harness.waitForStable();
    P1.expectPending('询问闪');

    // P1(界曹操,非主公)尝试护驾 → 被拒绝
    await P1.expectRejected({
      skillId: '界护驾',
      actionType: 'respond',
      params: {},
    });

    // 护驾被拒绝后,P1 pass
    await P1.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 新增被动触发:魏角色回合外用闪 ──────────────────────────

  it('被动:魏角色回合外用闪 → 确认 → 曹操摸1张', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const draw = makeCard('draw1', '杀', '♠', '3');
    // 模拟魏角色(P1)用的闪
    const dodge = makeCard('s1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        // P0 = 界曹操(主公位,魏),空手便于断言摸牌
        makePlayer({
          index: 0,
          name: '界曹操',
          skills: ['界护驾'],
          faction: '魏',
        }),
        // P1 = 魏势力角色(张辽),用闪者
        makePlayer({
          index: 1,
          name: '张辽',
          hand: ['s1'],
          skills: ['闪'],
          faction: '魏',
        }),
      ],
      cardMap: { draw1: draw, s1: dodge },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, // 曹操回合 → P1 在回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接 applyAtom 移动闪到处理区,模拟 P1 在 P0 回合外用闪
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 's1',
      from: { zone: '手牌', player: 1 },
      to: { zone: '处理区' },
    });
    await harness.waitForStable();

    // 触发界护驾询问:询问 P1 是否令曹操摸1张
    const slot = harness.state.pendingSlots.get(1);
    expect(slot?.atom.type).toBe('请求回应');
    expect((slot?.atom as { requestType?: string }).requestType).toBe('界护驾/drawChoice');

    await harness.player('张辽').respond('界护驾', { choice: true });
    await harness.waitForStable();

    // 曹操摸1张
    expect(harness.state.players[0].hand).toEqual(['draw1']);
    expect(harness.state.zones.deck).toEqual([]);
    restoreAutoCompare();
  });

  it('被动:魏角色回合外用闪 → 拒绝 → 曹操不摸', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const draw = makeCard('draw1', '杀', '♠', '3');
    const dodge = makeCard('s1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界曹操', skills: ['界护驾'], faction: '魏' }),
        makePlayer({
          index: 1,
          name: '张辽',
          hand: ['s1'],
          skills: ['闪'],
          faction: '魏',
        }),
      ],
      cardMap: { draw1: draw, s1: dodge },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 's1',
      from: { zone: '手牌', player: 1 },
      to: { zone: '处理区' },
    });
    await harness.waitForStable();

    await harness.player('张辽').respond('界护驾', { choice: false });
    await harness.waitForStable();

    // 拒绝:曹操不摸牌,牌堆未变
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['draw1']);
    restoreAutoCompare();
  });

  it('负面:魏角色自己回合用闪 → 不触发(须回合外)', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const dodge = makeCard('s1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界曹操', skills: ['界护驾'], faction: '魏' }),
        makePlayer({
          index: 1,
          name: '张辽',
          hand: ['s1'],
          skills: ['闪'],
          faction: '魏',
        }),
      ],
      cardMap: { s1: dodge },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1, // P1(张辽)的回合 → P1 在自己回合内 → 不触发
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 's1',
      from: { zone: '手牌', player: 1 },
      to: { zone: '处理区' },
    });
    await harness.waitForStable();

    // 不触发:无 pending 询问
    expect(harness.state.pendingSlots.size).toBe(0);
    restoreAutoCompare();
  });

  it('负面:非魏角色用闪 → 不触发', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const dodge = makeCard('s1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界曹操', skills: ['界护驾'], faction: '魏' }),
        // P1 = 蜀势力角色(非魏)
        makePlayer({
          index: 1,
          name: '关羽',
          hand: ['s1'],
          skills: ['闪'],
          faction: '蜀',
        }),
      ],
      cardMap: { s1: dodge },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0, // 曹操回合,P1 在回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 's1',
      from: { zone: '手牌', player: 1 },
      to: { zone: '处理区' },
    });
    await harness.waitForStable();

    // 非魏角色 → 不触发:无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    restoreAutoCompare();
  });

  it('负面:每回合限一次(第二次用闪不触发)', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const draw = makeCard('draw1', '杀', '♠', '3');
    const dodge1 = makeCard('s1', '闪', '♥', '2');
    const dodge2 = makeCard('s2', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界曹操', skills: ['界护驾'], faction: '魏' }),
        // 两个魏角色,各自用闪
        makePlayer({
          index: 1,
          name: '张辽',
          hand: ['s1'],
          skills: ['闪'],
          faction: '魏',
        }),
        makePlayer({
          index: 2,
          name: '夏侯惇',
          hand: ['s2'],
          skills: ['闪'],
          faction: '魏',
        }),
      ],
      cardMap: { draw1: draw, s1: dodge1, s2: dodge2 },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 第一次:P1(张辽)回合外用闪 → 触发
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 's1',
      from: { zone: '手牌', player: 1 },
      to: { zone: '处理区' },
    });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(1);
    // 张辽拒绝
    await harness.player('张辽').respond('界护驾', { choice: false });
    await harness.waitForStable();

    // 第二次:P2(夏侯惇)回合外用闪 → 不触发(每回合限一次)
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 's2',
      from: { zone: '手牌', player: 2 },
      to: { zone: '处理区' },
    });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);

    // 曹操未摸牌
    expect(harness.state.players[0].hand).toEqual([]);
    restoreAutoCompare();
  });

  it('负面:界曹操非主公位(座次≠0) → 被动不触发', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const dodge = makeCard('s1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        // P0 = 张辽(魏),用闪者;占据座次 0
        makePlayer({
          index: 0,
          name: '张辽',
          hand: ['s1'],
          skills: ['闪'],
          faction: '魏',
        }),
        // P1 = 界曹操,座次 1(非主公位)
        makePlayer({ index: 1, name: '界曹操', skills: ['界护驾'], faction: '魏' }),
        // P2 = 当前回合角色(让 P0 在回合外)
        makePlayer({ index: 2, name: '路人', skills: [], faction: '群' }),
      ],
      cardMap: { s1: dodge },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 2, // 路人回合 → 张辽在回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 's1',
      from: { zone: '手牌', player: 0 },
      to: { zone: '处理区' },
    });
    await harness.waitForStable();

    // 界曹操不在主公位 → 不触发:无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    restoreAutoCompare();
  });
});
