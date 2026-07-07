// 帷幕(贾诩·锁定技)测试:你不能成为黑色锦囊的目标。
//
// 验证:
//   1. 黑色决斗 → 贾诩不是合法目标(成为目标被 cancel)
//   2. 黑色顺手牵羊 → 获得被 cancel(不被取走牌)
//   3. 黑色过河拆桥 → 弃置被 cancel(不被弃牌)
//   4. 黑色南蛮入侵 → 贾诩不受伤害(造成伤害被 cancel)
//   5. 负面对照:红色锦囊 → 贾诩正常受影响
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom, pushFrame, popFrame } from '../../src/engine/create-engine';
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

describe('帷幕', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 黑色决斗 → 成为目标被 cancel ─────────────────
  it('黑色决斗以贾诩为目标 → 成为目标被 cancel(免疫)', async () => {
    const blackDuel = mkCard('d1', '决斗', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P1', hand: [], skills: [] }),
        mkPlayer({ index: 1, name: '贾诩', character: '贾诩', skills: ['帷幕'], health: 3 }),
      ],
      cardMap: { d1: blackDuel },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接在决斗结算帧内触发 成为目标,验证帷幕拦截点
    await pushFrame(harness.state, '决斗', 0, { cardId: 'd1' });
    const became = await applyAtom(harness.state, {
      type: '成为目标',
      source: 0,
      target: 1,
      cardId: 'd1',
    });
    await harness.waitForStable();
    await popFrame(harness.state);

    expect(became).toBe(false); // 帷幕 cancel → 贾诩不是合法目标
  });

  // ─── 2. 黑色顺手牵羊 → 获得被 cancel ─────────────────
  it('黑色顺手牵羊获得贾诩的牌 → 获得被 cancel(免疫)', async () => {
    const blackSS = mkCard('ss1', '顺手牵羊', '♠', '3', '锦囊牌');
    const target = mkCard('t1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P1', skills: [] }),
        mkPlayer({ index: 1, name: '贾诩', character: '贾诩', hand: [target.id], skills: ['帷幕'] }),
      ],
      cardMap: { ss1: blackSS, t1: target },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 顺手牵羊.execute 持有'顺手牵羊'结算帧,frame.params 携带 cardId
    await pushFrame(harness.state, '顺手牵羊', 0, { cardId: 'ss1' });
    const got = await applyAtom(harness.state, {
      type: '获得',
      player: 0,
      cardId: 't1',
      from: 1,
    });
    await harness.waitForStable();
    await popFrame(harness.state);

    expect(got).toBe(false); // 帷幕 cancel
    expect(harness.state.players[1].hand).toContain('t1'); // 贾诩牌未被取走
    expect(harness.state.players[0].hand).not.toContain('t1');
  });

  // ─── 3. 黑色过河拆桥 → 弃置被 cancel ─────────────────
  it('黑色过河拆桥弃置贾诩的牌 → 弃置被 cancel(免疫)', async () => {
    const blackGH = mkCard('gh1', '过河拆桥', '♠', 'Q', '锦囊牌');
    const target = mkCard('t2', '闪', '♣', '4');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P1', skills: [] }),
        mkPlayer({ index: 1, name: '贾诩', character: '贾诩', hand: [target.id], skills: ['帷幕'] }),
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
    expect(harness.state.players[1].hand).toContain('t2'); // 贾诩牌未被弃
  });

  // ─── 4. 黑色南蛮入侵 → 贾诩不受伤害 ─────────────────
  it('黑色南蛮入侵 → 贾诩免疫,不受伤', async () => {
    const blackNM = mkCard('nm1', '南蛮入侵', '♠', 'A', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P1',
            hand: ['nm1'],
            skills: ['南蛮入侵'],
            health: 4,
          }),
          mkPlayer({
            index: 1,
            name: '贾诩',
            character: '贾诩',
            hand: [],
            skills: ['帷幕'],
            health: 3,
            maxHealth: 3,
          }),
        ],
        cardMap: { nm1: blackNM },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const JX = harness.player('贾诩');

    // P1 使用南蛮入侵(黑色)→ 贾诩被问出杀
    await P1.useCard('南蛮入侵', 'nm1');
    await harness.waitForStable();
    // 贾诩不出杀(pass)
    await JX.pass();
    await harness.waitForStable();

    // 帷幕:黑色南蛮造成的伤害被 cancel → 贾诩体力不变
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].alive).toBe(true);
  });

  // ─── 5. 负面对照:红色锦囊 → 贾诩正常受影响 ─────────────────
  it('负面:红色决斗以贾诩为目标 → 成为目标不被 cancel', async () => {
    const redDuel = mkCard('d2', '决斗', '♥', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P1', skills: [] }),
        mkPlayer({ index: 1, name: '贾诩', character: '贾诩', skills: ['帷幕'], health: 3 }),
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

    expect(became).toBe(true); // 红色锦囊,帷幕不拦截
  });

  it('负面:红色顺手牵羊获得贾诩的牌 → 正常获得', async () => {
    const redSS = mkCard('ss2', '顺手牵羊', '♥', '4', '锦囊牌');
    const target = mkCard('t3', '闪', '♦', '5');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P1', skills: [] }),
        mkPlayer({ index: 1, name: '贾诩', character: '贾诩', hand: [target.id], skills: ['帷幕'] }),
      ],
      cardMap: { ss2: redSS, t3: target },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await pushFrame(harness.state, '顺手牵羊', 0, { cardId: 'ss2' });
    const got = await applyAtom(harness.state, {
      type: '获得',
      player: 0,
      cardId: 't3',
      from: 1,
    });
    await harness.waitForStable();
    await popFrame(harness.state);

    expect(got).toBe(true); // 红色锦囊正常获得
    expect(harness.state.players[0].hand).toContain('t3');
    expect(harness.state.players[1].hand).not.toContain('t3');
  });
});
