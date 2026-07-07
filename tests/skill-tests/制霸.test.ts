// 制霸(孙策·主公技)行为测试:
//   1. 吴盟友拼点没赢 → 孙策获得双方拼点牌
//   2. 吴盟友拼点赢了 → 双方牌进弃牌堆,孙策无所得
//   3. 觉醒后孙策拒绝拼点 → 中止,不动牌
//   4. 拼点没赢但孙策不获得 → 双方牌进弃牌堆
//   5. 非吴势力角色不能用制霸
//   6. 孙策非主公(非0号位)时制霸不可用
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, Faction, GameState, Json } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function mkCard(
  id: string,
  rank: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
): Card {
  return { id, name: '杀', suit, color: suitColor(suit), rank, type: '基本牌' };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  faction?: Faction;
  skills?: string[];
  hand?: string[];
  health?: number;
  maxHealth?: number;
  vars?: Record<string, Json>;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    faction: opts.faction,
    health: opts.health ?? opts.maxHealth ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('制霸', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 标准场景:P1=孙策(0号位主公,吴), P2=吴盟友(1号位,当前回合)
  function buildLordState(opts: {
    scHand?: string[];
    allyHand?: string[];
    scVars?: Record<string, Json>;
    extraCards?: Record<string, Card>;
  }): GameState {
    return createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '孙策',
          faction: '吴',
          skills: ['激昂', '魂姿', '制霸'],
          hand: opts.scHand ?? [],
          vars: opts.scVars,
        }),
        mkPlayer({
          index: 1,
          name: '盟友',
          faction: '吴',
          skills: [],
          hand: opts.allyHand ?? [],
        }),
      ],
      cardMap: { ...(opts.extraCards ?? {}) },
      currentPlayerIndex: 1, // 盟友的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
  }

  it('盟友拼点没赢 → 孙策获得双方拼点牌', async () => {
    // 盟友出 2,孙策出 K → 2 <= 13 盟友没赢 → 孙策可获得
    const ac = mkCard('ac', '2');
    const lc = mkCard('lc', 'K');
    await harness.setup(
      buildLordState({ scHand: ['lc'], allyHand: ['ac'], extraCards: { ac, lc } }),
    );
    const SC = harness.player('孙策');
    const ally = harness.player('盟友');

    // 盟友发动制霸(孙策未觉醒,无拒绝询问)
    await ally.triggerAction('制霸', 'use', { cardId: 'ac' });

    // 孙策选拼点牌
    SC.expectPending('请求回应');
    await SC.respond('制霸', { cardId: 'lc' });

    // 盟友没赢 → 询问孙策是否获得
    SC.expectPending('请求回应');
    await SC.respond('制霸', { choice: true });

    // 孙策获得双方拼点牌:K 和 2 都到手
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toContain('lc');
    expect(harness.state.players[0].hand).toContain('ac');
    // 盟友失去拼点牌
    expect(harness.state.players[1].hand.length).toBe(0);
  });

  it('盟友拼点赢 → 双方牌进弃牌堆,孙策无所得', async () => {
    // 盟友出 K,孙策出 2 → K > 2 盟友赢 → 不询问获得
    const ac = mkCard('ac', 'K');
    const lc = mkCard('lc', '2');
    await harness.setup(
      buildLordState({ scHand: ['lc'], allyHand: ['ac'], extraCards: { ac, lc } }),
    );
    const SC = harness.player('孙策');
    const ally = harness.player('盟友');

    await ally.triggerAction('制霸', 'use', { cardId: 'ac' });
    await SC.respond('制霸', { cardId: 'lc' });

    // 盟友赢:无获得询问,流程结束,无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // 双方牌都进弃牌堆
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['ac', 'lc']));
  });

  it('觉醒后孙策拒绝拼点 → 中止,不动牌', async () => {
    const ac = mkCard('ac', '2');
    const lc = mkCard('lc', 'K');
    await harness.setup(
      buildLordState({
        scHand: ['lc'],
        allyHand: ['ac'],
        scVars: { '魂姿/awakened': true }, // 已觉醒
        extraCards: { ac, lc },
      }),
    );
    const SC = harness.player('孙策');
    const ally = harness.player('盟友');

    // 盟友发动制霸 → 孙策被询问是否拒绝
    await ally.triggerAction('制霸', 'use', { cardId: 'ac' });
    SC.expectPending('请求回应');
    await SC.respond('制霸', { choice: false }); // 拒绝

    // 中止:双方手牌不变,无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toEqual(['lc']);
    expect(harness.state.players[1].hand).toEqual(['ac']);
  });

  it('拼点没赢但孙策不获得 → 双方牌进弃牌堆', async () => {
    const ac = mkCard('ac', '2');
    const lc = mkCard('lc', 'K');
    await harness.setup(
      buildLordState({ scHand: ['lc'], allyHand: ['ac'], extraCards: { ac, lc } }),
    );
    const SC = harness.player('孙策');
    const ally = harness.player('盟友');

    await ally.triggerAction('制霸', 'use', { cardId: 'ac' });
    await SC.respond('制霸', { cardId: 'lc' });
    // 盟友没赢 → 询问获得
    SC.expectPending('请求回应');
    await SC.respond('制霸', { choice: false }); // 不获得

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['ac', 'lc']));
  });

  it('非吴势力角色不能用制霸', async () => {
    const ac = mkCard('ac', '2');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '孙策',
            faction: '吴',
            skills: ['激昂', '魂姿', '制霸'],
            hand: ['lc'],
          }),
          mkPlayer({ index: 1, name: '魏将', faction: '魏', skills: [], hand: ['ac'] }),
        ],
        cardMap: { ac, lc: mkCard('lc', 'K') },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const wei = harness.player('魏将');

    // 魏将不在吴势力,制霸 use 未注册到其座次 → dispatch 被拒
    await wei.expectRejected({
      skillId: '制霸',
      actionType: 'use',
      params: { cardId: 'ac' },
    });
  });

  it('孙策非主公(非0号位)时制霸不可用', async () => {
    const ac = mkCard('ac', '2');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '盟友', faction: '吴', skills: [], hand: ['ac'] }),
          mkPlayer({
            index: 1,
            name: '孙策',
            faction: '吴',
            skills: ['激昂', '魂姿', '制霸'],
            hand: ['lc'],
          }),
        ],
        cardMap: { ac, lc: mkCard('lc', 'K') },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const ally = harness.player('盟友');

    // 孙策在1号位(非主公位),制霸 validate 拒绝
    await ally.expectRejected({
      skillId: '制霸',
      actionType: 'use',
      params: { cardId: 'ac' },
    });
  });
});
