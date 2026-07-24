// 界帷幕(界贾诩·锁定技)测试:
//   "你不能成为黑色锦囊牌的目标;你防止回合内受到的伤害并摸所防止伤害值两倍数量的牌。"
//
// 验证:
//   1. 黑色锦囊目标/获得/弃置/横置/伤害均被 cancel(标版沿用)
//   2. 红色锦囊正常受影响(标版沿用)
//   3. 界版新增:贾诩回合内受到的非黑色锦囊伤害 → 防止 + 摸 2×伤害值张牌
//   4. 界版新增:贾诩回合内黑色锦囊伤害 → 走"防止+摸牌"路径(摸牌优先,与标版无摸牌冲突)
//   5. 界版新增:非贾诩回合受伤 → 不防止(标版黑色锦囊规则仍生效)
//   6. 界版新增:0 伤害不触发摸牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom, pushFrame, popFrame } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
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

describe('界帷幕', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 黑色决斗以贾诩为目标 → 成为目标被 cancel(标版沿用)──
  it('黑色决斗 → 成为目标被 cancel(免疫)', async () => {
    const blackDuel = mkCard('d1', '决斗', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P1', skills: [] }),
        mkPlayer({ index: 1, name: '界贾诩', character: '界贾诩', skills: ['界帷幕'], health: 3 }),
      ],
      cardMap: { d1: blackDuel },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await pushFrame(harness.state, '决斗', 0, { cardId: 'd1' });
    const became = await applyAtom(harness.state, {
      type: '成为目标',
      source: 0,
      target: 1,
      cardId: 'd1',
    });
    await harness.waitForStable();
    await popFrame(harness.state);

    expect(became).toBe(false); // 帷幕 cancel
  });

  // ─── 2. 黑色过河拆桥弃置贾诩的牌 → 弃置被 cancel(标版沿用)──
  it('黑色过河拆桥 → 弃置被 cancel(免疫)', async () => {
    const blackGH = mkCard('gh1', '过河拆桥', '♠', 'Q', '锦囊牌');
    const target = mkCard('t2', '闪', '♣', '4');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P1', skills: [] }),
        mkPlayer({
          index: 1,
          name: '界贾诩',
          character: '界贾诩',
          hand: [target.id],
          skills: ['界帷幕'],
          health: 3,
        }),
      ],
      cardMap: { gh1: blackGH, t2: target },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await pushFrame(harness.state, '过河拆桥', 0, { cardId: 'gh1' });
    const discarded = await applyAtom(harness.state, {
      type: '弃置',
      player: 1,
      cardIds: ['t2'],
    });
    await harness.waitForStable();
    await popFrame(harness.state);

    expect(discarded).toBe(false); // 帷幕 cancel
    expect(harness.state.players[1].hand).toContain('t2');
  });

  // ─── 3. 红色锦囊正常受影响(标版沿用)──
  it('负面:红色决斗 → 成为目标不被 cancel', async () => {
    const redDuel = mkCard('d2', '决斗', '♥', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P1', skills: [] }),
        mkPlayer({ index: 1, name: '界贾诩', character: '界贾诩', skills: ['界帷幕'], health: 3 }),
      ],
      cardMap: { d2: redDuel },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await pushFrame(harness.state, '决斗', 0, { cardId: 'd2' });
    const became = await applyAtom(harness.state, {
      type: '成为目标',
      source: 0,
      target: 1,
      cardId: 'd2',
    });
    await harness.waitForStable();
    await popFrame(harness.state);

    expect(became).toBe(true); // 红色锦囊不拦截
  });

  // ─── 4. 界版新增:贾诩回合内受到非黑色锦囊伤害 → 防止 + 摸 2×伤害值张牌 ──
  it('界版:贾诩回合内受 2 点伤害 → 防止并摸 4 张牌(2×伤害值)', async () => {
    // 准备牌堆顶 4 张牌用于摸牌
    const tops = [
      mkCard('top1', '杀', '♠', '2'),
      mkCard('top2', '杀', '♠', '3'),
      mkCard('top3', '杀', '♠', '4'),
      mkCard('top4', '杀', '♠', '5'),
    ];
    const cardMap: Record<string, Card> = {};
    for (const c of tops) cardMap[c.id] = c;
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界贾诩',
          character: '界贾诩',
          skills: ['界帷幕'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P2', skills: [], health: 4 }),
      ],
      cardMap,
      zones: { deck: ['top4', 'top3', 'top2', 'top1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, // 贾诩回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const healthBefore = harness.state.players[0].health;
    const handBefore = harness.state.players[0].hand.length;

    // 贾诩回合内受到 2 点伤害(无来源,无 cardId)
    await runDamageFlow(harness.state, 1, 0, 2);
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(healthBefore); // 防止:体力不变
    expect(harness.state.players[0].hand.length).toBe(handBefore + 4); // 摸 4 张(2×2)
  });

  // ─── 5. 界版新增:贾诩回合内黑色锦囊伤害 → 防止并摸 2×(优先于标版 cancel)──
  it('界版:贾诩回合内黑色锦囊伤害 → 防止并摸 2×(摸牌路径优先)', async () => {
    const blackAOE = mkCard('nm1', '南蛮入侵', '♠', 'A', '锦囊牌');
    const tops = [mkCard('top1', '杀', '♥', '2'), mkCard('top2', '杀', '♥', '3')];
    const cardMap: Record<string, Card> = { nm1: blackAOE };
    for (const c of tops) cardMap[c.id] = c;
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界贾诩',
          character: '界贾诩',
          skills: ['界帷幕'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P2', skills: [], health: 4 }),
      ],
      cardMap,
      zones: { deck: ['top2', 'top1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const handBefore = harness.state.players[0].hand.length;

    // 模拟黑色锦囊(南蛮入侵)伤害落到贾诩头上,cardId 是黑色锦囊
    await runDamageFlow(harness.state, 1, 0, 1, 'nm1');
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3); // 防止
    expect(harness.state.players[0].hand.length).toBe(handBefore + 2); // 摸 2 张(2×1)
  });

  // ─── 6. 界版新增:非贾诩回合受伤 → 不走"回合内防伤"路径 ──
  it('界版:非贾诩回合受伤 → 黑色锦囊走标版 cancel(无摸牌),其他伤害正常生效', async () => {
    const blackAOE = mkCard('nm2', '南蛮入侵', '♠', '7', '锦囊牌');
    const slash = mkCard('sk1', '杀', '♥', '4');
    const cardMap: Record<string, Card> = { nm2: blackAOE, sk1: slash };
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界贾诩',
          character: '界贾诩',
          skills: ['界帷幕'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P2', skills: [], health: 4 }),
      ],
      cardMap,
      currentPlayerIndex: 1, // P2 回合,非贾诩回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // (a) 黑色锦囊伤害 → 走标版 cancel(无摸牌)
    const handBeforeBlack = harness.state.players[0].hand.length;
    await runDamageFlow(harness.state, 1, 0, 1, 'nm2');
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(3); // cancel → 体力不变
    expect(harness.state.players[0].hand.length).toBe(handBeforeBlack); // 标版 cancel 无摸牌

    // (b) 非锦囊伤害 → 界版不拦截(标版也不拦截),正常受伤
    await runDamageFlow(harness.state, 1, 0, 1, 'sk1');
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(2); // 非贾诩回合 → 正常受伤
  });

  // ─── 7. 边界:0 伤害不触发摸牌 ──
  it('边界:0 伤害(amount=0)→ 不触发摸牌', async () => {
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界贾诩',
          character: '界贾诩',
          skills: ['界帷幕'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P2', skills: [], health: 4 }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const handBefore = harness.state.players[0].hand.length;
    await runDamageFlow(harness.state, 1, 0, 0);
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(handBefore); // 无摸牌
  });
});
