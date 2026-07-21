// tests/skill-tests/界利驭.test.ts
// 界利驭(界吕布·群·被动技):当你使用【杀】对其他角色造成伤害后,你可以获得其
// 区域里的一张牌;非装备则其摸一张牌,装备则你视为对其指定另一名角色使用决斗。
//
// 覆盖:
//   1. 触发:respond validate 在无 pending 时被拒绝
//   2. 端到端 · 非装备:杀→伤害→confirm→选目标手牌→目标摸 1 张
//   3. 端到端 · 装备:杀→伤害→confirm→选装备→目标选决斗对象→决斗结算
//   4. confirm=false 不发动利驭
//   5. 非【杀】伤害(决斗)不触发利驭
//   6. 杀来源非自己(P0 受到 P1 杀的伤害)不触发利驭
//   7. 两人场景:装备分支无第三者可选 → 跳过决斗,仍正常获牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  alive?: boolean;
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeBasic(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makeEquip(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  subtype = '武器',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype };
}

describe('界利驭', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. respond validate:无 pending 时被拒绝 ─────────────
  it('respond:无 pending → 拒绝', async () => {
    const slash = makeBasic('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['界利驭', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
      ],
      cardMap: { [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界利驭',
      actionType: 'respond',
      params: { choice: true },
    });
  });

  // ─── 2. 端到端 · 非装备:P0 杀 P1 → 利驭 → 选目标手牌 → P1 摸 1 ────
  it('杀→伤害→confirm→选目标手牌→P1 摸 1 张', async () => {
    const slash = makeBasic('k1', '杀', '♠', '7');
    const victimCard = makeBasic('v1', '闪', '♥', '5');
    const drawCard = makeBasic('d1', '杀', '♣', '3');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          skills: ['界利驭', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [victimCard.id],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard, [drawCard.id]: drawCard },
      zones: { deck: [drawCard.id], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪(超时) → 扣血 → 利驭 询问
    await P0.pass();

    // 应有利驭 confirm pending
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('界利驭/confirm');
    expect(slotAtom.target).toBe(0);

    // P0 confirm=true 发动利驭
    await P0.respond('界利驭', { choice: true });

    // confirm 后弹选牌面板(请求回应/界利驭/选牌)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const pickSlot = [...harness.state.pendingSlots.values()][0];
    const pickAtom = pickSlot.atom as { type: string; requestType?: string };
    expect(pickAtom.requestType).toBe('界利驭/选牌');

    // P0 盲选 P1 手牌 hand[0] = victimCard(闪)
    await P0.respond('界利驭', { zone: 'hand', handIndex: 0 });

    // 关键合约:P0 获得该牌(闪为基本牌,非装备)
    expect(harness.state.players[0].hand).toContain(victimCard.id);
    // P1 失去该牌
    expect(harness.state.players[1].hand).not.toContain(victimCard.id);
    // 因非装备 → P1 摸 1 张(摸到 drawCard)
    expect(harness.state.players[1].hand).toContain(drawCard.id);
    expect(harness.state.players[1].hand.length).toBe(1);
  });

  // ─── 3. 端到端 · 装备:P0 杀 P1 → 利驭 → 选装备 → P1 选 P2 → 决斗 ────
  it('杀→伤害→confirm→选装备→P1 选 P2 → 决斗结算(吕布视为对 P2 决斗)', async () => {
    const slash = makeBasic('k1', '杀', '♠', '7');
    const weapon = makeEquip('wp1', '诸葛连弩', '♣', 'A', '武器');

    const state: GameState = createGameState({
      players: [
        // P0 = 界吕布(主公/利驭主),不挂无双以免影响决斗询问双杀
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          skills: ['界利驭', '杀'],
          health: 5,
          maxHealth: 5,
        }),
        // P1 = 受伤目标(只装备一张武器)
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          equipment: { 武器: weapon.id },
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
        // P2 = 决斗对象(空手 → 决斗先手不出杀即输)
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [weapon.id]: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p2HealthBefore = harness.state.players[2].health;

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪 → 扣血 → 利驭 询问
    await P0.pass();

    // P0 confirm 发动利驭
    await P0.respond('界利驭', { choice: true });

    // 选牌面板:P1 只有装备可选 → P0 选装备
    await P0.respond('界利驭', { zone: 'equipment', cardId: weapon.id });

    // 关键合约 1:P0 获得装备牌(入手牌)
    expect(harness.state.players[0].hand).toContain(weapon.id);
    // P1 装备区清空
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();

    // 因装备 → 询问 P1 选决斗对象(此时 pending.target=P1)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const duelSlot = [...harness.state.pendingSlots.values()][0];
    const duelAtom = duelSlot.atom as {
      type: string;
      requestType?: string;
      target?: number;
    };
    expect(duelAtom.requestType).toBe('界利驭/chooseDuelTarget');
    expect(duelAtom.target).toBe(1);

    // P1 选择 P2 作为决斗对象
    await P1.respond('界利驭', { target: 2 });

    // 决斗结算:P2 空手不出杀 → P2 输 → 受 1 伤害(来源 P0)
    // 等待决斗内 询问杀 的 pending 完成
    await P1.pass(); // P2 被询问杀但空手 → 超时 = 不出杀 → P2 输

    expect(harness.state.players[2].health).toBe(p2HealthBefore - 1);
  });

  // ─── 4. confirm=false 不发动 ──────────────────────────────
  it('confirm=false → 不发动利驭,P1 不摸牌,P0 不获牌', async () => {
    const slash = makeBasic('k1', '杀', '♠', '7');
    const victimCard = makeBasic('v1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          skills: ['界利驭', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [victimCard.id],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const p0HandBefore = harness.state.players[0].hand.length;
    const p1HandBefore = harness.state.players[1].hand.length;

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P0.pass(); // P1 不出闪

    // 应有利驭 confirm pending
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string };
    expect(slotAtom.requestType).toBe('界利驭/confirm');

    // P0 confirm=false
    await P0.respond('界利驭', { choice: false });

    // 关键合约:不获牌、不摸牌
    // P0 出了杀所以手牌减 1,但不应从 P1 拿牌
    expect(harness.state.players[0].hand).not.toContain(victimCard.id);
    // P1 手牌不变(只受了伤害,没被获牌也没摸牌)
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore);
    expect(harness.state.players[1].hand).toContain(victimCard.id);
    // P0 出杀后手牌 = p0HandBefore - 1(杀进入处理区/弃牌堆)
    expect(harness.state.players[0].hand.length).toBe(p0HandBefore - 1);
  });

  // ─── 5. 非【杀】伤害不触发利驭 ──────────────────────────
  // 用 决斗(锦囊牌)造成伤害验证:无 confirm pending 弹出
  it('决斗造成的伤害不触发利驭(非杀伤害)', async () => {
    const duel = { ...makeBasic('duel1', '决斗', '♠', 'A'), type: '锦囊牌' as const };
    const slashForDuel = makeBasic('kd1', '杀', '♠', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [duel.id, slashForDuel.id],
          skills: ['界利驭', '决斗', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { [duel.id]: duel, [slashForDuel.id]: slashForDuel },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 对 P1 出决斗(P1 先被询问杀)
    await P0.triggerAction('决斗', 'use', { cardId: duel.id, targets: [1] });
    // 跳过无懈
    await P0.pass();
    // P1 被询问杀 → 空手超时 = 不出杀 → P1 输 → 受 1 伤害(来源 P0,cardId=决斗)
    await P1.pass();

    // 关键合约:决斗伤害后无 利驭 confirm pending(因 cardId 是"决斗"非"杀")
    for (const s of harness.state.pendingSlots.values()) {
      const a = s.atom as { type: string; requestType?: string };
      expect(a.requestType).not.toBe('界利驭/confirm');
    }
    // P1 受到 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 6. 杀来源非自己不触发利驭 ──────────────────────────
  // P1 杀 P0(P0 是界吕布),P0 受到伤害 → P0 的利驭不应触发(source !== ownerId)
  it('P1 杀 P0 → P0 受到伤害 → P0 的利驭不触发(source 非自己)', async () => {
    const slash = makeBasic('k1', '杀', '♠', '7');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界利驭'],
          health: 5,
          maxHealth: 5,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [slash.id],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P1 杀 P0
    await P1.useCardAndTarget('杀', slash.id, [0]);
    // P0 不出闪 → 扣血
    await P0.pass();

    // 关键合约:P0 受到伤害后无 利驭 confirm pending(因 source=P1 ≠ ownerId=P0)
    for (const s of harness.state.pendingSlots.values()) {
      const a = s.atom as { type: string; requestType?: string };
      expect(a.requestType).not.toBe('界利驭/confirm');
    }
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─── 7. 两人场景:装备分支无第三者 → 跳过决斗 ────────────
  it('两人场景:杀→利驭选装备 → 无第三者可选 → 跳过决斗(仍正常获牌)', async () => {
    const slash = makeBasic('k1', '杀', '♠', '7');
    const weapon = makeEquip('wp1', '诸葛连弩', '♣', 'A', '武器');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          skills: ['界利驭', '杀'],
          health: 5,
          maxHealth: 5,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          equipment: { 武器: weapon.id },
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [weapon.id]: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const p1HealthBefore = harness.state.players[1].health;

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P0.pass(); // P1 不出闪

    // P0 confirm 发动利驭
    await P0.respond('界利驭', { choice: true });

    // 选装备
    await P0.respond('界利驭', { zone: 'equipment', cardId: weapon.id });

    // 关键合约:P0 仍获得装备
    expect(harness.state.players[0].hand).toContain(weapon.id);
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();

    // 因无第三者可选,跳过决斗:无 chooseDuelTarget pending,无 询问杀 pending,
    // P1 体力不变(决斗未发生)
    for (const s of harness.state.pendingSlots.values()) {
      const a = s.atom as { type: string; requestType?: string };
      expect(a.requestType).not.toBe('界利驭/chooseDuelTarget');
      expect(a.type).not.toBe('询问杀');
    }
    expect(harness.state.players[1].health).toBe(p1HealthBefore - 1); // 只算 杀 的伤害
  });
});
