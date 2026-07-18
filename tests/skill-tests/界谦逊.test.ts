// 界谦逊(界陆逊·触发技)测试:当延时锦囊或他人普通锦囊对你生效且你为唯一目标时,
//   你可以将所有手牌移出游戏直到回合结束。
//
// 验证:
//   1. 延时锦囊(乐不思蜀)对你生效 → 触发 → 确认 → 手牌移出游戏 → 回合结束归还
//   2. 延时锦囊对你生效 → 不发动 → 手牌不移出
//   3. 无手牌时延时锦囊生效 → 不触发(无询问)
//   4. 他人普通锦囊(决斗)以你为唯一目标 → 触发 → 确认 → 手牌移出(经无懈窗口收敛点)
//   5. 自己使用的普通锦囊不触发(frame.from===自己 + cancelTarget!==自己)
//   6. 多目标普通锦囊(南蛮入侵)→ 陆逊非唯一目标 → 不触发
//   7. 联动:谦逊移出全部手牌 → 触发界连营(X=移出手牌数)
//   8. 他人对陆逊使用顺手牵羊 → 无懈超时 → 谦逊触发 → 确认 → 手牌移出
//   9. 他人对陆逊使用过河拆桥 → 无懈超时 → 谦逊触发 → 确认 → 手牌移出
//  10. 他人对陆逊使用火攻 → 无懈超时 → 谦逊触发 → 确认 → 手牌移出(火攻因无手牌可展示而失效)
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

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '陆逊',
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
  };
}

