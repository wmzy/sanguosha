// 界孙策 界制霸 行为测试(OL hero/452 双向拼点):
//   方向 A(盟友发起,同标制霸):
//     1. 盟友拼点没赢 → 孙策获得两张拼点牌
//     2. 盟友拼点赢 → 双方牌进弃牌堆
//     3. 觉醒后孙策拒绝 → 中止
//     4. 盟友主动发起限一次
//   方向 B(孙策发起,界新增):
//     5. 孙策主动发起,孙策没赢 → 孙策可获得两张拼点牌
//     6. 孙策主动发起,孙策赢 → 双方牌进弃牌堆
//     7. 孙策主动发起限一次
//     8. 非吴势力角色不能作为孙策主动拼点目标
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import type { Card, Faction, GameState, Json } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function mkCard(id: string, rank: string, suit: '♠' | '♥' | '♣' | '♦' = '♠'): Card {
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

describe('界孙策·界制霸', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 方向 A:盟友发起(同标制霸)───

  it('方向A:盟友拼点没赢 → 孙策获得两张拼点牌', async () => {
    const ac = mkCard('ac', '2');
    const lc = mkCard('lc', 'K');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            faction: '吴',
            skills: ['界激昂', '界魂姿', '界制霸'],
            hand: ['lc'],
          }),
          mkPlayer({
            index: 1,
            name: '盟友',
            faction: '吴',
            skills: [],
            hand: ['ac'],
          }),
        ],
        cardMap: { ac, lc },
        currentPlayerIndex: 1, // 盟友的回合
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const ally = harness.player('盟友');

    await ally.triggerAction('界制霸', 'use', { cardId: 'ac' });
    // 孙策选拼点牌
    SC.expectPending('请求回应');
    await SC.respond('界制霸', { cardId: 'lc' });
    // 盟友没赢 → 询问获得
    SC.expectPending('请求回应');
    await SC.respond('界制霸', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toContain('lc');
    expect(harness.state.players[0].hand).toContain('ac');
    expect(harness.state.players[1].hand.length).toBe(0);
  });

  it('方向A:盟友拼点赢 → 双方牌进弃牌堆', async () => {
    const ac = mkCard('ac', 'K');
    const lc = mkCard('lc', '2');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            faction: '吴',
            skills: ['界激昂', '界魂姿', '界制霸'],
            hand: ['lc'],
          }),
          mkPlayer({ index: 1, name: '盟友', faction: '吴', skills: [], hand: ['ac'] }),
        ],
        cardMap: { ac, lc },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const ally = harness.player('盟友');

    await ally.triggerAction('界制霸', 'use', { cardId: 'ac' });
    await SC.respond('界制霸', { cardId: 'lc' });
    await harness.waitForStable();

    // 盟友赢:无获得询问,流程结束
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['ac', 'lc']));
  });

  it('方向A:觉醒后孙策拒绝拼点 → 中止,不动牌', async () => {
    const ac = mkCard('ac', '2');
    const lc = mkCard('lc', 'K');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            faction: '吴',
            skills: ['界激昂', '界魂姿', '界制霸'],
            hand: ['lc'],
            vars: { '魂姿/awakened': true },
          }),
          mkPlayer({ index: 1, name: '盟友', faction: '吴', skills: [], hand: ['ac'] }),
        ],
        cardMap: { ac, lc },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const ally = harness.player('盟友');

    await ally.triggerAction('界制霸', 'use', { cardId: 'ac' });
    SC.expectPending('请求回应');
    await SC.respond('界制霸', { choice: false }); // 拒绝
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toEqual(['lc']);
    expect(harness.state.players[1].hand).toEqual(['ac']);
  });

  it('方向A:盟友主动发起限一次', async () => {
    // 孙策、盟友各持两张,保证第二次仍越过「孙策无手牌」校验,
    // 使拒绝确由 盟友 vars['界制霸/usedThisTurn'] 触发(同标制霸限一次)。
    const ac = mkCard('ac', '2');
    const ac2 = mkCard('ac2', '3');
    const lc = mkCard('lc', 'K');
    const lc2 = mkCard('lc2', 'Q');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            faction: '吴',
            skills: ['界激昂', '界魂姿', '界制霸'],
            hand: ['lc', 'lc2'],
          }),
          mkPlayer({
            index: 1,
            name: '盟友',
            faction: '吴',
            skills: [],
            hand: ['ac', 'ac2'],
          }),
        ],
        cardMap: { ac, ac2, lc, lc2 },
        currentPlayerIndex: 1, // 盟友的回合
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const ally = harness.player('盟友');

    // 第一次:盟友发起拼点,孙策选拼点牌后不获得 → 牌进弃牌堆
    await ally.triggerAction('界制霸', 'use', { cardId: 'ac' });
    SC.expectPending('请求回应');
    await SC.respond('界制霸', { cardId: 'lc' });
    SC.expectPending('请求回应');
    await SC.respond('界制霸', { choice: false }); // 不获得,牌进弃牌堆
    await harness.waitForStable();

    // 第二次:本回合盟友已用过制霸,应被拒
    await ally.expectRejected({
      skillId: '界制霸',
      actionType: 'use',
      params: { cardId: 'ac2' },
    });
  });

  // ─── 方向 B:孙策主动发起(界新增)───

  it('方向B:孙策主动发起且没赢 → 孙策获得两张拼点牌', async () => {
    // 孙策出 2,盟友出 K → 孙策(发起方)没赢 → 孙策可获得
    const lc = mkCard('lc', '2');
    const tc = mkCard('tc', 'K');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            faction: '吴',
            skills: ['界激昂', '界魂姿', '界制霸'],
            hand: ['lc'],
          }),
          mkPlayer({ index: 1, name: '盟友', faction: '吴', skills: [], hand: ['tc'] }),
        ],
        cardMap: { lc, tc },
        currentPlayerIndex: 0, // 孙策的回合
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const ally = harness.player('盟友');

    // 孙策主动发动制霸,选拼点牌 + 指定目标
    await SC.triggerAction('界制霸', 'use', { cardId: 'lc', target: 1 });
    // 盟友被询问选拼点牌
    ally.expectPending('请求回应');
    await ally.respond('界制霸', { cardId: 'tc' });
    // 孙策没赢 → 询问孙策是否获得
    SC.expectPending('请求回应');
    await SC.respond('界制霸', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toContain('lc');
    expect(harness.state.players[0].hand).toContain('tc');
    expect(harness.state.players[1].hand.length).toBe(0);
  });

  it('方向B:孙策主动发起且赢 → 双方牌进弃牌堆', async () => {
    // 孙策出 K,盟友出 2 → 孙策赢 → 不获得
    const lc = mkCard('lc', 'K');
    const tc = mkCard('tc', '2');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            faction: '吴',
            skills: ['界激昂', '界魂姿', '界制霸'],
            hand: ['lc'],
          }),
          mkPlayer({ index: 1, name: '盟友', faction: '吴', skills: [], hand: ['tc'] }),
        ],
        cardMap: { lc, tc },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const ally = harness.player('盟友');

    await SC.triggerAction('界制霸', 'use', { cardId: 'lc', target: 1 });
    ally.expectPending('请求回应');
    await ally.respond('界制霸', { cardId: 'tc' });
    await harness.waitForStable();

    // 孙策赢:无获得询问,流程结束
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['lc', 'tc']));
  });

  it('方向B:孙策主动发起限一次', async () => {
    const lc = mkCard('lc', '2');
    const lc2 = mkCard('lc2', '3');
    const tc = mkCard('tc', 'K');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            faction: '吴',
            skills: ['界激昂', '界魂姿', '界制霸'],
            hand: ['lc', 'lc2'],
          }),
          mkPlayer({ index: 1, name: '盟友', faction: '吴', skills: [], hand: ['tc'] }),
        ],
        cardMap: { lc, lc2, tc },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const ally = harness.player('盟友');

    // 第一次主动拼点
    await SC.triggerAction('界制霸', 'use', { cardId: 'lc', target: 1 });
    ally.expectPending('请求回应');
    await ally.respond('界制霸', { cardId: 'tc' });
    SC.expectPending('请求回应');
    await SC.respond('界制霸', { choice: false }); // 不获得,牌进弃牌堆
    await harness.waitForStable();

    // 第二次主动拼点:本回合已用过,应被拒
    await SC.expectRejected({
      skillId: '界制霸',
      actionType: 'use',
      params: { cardId: 'lc2', target: 1 },
    });
  });

  it('方向B:非吴势力角色不能作为孙策主动拼点目标', async () => {
    const lc = mkCard('lc', '2');
    const tc = mkCard('tc', 'K');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            faction: '吴',
            skills: ['界激昂', '界魂姿', '界制霸'],
            hand: ['lc'],
          }),
          mkPlayer({ index: 1, name: '魏将', faction: '魏', skills: [], hand: ['tc'] }),
        ],
        cardMap: { lc, tc },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');

    // 魏将非吴势力:孙策主动拼点被拒
    await SC.expectRejected({
      skillId: '界制霸',
      actionType: 'use',
      params: { cardId: 'lc', target: 1 },
    });
  });
});
