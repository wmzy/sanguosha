// 界窃听(界蔡夫人·群·被动技)测试:
//   其他角色的回合结束后,若其本回合未对其他角色造成伤害,你可以选择一项;
//   若其本回合未对其他角色使用过牌,你可以选择两项;
//   1.将其装备区里的一张牌置入你的装备区;2.摸一张牌。
//
// choices 计算(渐进式):
//   noDamage ? (noCardUse ? 2 : 1) : 0
//   - 造伤 → 不触发(0 项)
//   - 未造伤但用过牌 → 1 项
//   - 未造伤且未用牌 → 2 项
//
// 验证:
//   1. happy path 2 项(无伤害无使用):夺装备 + 摸牌都执行
//   2. happy path 1 项(无伤害有用牌):选摸牌 → 摸 1 张
//   3. happy path 1 项(无伤害有用牌):选夺装备 → 夺一张装备置入 owner 装备区
//   4. 造伤 → 不触发(0 项)
//   5. owner 自己回合结束 → 不触发
//   6. owner 选不发动 → 无事发生
//   7. 1 项时无装备可夺 → 强制摸牌
//   8. 夺装备替换 owner 同槽位装备(旧装备入弃牌堆)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeWeapon(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  range: number,
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype: '武器', range };
}

function makeArmor(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
): Card {
  return { id, name, suit, color: suitColor(suit), rank: 'A', type: '装备牌', subtype: '防具' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: PlayerState['equipment'];
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界蔡夫人',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界献州', '界窃听'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发 player 的 回合结束 atom(窃听 before-hook 在此时触发)。 */
async function triggerTurnEnd(harness: SkillTestHarness, player: number): Promise<void> {
  void applyAtom(harness.state, { type: '回合结束', player });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界窃听', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path 2 项(无伤害无使用):夺装备 + 摸牌 ────
  it('2 项(未造伤未用牌):发动 → 夺装备 + 摸牌', async () => {
    const armor = makeArmor('a1', '八卦阵', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          equipment: { 防具: 'a1' },
        }),
      ],
      cardMap: { a1: armor },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 本回合未造伤、未用牌:直接结束回合
    await triggerTurnEnd(harness, 1);

    // P0 被问是否发动窃听(2 项)
    P0.expectPending('请求回应');
    await P0.respond('界窃听', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 2 项 = 自动执行两项(有装备时夺装备 + 摸牌)
    // 夺装备:弹选牌面板
    P0.expectPending('请求回应');
    await P0.respond('界窃听', { zone: 'equipment', cardId: 'a1' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 验证:a1 已转入 P0 装备区,P0 摸了 1 张牌
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
    expect(harness.state.players[0].equipment['防具']).toBe('a1');
    // P0 起始手牌 0,摸 1 → 1
    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 2. happy path 1 项(无伤害有用牌):选摸牌 ────
  it('1 项(未造伤有用牌):选摸牌 → 摸 1 张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          equipment: { 防具: 'a1' },
        }),
      ],
      cardMap: { a1: makeArmor('a1', '八卦阵', '♥') },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 本回合对 P0 用过牌(指定目标),未造伤
    void applyAtom(harness.state, { type: '指定目标', source: 1, target: 0 });
    await harness.waitForStable();
    harness.processAllEvents();

    await triggerTurnEnd(harness, 1);

    // P0 被问发动窃听(1 项)
    const P0 = harness.player('P0');
    P0.expectPending('请求回应');
    await P0.respond('界窃听', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 1 项 = 选夺装备 or 摸牌;P1 有装备 → 询问选哪个
    P0.expectPending('请求回应');
    await P0.respond('界窃听', { choice: false }); // 选摸牌
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].hand.length).toBe(1);
    // P1 装备未被夺
    expect(harness.state.players[1].equipment['防具']).toBe('a1');
  });

  // ─── 3. happy path 1 项:选夺装备 ────
  it('1 项:选夺装备 → 装备置入 owner 装备区', async () => {
    const armor = makeArmor('a1', '八卦阵', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          equipment: { 防具: 'a1' },
        }),
      ],
      cardMap: { a1: armor },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 用过牌(P0 为目标)
    void applyAtom(harness.state, { type: '指定目标', source: 1, target: 0 });
    await harness.waitForStable();
    harness.processAllEvents();

    await triggerTurnEnd(harness, 1);

    const P0 = harness.player('P0');
    await P0.respond('界窃听', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 选夺装备
    P0.expectPending('请求回应');
    await P0.respond('界窃听', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 选 P1 的 a1
    P0.expectPending('请求回应');
    await P0.respond('界窃听', { zone: 'equipment', cardId: 'a1' });
    await harness.waitForStable();
    harness.processAllEvents();

    // a1 已转入 P0 装备区
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
    expect(harness.state.players[0].equipment['防具']).toBe('a1');
    // 选夺装备时未摸牌
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 4. P1 造伤 → 不触发 ───────────────────────────────
  it('P1 本回合对其他角色造伤 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 对 P0 造伤
    void applyAtom(harness.state, { type: '造成伤害', target: 0, amount: 1, source: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    await triggerTurnEnd(harness, 1);

    // 无 pending(窃听未触发)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 5. owner 自己回合结束 → 不触发 ────────────────────
  it('owner 自己回合结束 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await triggerTurnEnd(harness, 0);

    // 窃听未触发:P0 无询问(可能因下家回合启动而有 pending,但不在 P0 上)
    expect(harness.state.pendingSlots.get(0)).toBeUndefined();
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 6. owner 选不发动 ────────────────────────────────
  it('owner 选不发动 → 无事发生', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await triggerTurnEnd(harness, 1);

    const P0 = harness.player('P0');
    P0.expectPending('请求回应');
    await P0.respond('界窃听', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 7. 1 项时无装备可夺 → 强制摸牌 ────────────────────
  it('1 项时 P1 无装备 → 直接摸牌(跳过选)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 用过牌(P0 为目标),无造伤
    void applyAtom(harness.state, { type: '指定目标', source: 1, target: 0 });
    await harness.waitForStable();
    harness.processAllEvents();

    await triggerTurnEnd(harness, 1);

    const P0 = harness.player('P0');
    await P0.respond('界窃听', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无需再问(无装备可夺),直接摸牌
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 8. 夺装备替换 owner 同槽位旧装备 ──────────────────
  it('夺装备替换 owner 同槽位旧装备(旧装备入弃牌堆)', async () => {
    const p1Armor = makeArmor('a1', '八卦阵', '♥');
    const p0OldArmor = makeArmor('a0', '仁王盾', '♠');
    const state: GameState = createGameState({
      players: [
        // P0 已有防具
        makePlayer({ index: 0, name: 'P0', hand: [], equipment: { 防具: 'a0' } }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          equipment: { 防具: 'a1' },
        }),
      ],
      cardMap: { a0: p0OldArmor, a1: p1Armor },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await triggerTurnEnd(harness, 1);

    const P0 = harness.player('P0');
    await P0.respond('界窃听', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 2 项 → 夺装备 + 摸牌。夺装备选 a1
    P0.expectPending('请求回应');
    await P0.respond('界窃听', { zone: 'equipment', cardId: 'a1' });
    await harness.waitForStable();
    harness.processAllEvents();

    // a1 在 P0 装备区(替换了 a0),a0 进弃牌堆
    expect(harness.state.players[0].equipment['防具']).toBe('a1');
    expect(harness.state.zones.discardPile).toContain('a0');
    // 摸牌(2 项的第二项)
    expect(harness.state.players[0].hand.length).toBe(1);
  });
});