function buildState(opts: {
  p0Hand: string[];
  p1Hand: string[];
  p2Hand?: string[];
  extraCards: Record<string, Card>;
  p0Skills?: string[];
  p1Skills?: string[];
  p2Skills?: string[];
  currentPlayer: number;
}): GameState {
  const players = [
    makePlayer({
      index: 0,
      name: 'P0',
      hand: opts.p0Hand,
      skills: opts.p0Skills ?? ['界谦逊'],
      health: 3,
      maxHealth: 3,
      character: '界陆逊',
    }),
    makePlayer({
      index: 1,
      name: 'P1',
      hand: opts.p1Hand,
      skills: opts.p1Skills ?? ['杀'],
      character: '曹操',
    }),
  ];
  if (opts.p2Hand !== undefined) {
    players.push(
      makePlayer({
        index: 2,
        name: 'P2',
        hand: opts.p2Hand,
        skills: opts.p2Skills ?? ['杀'],
        character: '刘备',
      }),
    );
  }
  return createGameState({
    players,
    cardMap: opts.extraCards,
    currentPlayerIndex: opts.currentPlayer,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界谦逊', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 延时锦囊生效 → 确认 → 移出 → 回合结束归还 ────────────────────
  it('延时锦囊(乐不思蜀)对陆逊生效 → 确认 → 手牌移出游戏 → 回合结束归还', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const trick = makeCard('ls1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界谦逊'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2, ls1: trick },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 对 P0 放置乐不思蜀(直接驱动 atom,触发谦逊)
    void applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: trick },
    });
    await harness.waitForStable();

    // 谦逊询问
    P0.expectPending('请求回应');
    await P0.respond('界谦逊', { choice: true }); // 发动
    await harness.waitForStable();

    // 手牌全部移出游戏:hand 空,vars 暂存
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c1', 'c2']);
    // 牌未进弃牌堆(移出游戏 ≠ 弃置)
    expect(harness.state.zones.discardPile).toEqual([]);

    // 回合结束 → 归还
    void applyAtom(harness.state, { type: '回合结束', player: 1 });
    await harness.waitForStable();

    // 手牌归还,vars 清空
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(harness.state.players[0].vars['界谦逊/移出']).toBeUndefined();
  });

  // ─── 2. 延时锦囊生效 → 不发动 → 手牌不移出 ────────────────────
  it('延时锦囊生效 → 不发动谦逊 → 手牌不移出', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const trick = makeCard('ls1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界谦逊'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, ls1: trick },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: trick },
    });
    await harness.waitForStable();
    P0.expectPending('请求回应');

    // 不发动
    await P0.respond('界谦逊', { choice: false });
    await harness.waitForStable();

    // 手牌未移出
    expect(harness.state.players[0].hand).toEqual(['c1']);
    expect(harness.state.players[0].vars['界谦逊/移出']).toBeUndefined();
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 3. 无手牌 → 不触发 ────────────────────
  it('无手牌时延时锦囊生效 → 谦逊不触发(无询问)', async () => {
    const trick = makeCard('ls1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界谦逊'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { ls1: trick },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: trick },
    });
    await harness.waitForStable();

    // 无手牌可移出 → 不询问
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].vars['界谦逊/移出']).toBeUndefined();
  });

  // ─── 4. 他人对陆逊使用决斗 → 无懈超时 → 谦逊触发(经无懈窗口收敛点)─────
  //    决斗走 runDuelResolution:成为目标 → 询问无懈可击(target=陆逊)。
  //    新版谦逊 hook 监听 请求回应(无懈可击)atom:窗口无人打出无懈+未抵消 → 触发。
  it('他人对陆逊使用决斗 → 无懈超时 → 谦逊触发 → 确认 → 手牌移出 → 决斗继续', async () => {
    const c2 = makeCard('c2', '闪', '♥', '3'); // 陆逊手牌(将被移出)
    const p1Kill = makeCard('p1s', '杀', '♠', '5'); // P1 决斗备用杀
    const duel = makeCard('dd', '决斗', '♠', 'A', '锦囊牌');
    const state = buildState({
      p0Hand: ['c2'],
      p1Hand: ['dd', p1Kill.id],
      extraCards: { c2, p1s: p1Kill, dd: duel },
      p1Skills: ['决斗', '杀'],
      currentPlayer: 1,
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const p0HealthBefore = harness.state.players[0].health;

    // P1 对陆逊出决斗
    await P1.triggerAction('决斗', 'use', { cardId: 'dd', targets: [0] });

    // 无懈窗口(broadcast)
    P1.expectPending('请求回应');
    await P1.pass(); // 无人打出无懈 → 我的 hook 触发 → 谦逊 prompt

    // 谦逊 prompt(经 请求回应 无懈窗口路径触发)
    P0.expectPending('请求回应');
    await P0.respond('界谦逊', { choice: true });
    await harness.waitForStable();

    // 手牌移出
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c2']);

    // 决斗循环:陆逊(目标,先手)被询问出杀 → 无手牌 → pass → 输 → 扣 1 血
    P0.expectPending('询问杀');
    await P0.pass();
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(p0HealthBefore - 1);
  });

  // ─── 5. 自己使用的普通锦囊不触发 ────────────────────
  it('陆逊自己使用决斗 → 谦逊不触发(cancelTarget 是对方,非陆逊)', async () => {
    const c2 = makeCard('c2', '闪', '♥', '3');
    const duel = makeCard('dd', '决斗', '♠', 'A', '锦囊牌');
    const state = buildState({
      p0Hand: ['dd', c2.id],
      p1Hand: [],
      extraCards: { c2, dd: duel },
      p0Skills: ['界谦逊', '决斗', '杀'],
      p1Skills: ['杀'],
      currentPlayer: 0, // 陆逊的回合
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P0(陆逊)自己对 P1 使用决斗
    await P0.triggerAction('决斗', 'use', { cardId: 'dd', targets: [1] });
    // 无懈窗口 → pass
    P0.expectPending('请求回应');
    await P0.pass();
    await harness.waitForStable();

    // 谦逊不触发:cancelTarget 是 P1(被决斗目标),非陆逊
    expect(harness.state.players[0].vars['界谦逊/移出']).toBeUndefined();
    // 陆逊手牌未移出(dd 已被打出,剩 c2)
    expect(harness.state.players[0].hand).toEqual(['c2']);

    // 清理:决斗循环中 P1 被询问出杀 → pass → 输 → 陆逊造成伤害
    // 这里不深入验证决斗结果,只断言谦逊未触发
    const p1 = harness.player('P1');
    if ([...harness.state.pendingSlots.values()].length > 0) {
      await p1.pass();
      await harness.waitForStable();
    }
  });

  // ─── 6. 多目标普通锦囊(南蛮入侵)→ 陆逊非唯一目标 → 不触发 ────────────
  it('南蛮入侵(陆逊为多目标之一)→ 陆逊非唯一目标 → 谦逊不触发', async () => {
    const nanman = makeCard('nm1', '南蛮入侵', '♠', '7', '锦囊牌');
    const c2 = makeCard('c2', '杀', '♥', '3'); // 陆逊手牌(若有谦逊应被移出;此处理应保留)
    const state = buildState({
      p0Hand: ['c2'],
      p1Hand: ['nm1'],
      p2Hand: [],
      extraCards: { c2, nm1: nanman },
      p1Skills: ['南蛮入侵'],
      p2Skills: ['杀'],
      currentPlayer: 1,
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P1 使用南蛮入侵(自动结算所有其他存活角色)
    await P1.triggerAction('南蛮入侵', 'use', { cardId: 'nm1' });

    // 第一个无懈窗口(对陆逊)→ pass
    P1.expectPending('请求回应');
    await P1.pass();
    await harness.waitForStable();

    // 谦逊不触发(陆逊非唯一目标):无 谦逊/移出 vars,手牌保留
    expect(harness.state.players[0].vars['界谦逊/移出']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['c2']);

    // 接下来是询问杀(陆逊可出杀)→ 出杀以结束本目标结算
    P0.expectPending('询问杀');
    await P0.respond('杀', { cardId: 'c2' });
    await harness.waitForStable();

    // P2 的无懈+询问杀:逐个 pass 直到稳定
    while ([...harness.state.pendingSlots.values()].length > 0) {
      const slot = [...harness.state.pendingSlots.values()][0];
      const slotType = (slot.atom as { type: string }).type;
      if (slotType === '询问杀') {
        await P1.pass(); // P2 无杀 → 超时
      } else {
        await P1.pass(); // 无懈窗口
      }
      await harness.waitForStable();
    }
  });

  // ─── 7. 联动:谦逊移出全部手牌 → 触发界连营(X=移出手牌数) ────────────────────
  it('联动:谦逊移出 2 张手牌 → 界连营触发 X=2 → 令 2 名角色各摸一张', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const trick = makeCard('ls1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const d1 = makeCard('d1', '闪', '♥', '3');
    const d2 = makeCard('d2', '桃', '♦', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界谦逊', '界连营'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
      ],
      cardMap: { c1, c2, ls1: trick, d1, d2 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 延时锦囊触发谦逊
    void applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: trick },
    });
    await harness.waitForStable();

    // ① 谦逊询问 → 发动
    P0.expectPending('请求回应');
    await P0.respond('界谦逊', { choice: true });
    await harness.waitForStable();

    // 手牌移出 → 连营触发(X=2)
    expect(harness.state.players[0].hand).toEqual([]);
    P0.expectPending('请求回应');
    await P0.respond('界连营', { choice: true }); // 发动连营
    await harness.waitForStable();
    // X=2 → 选 P1/P2 各摸一张
    await P0.respond('界连营', { targets: [1, 2] });
    await harness.waitForStable();

    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);
    expect(harness.state.zones.deck.length).toBe(0);
  });

  // ─── 8. 他人对陆逊使用顺手牵羊 → 谦逊触发 → 确认 → 手牌移出 ────────────
  it('他人对陆逊使用顺手牵羊 → 无懈超时 → 谦逊触发 → 确认 → 手牌移出(顺手牵羊仅剩装备/判定可选)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const scroll = makeCard('spy', '顺手牵羊', '♠', '4', '锦囊牌');
    const state = buildState({
      p0Hand: ['c1', 'c2'],
      p1Hand: ['spy'],
      extraCards: { c1, c2, spy: scroll },
      p1Skills: ['顺手牵羊', '杀'],
      currentPlayer: 1,
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P1 对陆逊使用顺手牵羊(target=陆逊=0)
    await P1.triggerAction('顺手牵羊', 'use', { cardId: 'spy', target: 0 });

    // 无懈窗口 → pass → 谦逊触发
    P1.expectPending('请求回应');
    await P1.pass();

    // 谦逊 prompt
    P0.expectPending('请求回应');
    await P0.respond('界谦逊', { choice: true });
    await harness.waitForStable();

    // 手牌移出
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c1', 'c2']);

    // 顺手牵羊继续:弹选牌面板让 P1 选一张牌(此时陆逊手牌为空,只剩装备/判定区可选)
    // 简单 pass(超时默认 handIndex=0,但 hand 空 → pickedCard=undefined → 不获得任何牌)
    P1.expectPending('请求回应');
    await P1.respond('顺手牵羊', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();

    // 谦逊移出的牌仍在 vars(未被顺手牵羊获得)
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c1', 'c2']);
    expect(harness.state.players[1].hand).not.toContain('c1');
    expect(harness.state.players[1].hand).not.toContain('c2');
  });

  // ─── 9. 他人对陆逊使用过河拆桥 → 谦逊触发 → 确认 → 手牌移出 ────────────
  it('他人对陆逊使用过河拆桥 → 无懈超时 → 谦逊触发 → 确认 → 手牌移出(过河拆桥无可弃牌)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const scroll = makeCard('gcq', '过河拆桥', '♠', '4', '锦囊牌');
    const state = buildState({
      p0Hand: ['c1', 'c2'],
      p1Hand: ['gcq'],
      extraCards: { c1, c2, gcq: scroll },
      p1Skills: ['过河拆桥', '杀'],
      currentPlayer: 1,
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P1 对陆逊使用过河拆桥
    await P1.useCardAndTarget('过河拆桥', 'gcq', [0]);

    // 无懈窗口 → pass → 谦逊触发
    P1.expectPending('请求回应');
    await P1.pass();

    // 谦逊 prompt
    P0.expectPending('请求回应');
    await P0.respond('界谦逊', { choice: true });
    await harness.waitForStable();

    // 手牌移出
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c1', 'c2']);

    // 过河拆桥继续:选牌面板(hand 空 → pickedCard=undefined → 不弃任何牌)
    P1.expectPending('请求回应');
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();

    // 谦逊移出的牌未进弃牌堆(移出 ≠ 弃置)
    expect(harness.state.zones.discardPile).not.toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c2');
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c1', 'c2']);
  });

  // ─── 10. 他人对陆逊使用火攻 → 谦逊触发 → 确认 → 手牌移出(火攻因无手牌可展示而失效) ────
  it('他人对陆逊使用火攻 → 无懈超时 → 谦逊触发 → 确认 → 手牌移出 → 火攻失效(陆逊无手牌可展示)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const scroll = makeCard('hg', '火攻', '♥', '2', '锦囊牌');
    const match = makeCard('m1', '桃', '♥', '5'); // P1 用于弃的 ♥ 牌(若火攻能进行到这一步)
    const state = buildState({
      p0Hand: ['c1', 'c2'],
      p1Hand: ['hg', 'm1'],
      extraCards: { c1, c2, hg: scroll, m1: match },
      p1Skills: ['火攻', '杀'],
      currentPlayer: 1,
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const p0HealthBefore = harness.state.players[0].health;

    // P1 对陆逊使用火攻
    await P1.useCardAndTarget('火攻', 'hg', [0]);

    // 无懈窗口 → pass → 谦逊触发
    P1.expectPending('请求回应');
    await P1.pass();

    // 谦逊 prompt
    P0.expectPending('请求回应');
    await P0.respond('界谦逊', { choice: true });
    await harness.waitForStable();

    // 手牌移出
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c1', 'c2']);

    // 火攻继续:目标须展示一张手牌,但陆逊手牌为空 → 火攻失效(跳过展示)→ 无伤害
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(p0HealthBefore);
    // 火攻牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('hg');
  });
});
