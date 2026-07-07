// 激昂(孙策·被动技)行为测试:
//   1. 孙策使用红色杀 → 询问 → 发动 → 摸1张
//   2. 孙策被使用红色杀 → 询问 → 发动 → 摸1张
//   3. 孙策使用决斗 → 询问 → 发动 → 摸1张
//   4. 黑色杀不触发(无询问)
//   5. 不发动则不摸牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, Faction, GameState, Json } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank: string,
  type: '基本牌' | '锦囊牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  faction?: Faction;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    faction: opts.faction,
    health: opts.health ?? opts.maxHealth ?? 4,
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

describe('激昂', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('孙策使用红色杀 → 发动激昂 → 摸1张', async () => {
    const redKill = mkCard('rk', '杀', '♥', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孙策', skills: ['杀', '激昂'], hand: ['rk'] }),
          mkPlayer({ index: 1, name: 'P2', skills: ['杀'], hand: [] }),
        ],
        cardMap: { rk: redKill },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('孙策');
    const P2 = harness.player('P2');
    const scHandBefore = harness.state.players[0].hand.length;

    // 出红色杀指定 P2
    await SC.triggerAction('杀', 'use', { cardId: 'rk', targets: [1] });

    // 成为目标后触发激昂:孙策被询问是否发动
    SC.expectPending('请求回应');
    await SC.respond('激昂', { choice: true });

    // 激昂摸1张后,继续杀结算:询问 P2 出闪
    P2.expectPending('询问闪');
    await P2.pass(); // P2 不闪 → 受伤

    // 孙策用了杀(-1),激昂摸1(+1) → 手牌数不变,但牌已换成摸来的牌
    expect(harness.state.players[0].hand.length).toBe(scHandBefore);
    // 摸来的牌来自测试牌堆(__test_deck_*)
    expect(harness.state.players[0].hand[0]).toMatch(/__test_deck_/);
    // P2 受 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
  });

  it('孙策被使用红色杀 → 发动激昂 → 摸1张', async () => {
    const redKill = mkCard('rk', '杀', '♦', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孙策', skills: ['激昂'], hand: [] }),
          mkPlayer({ index: 1, name: '敌', skills: ['杀'], hand: ['rk'] }),
        ],
        cardMap: { rk: redKill },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('孙策');
    const enemy = harness.player('敌');
    const scHandBefore = harness.state.players[0].hand.length;

    // 敌人对孙策出红色杀
    await enemy.triggerAction('杀', 'use', { cardId: 'rk', targets: [0] });

    // 成为目标后触发激昂(孙策是目标方)
    SC.expectPending('请求回应');
    await SC.respond('激昂', { choice: true });

    // 激昂摸1张;然后询问孙策出闪
    expect(harness.state.players[0].hand.length).toBe(scHandBefore + 1);
    SC.expectPending('询问闪');
    await SC.pass(); // 孙策不闪 → 受伤
    expect(harness.state.players[0].health).toBe(3);
  });

  it('孙策使用决斗 → 发动激昂 → 摸1张', async () => {
    const duel = mkCard('jd', '决斗', '♠', 'A', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孙策', skills: ['决斗', '激昂'], hand: ['jd'] }),
          mkPlayer({ index: 1, name: 'P2', skills: ['杀'], hand: [] }),
        ],
        cardMap: { jd: duel },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('孙策');
    const P2 = harness.player('P2');
    const scHandBefore = harness.state.players[0].hand.length;

    // 孙策对 P2 使用决斗
    await SC.triggerAction('决斗', 'use', { cardId: 'jd', targets: [1] });

    // 成为目标后触发激昂(孙策是决斗发起者)
    SC.expectPending('请求回应');
    await SC.respond('激昂', { choice: true });

    // 激昂摸1张:决斗牌(-1)+ 激昂摸牌(+1)= 手牌数不变(1张),且换成牌堆牌
    expect(harness.state.players[0].hand.length).toBe(scHandBefore);
    expect(harness.state.players[0].hand[0]).toMatch(/__test_deck_/);

    // 决斗结算:无懈窗口 → 询问杀。逐个 pass 推进
    await SC.pass(); // 无懈可击窗口(广播)
    P2.expectPending('询问杀');
    await P2.pass(); // P2 不出杀 → 输 → 受伤
    expect(harness.state.players[1].health).toBe(3);
  });

  it('黑色杀不触发激昂(无询问)', async () => {
    const blackKill = mkCard('bk', '杀', '♠', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孙策', skills: ['杀', '激昂'], hand: ['bk'] }),
          mkPlayer({ index: 1, name: 'P2', skills: ['杀'], hand: [] }),
        ],
        cardMap: { bk: blackKill },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('孙策');
    const P2 = harness.player('P2');

    // 出黑色杀:不应触发激昂,直接进入询问闪
    await SC.triggerAction('杀', 'use', { cardId: 'bk', targets: [1] });
    P2.expectPending('询问闪'); // 无激昂询问
    await P2.pass();
    // 孙策没有摸牌:用了杀后手牌为空
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].health).toBe(3);
  });

  it('不发动激昂则不摸牌', async () => {
    const redKill = mkCard('rk', '杀', '♥', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孙策', skills: ['杀', '激昂'], hand: ['rk'] }),
          mkPlayer({ index: 1, name: 'P2', skills: ['杀'], hand: [] }),
        ],
        cardMap: { rk: redKill },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('孙策');
    const P2 = harness.player('P2');

    await SC.triggerAction('杀', 'use', { cardId: 'rk', targets: [1] });
    SC.expectPending('请求回应');
    await SC.respond('激昂', { choice: false }); // 不发动

    // 不摸牌,继续杀结算
    P2.expectPending('询问闪');
    await P2.pass();
    expect(harness.state.players[0].hand.length).toBe(0); // 用了杀,没摸牌
  });
});
