// 界孙策 界激昂 行为测试(OL hero/452 两段式加强版):
//   第一段(同标激昂):使用/被使用 决斗或红色杀 → 摸1张
//     1. 孙策使用红色杀 → 发动 → 摸1张
//     2. 孙策使用决斗 → 发动 → 摸1张
//     3. 黑色杀不触发
//   第二段(界新增):每回合首次 决斗或红色杀 因弃置入弃牌堆 → 可失去1体力获得之
//     4. 弃置决斗 → 发动 → 失1体力 + 获得该牌
//     5. 弃置红色杀 → 发动 → 失1体力 + 获得该牌
//     6. 弃置黑色杀不触发
//     7. 每回合限一次:首次弃置后(不发动),再次弃置不再触发
//     8. 其他玩家弃置决斗也触发(不限定弃置者)
//     9. 同时弃置多张决斗/红杀 → 全部获得之(非仅首张)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';

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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
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

describe('界孙策·界激昂', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 第一段:使用/被使用 → 摸一张牌(同标激昂)───

  it('第一段:孙策使用红色杀 → 发动 → 摸1张', async () => {
    const redKill = mkCard('rk', '杀', '♥', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界孙策', skills: ['杀', '界激昂'], hand: ['rk'] }),
          mkPlayer({ index: 1, name: 'P2', skills: ['杀'], hand: [] }),
        ],
        cardMap: { rk: redKill },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const P2 = harness.player('P2');
    const scHandBefore = harness.state.players[0].hand.length;

    await SC.triggerAction('杀', 'use', { cardId: 'rk', targets: [1] });
    // 成为目标后触发界激昂
    SC.expectPending('请求回应');
    await SC.respond('界激昂', { choice: true });

    // 摸1张后继续杀结算:询问 P2 出闪
    P2.expectPending('询问闪');
    await P2.pass();

    // 用了杀(-1)+ 激昂摸1(+1) → 手牌数不变,但换成摸来的牌
    expect(harness.state.players[0].hand.length).toBe(scHandBefore);
    expect(harness.state.players[0].hand[0]).toMatch(/__test_deck_/);
    expect(harness.state.players[1].health).toBe(3);
  });

  it('第一段:孙策使用决斗 → 发动 → 摸1张', async () => {
    const duel = mkCard('jd', '决斗', '♠', 'A', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界孙策', skills: ['决斗', '界激昂'], hand: ['jd'] }),
          mkPlayer({ index: 1, name: 'P2', skills: ['杀'], hand: [] }),
        ],
        cardMap: { jd: duel },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const P2 = harness.player('P2');
    const scHandBefore = harness.state.players[0].hand.length;

    await SC.triggerAction('决斗', 'use', { cardId: 'jd', targets: [1] });
    SC.expectPending('请求回应');
    await SC.respond('界激昂', { choice: true });

    // 决斗牌(-1)+ 激昂摸1(+1) → 手牌数不变
    expect(harness.state.players[0].hand.length).toBe(scHandBefore);
    expect(harness.state.players[0].hand[0]).toMatch(/__test_deck_/);

    // 决斗结算推进
    await SC.pass(); // 无懈窗口
    P2.expectPending('询问杀');
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  it('第一段:黑色杀不触发界激昂(无询问)', async () => {
    const blackKill = mkCard('bk', '杀', '♠', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界孙策', skills: ['杀', '界激昂'], hand: ['bk'] }),
          mkPlayer({ index: 1, name: 'P2', skills: ['杀'], hand: [] }),
        ],
        cardMap: { bk: blackKill },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');
    const P2 = harness.player('P2');

    await SC.triggerAction('杀', 'use', { cardId: 'bk', targets: [1] });
    P2.expectPending('询问闪'); // 无界激昂询问
    await P2.pass();
    expect(harness.state.players[0].hand.length).toBe(0); // 用了杀没摸牌
  });

  // ─── 第二段:因弃置入弃牌堆 → 可失去1体力获得之(界新增)───

  it('第二段:弃置决斗 → 发动 → 失1体力 + 获得该牌', async () => {
    const duel = mkCard('jd', '决斗', '♠', 'A', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            skills: ['界激昂'],
            hand: ['jd'],
            health: 4,
          }),
          mkPlayer({ index: 1, name: 'P2', skills: [], hand: [] }),
        ],
        cardMap: { jd: duel },
        currentPlayerIndex: 0,
        phase: '弃牌',
        turn: { round: 1, phase: '弃牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');

    // 孙策弃置决斗(模拟弃牌阶段弃牌)。after-hook 会创建询问 pending,故 fire-and-forget
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['jd'] });
    await harness.waitForStable();

    // 第二段触发:询问是否失去1体力获得之
    SC.expectPending('请求回应');
    await SC.respond('界激昂', { choice: true });
    await harness.waitForStable();

    // 失去1体力:4→3;获得决斗:手牌含 jd
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand).toContain('jd');
    // 决斗已从弃牌堆取出
    expect(harness.state.zones.discardPile).not.toContain('jd');
  });

  it('第二段:弃置红色杀 → 发动 → 失1体力 + 获得该牌', async () => {
    const redKill = mkCard('rk', '杀', '♥', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界孙策', skills: ['界激昂'], hand: ['rk'], health: 4 }),
          mkPlayer({ index: 1, name: 'P2', skills: [], hand: [] }),
        ],
        cardMap: { rk: redKill },
        currentPlayerIndex: 0,
        phase: '弃牌',
        turn: { round: 1, phase: '弃牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');

    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['rk'] });
    await harness.waitForStable();
    SC.expectPending('请求回应');
    await SC.respond('界激昂', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand).toContain('rk');
  });

  it('第二段:同时弃置多张决斗/红色杀 → 发动 → 全部获得之(非仅首张)', async () => {
    const duel = mkCard('jd', '决斗', '♠', 'A', '锦囊牌');
    const redKill = mkCard('rk', '杀', '♥', '7');
    const blackKill = mkCard('bk', '杀', '♠', '3'); // 非触发牌,不获得
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            skills: ['界激昂'],
            hand: ['jd', 'rk', 'bk'],
            health: 4,
          }),
          mkPlayer({ index: 1, name: 'P2', skills: [], hand: [] }),
        ],
        cardMap: { jd: duel, rk: redKill, bk: blackKill },
        currentPlayerIndex: 0,
        phase: '弃牌',
        turn: { round: 1, phase: '弃牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');

    // 同时弃置决斗 + 红杀 + 黑杀
    void applyAtom(harness.state, {
      type: '弃置',
      player: 0,
      cardIds: ['jd', 'rk', 'bk'],
    });
    await harness.waitForStable();
    SC.expectPending('请求回应');
    await SC.respond('界激昂', { choice: true });
    await harness.waitForStable();

    // 失去1体力:4→3(仅失1点,不论获得几张)
    expect(harness.state.players[0].health).toBe(3);
    // 决斗与红杀均获得
    expect(harness.state.players[0].hand).toContain('jd');
    expect(harness.state.players[0].hand).toContain('rk');
    // 黑色杀不在获得范围,仍在弃牌堆
    expect(harness.state.players[0].hand).not.toContain('bk');
    expect(harness.state.zones.discardPile).toContain('bk');
    // 决斗与红杀已从弃牌堆取出
    expect(harness.state.zones.discardPile).not.toContain('jd');
    expect(harness.state.zones.discardPile).not.toContain('rk');
  });

  it('第二段:弃置黑色杀不触发(无询问)', async () => {
    const blackKill = mkCard('bk', '杀', '♠', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界孙策', skills: ['界激昂'], hand: ['bk'], health: 4 }),
          mkPlayer({ index: 1, name: 'P2', skills: [], hand: [] }),
        ],
        cardMap: { bk: blackKill },
        currentPlayerIndex: 0,
        phase: '弃牌',
        turn: { round: 1, phase: '弃牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['bk'] });
    await harness.waitForStable();

    // 黑杀不触发:无 pending,牌留在弃牌堆,体力不变
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('bk');
  });

  it('第二段:每回合限一次(首次不发动后,再次弃置不再触发)', async () => {
    const duel = mkCard('jd', '决斗', '♠', 'A', '锦囊牌');
    const redKill = mkCard('rk', '杀', '♥', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            skills: ['界激昂'],
            hand: ['jd', 'rk'],
            health: 4,
          }),
          mkPlayer({ index: 1, name: 'P2', skills: [], hand: [] }),
        ],
        cardMap: { jd: duel, rk: redKill },
        currentPlayerIndex: 0,
        phase: '弃牌',
        turn: { round: 1, phase: '弃牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');

    // 首次:弃置决斗 → 询问 → 不发动
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['jd'] });
    await harness.waitForStable();
    SC.expectPending('请求回应');
    await SC.respond('界激昂', { choice: false });
    await harness.waitForStable();
    // 不发动:体力不变,决斗留在弃牌堆
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('jd');

    // 再次:弃置红色杀 → 不应再触发(每回合限一次)
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['rk'] });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(4); // 体力不变
    expect(harness.state.zones.discardPile).toContain('rk');
  });

  it('第二段:其他玩家弃置决斗也触发(不限定弃置者)', async () => {
    const duel = mkCard('jd', '决斗', '♠', 'A', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '界孙策', skills: ['界激昂'], hand: [], health: 4 }),
          mkPlayer({ index: 1, name: 'P2', skills: [], hand: ['jd'] }),
        ],
        cardMap: { jd: duel },
        currentPlayerIndex: 1,
        phase: '弃牌',
        turn: { round: 1, phase: '弃牌', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');

    // P2 弃置决斗 → 界孙策的第二段触发
    void applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['jd'] });
    await harness.waitForStable();
    SC.expectPending('请求回应');
    await SC.respond('界激昂', { choice: true });
    await harness.waitForStable();

    // 界孙策失1体力并获得决斗
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand).toContain('jd');
  });
});
