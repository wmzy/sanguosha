// tests/skill-tests/成略.test.ts
// 许攸(群·风林火山 hero/406)三技能测试:成略 / 恃才 / 寸目
//
// 成略(主动技·转换技):阳摸1弃2 / 阴摸2弃1,本阶段同花色牌无距离和次数限制,发动后翻态。
// 恃才(被动技):每回合首次使用某类型牌后,可置牌堆顶并摸一张。
// 寸目(锁定技):摸牌改从牌堆底摸。
//
// 测试要点:被杀目标须持有一张【闪】,使其成为阻塞型询问闪 pending(否则无闪时
// dodge 被 preResolve 自动跳过,runUseFlow 直接到使用结算结束后,恃才询问成为唯一 pending,
// 此时 target.pass() 会误超时恃才询问而非 dodge)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, assertNoEngineErrors } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, Faction, PlayerState } from '../../src/engine/types';

// 注册许攸三技能(subagent 不碰 index.ts,测试中直接赋值)
setSkillModuleOverride('成略', () => import('../../src/engine/skills/成略').then((m) => m.default));
setSkillModuleOverride('恃才', () => import('../../src/engine/skills/恃才').then((m) => m.default));
setSkillModuleOverride('寸目', () => import('../../src/engine/skills/寸目').then((m) => m.default));

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  faction?: Faction;
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '许攸',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['成略', '恃才', '寸目'],
    vars: (opts.vars as PlayerState['vars']) ?? {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '群',
    identity: '忠臣',
  };
}

describe('寸目', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('摸牌从牌堆底摸(deck[0]=底)', async () => {
    // deck: ['db1','dt1'] —— db1 在 index0=牌堆底, dt1 在 index1=牌堆顶
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      zones: { deck: ['db1', 'dt1'], discardPile: [], processing: [] },
      cardMap: {
        db1: makeCard('db1', '杀', '♠'),
        dt1: makeCard('dt1', '桃', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await applyAtom(harness.state, { type: '摸牌', player: 0, count: 1 });

    // 寸目 → 从牌堆底摸 db1
    expect(harness.state.players[0].hand).toContain('db1');
    expect(harness.state.players[0].hand).not.toContain('dt1');
    expect(harness.state.zones.deck).toEqual(['dt1']);
  });

  it('摸两张均从牌堆底(顺序 deck[0]→deck[1])', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      zones: { deck: ['db1', 'db2', 'dt1'], discardPile: [], processing: [] },
      cardMap: {
        db1: makeCard('db1', '杀', '♠'),
        db2: makeCard('db2', '杀', '♣'),
        dt1: makeCard('dt1', '桃', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await applyAtom(harness.state, { type: '摸牌', player: 0, count: 2 });

    // 寸目 → 先摸 db1(最底),再摸 db2;dt1(顶)留存
    expect(harness.state.players[0].hand).toEqual(['db1', 'db2']);
    expect(harness.state.zones.deck).toEqual(['dt1']);
  });

  it('不影响其他玩家摸牌(只对 owner 生效)', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'], hand: [] }),
      ],
      zones: { deck: ['db1', 'dt1'], discardPile: [], processing: [] },
      cardMap: {
        db1: makeCard('db1', '杀', '♠'),
        dt1: makeCard('dt1', '桃', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P2(无寸目)摸牌 → 从牌堆顶摸 dt1
    await applyAtom(harness.state, { type: '摸牌', player: 1, count: 1 });
    expect(harness.state.players[1].hand).toContain('dt1');
    expect(harness.state.zones.deck).toEqual(['db1']);
  });
});

describe('恃才', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('首次使用基本牌(杀)后发动:杀置牌堆顶 + 摸一张(从底)', async () => {
    // deck: ['db1','dt1'] —— 恃才摸牌(寸目)从底摸 db1;杀 s1 置顶(deck 末尾)
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          health: 4,
          maxHealth: 4,
          skills: ['闪'],
          hand: ['dodge'], // 持有闪 → 阻塞型询问闪
        }),
      ],
      zones: { deck: ['db1', 'dt1'], discardPile: [], processing: [] },
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        dodge: makeCard('dodge', '闪', '♥', '2'),
        db1: makeCard('db1', '桃', '♥'),
        dt1: makeCard('dt1', '杀', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀 → P2 不闪(超时)→ 恃才询问 → 发动
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass(); // 超时询问闪(P2 不出闪)
    await P1.respond('恃才', { choice: true });
    assertNoEngineErrors(harness.state);

    // 杀 s1 置牌堆顶(deck 末尾);摸牌从底摸 db1
    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('s1');
    expect(harness.state.players[0].hand).toContain('db1');
    // 杀不在弃牌堆(已置顶)
    expect(harness.state.zones.discardPile).not.toContain('s1');
  });

  it('同类型第二次使用不触发恃才', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', health: 2, hand: ['s1', 't1'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          health: 4,
          maxHealth: 4,
          skills: ['闪'],
          hand: ['dodge'],
        }),
      ],
      zones: { deck: ['db1', 'dt1'], discardPile: [], processing: [] },
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        t1: makeCard('t1', '桃', '♥', '3'),
        dodge: makeCard('dodge', '闪', '♣', '2'),
        db1: makeCard('db1', '杀', '♥'),
        dt1: makeCard('dt1', '杀', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一张基本牌:杀 → 恃才触发 → 不发动
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    await P1.respond('恃才', { choice: false });

    // 第二张基本牌:桃(自奶)→ 恃才不应再触发(无 pending)
    await P1.useCard('桃', 't1');
    await harness.waitForStable();
    assertNoEngineErrors(harness.state);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('不同类型各触发一次(基本牌+锦囊牌)', async () => {
    // 用杀(基本)触发恃才;再用无中生有(锦囊,首次)也触发。验证类型追踪。
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1', 'wzsy'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          health: 4,
          maxHealth: 4,
          skills: ['闪'],
          hand: ['dodge'],
        }),
      ],
      zones: { deck: ['db1', 'dt1', 'db2', 'dt2'], discardPile: [], processing: [] },
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        wzsy: makeCard('wzsy', '无中生有', '♥', '5', '锦囊牌'),
        dodge: makeCard('dodge', '闪', '♥', '2'),
        db1: makeCard('db1', '桃', '♥'),
        dt1: makeCard('dt1', '杀', '♦'),
        db2: makeCard('db2', '桃', '♦'),
        dt2: makeCard('dt2', '杀', '♠'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 基本牌·杀 → 恃才触发 → 发动(杀置顶 + 摸底)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    await P1.respond('恃才', { choice: true });
    expect(harness.state.players[0].hand).toContain('db1');
    expect(harness.state.turn.vars['恃才/已用类型']).toEqual(['基本牌']);

    // 锦囊牌·无中生有(首次锦囊)→ 恃才应再次触发
    await P1.useCard('无中生有', 'wzsy');
    await P2.pass(); // 无懈可击广播 → 无人出
    // 无中生有结算(摸2)→ 恃才询问(使用结算结束后)
    await P1.respond('恃才', { choice: false });
    await harness.waitForStable();
    assertNoEngineErrors(harness.state);

    // 锦囊牌已计入类型追踪(基本牌 + 锦囊牌)
    expect(harness.state.turn.vars['恃才/已用类型']).toEqual(['基本牌', '锦囊牌']);
  });
});

describe('成略', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('阳: 摸1弃2 + 翻转为阴', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1', 'h2', 'h3'] }),
        makePlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4, skills: ['闪'] }),
      ],
      zones: { deck: ['db1', 'dt1'], discardPile: [], processing: [] },
      cardMap: {
        h1: makeCard('h1', '杀', '♠', '7'),
        h2: makeCard('h2', '杀', '♣', '8'),
        h3: makeCard('h3', '桃', '♥', '3'),
        db1: makeCard('db1', '闪', '♦'),
        dt1: makeCard('dt1', '杀', '♠'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 默认阳态
    expect(harness.state.players[0].vars['成略/态'] ?? '阳').toBe('阳');

    await P1.triggerAction('成略', 'use', {});
    // 摸1(寸目底 db1)→ 手牌 4 → 选弃2
    await P1.respond('成略', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();
    assertNoEngineErrors(harness.state);

    // 摸了 db1,弃了 h1/h2 → 手牌含 h3, db1
    expect(harness.state.players[0].hand).toContain('db1');
    expect(harness.state.players[0].hand).toContain('h3');
    expect(harness.state.players[0].hand).not.toContain('h1');
    expect(harness.state.players[0].hand).not.toContain('h2');
    expect(harness.state.zones.discardPile).toContain('h1');
    expect(harness.state.zones.discardPile).toContain('h2');
    // 翻转为阴
    expect(harness.state.players[0].vars['成略/态']).toBe('阴');
    // 记录花色 ♠ ♣
    expect(harness.state.turn.vars['成略/suits']).toEqual(['♠', '♣']);
  });

  it('阴: 摸2弃1 + 翻转为阳(从阴态起始)', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1'], vars: { '成略/态': '阴' } }),
        makePlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4, skills: ['闪'] }),
      ],
      zones: { deck: ['db1', 'db2', 'dt1'], discardPile: [], processing: [] },
      cardMap: {
        h1: makeCard('h1', '杀', '♠', '7'),
        db1: makeCard('db1', '杀', '♥'),
        db2: makeCard('db2', '桃', '♦'),
        dt1: makeCard('dt1', '杀', '♠'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    expect(harness.state.players[0].vars['成略/态']).toBe('阴');

    await P1.triggerAction('成略', 'use', {});
    await P1.respond('成略', { cardIds: ['h1'] });
    await harness.waitForStable();
    assertNoEngineErrors(harness.state);

    // 摸了 db1,db2;弃了 h1
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['db1', 'db2']));
    expect(harness.state.players[0].hand).not.toContain('h1');
    expect(harness.state.players[0].vars['成略/态']).toBe('阳');
    expect(harness.state.turn.vars['成略/suits']).toEqual(['♠']);
  });

  it('同花色杀无次数限制(弃♠后可连续出多张♠杀)', async () => {
    // 4人环:P1→P2 距离1(相邻)。弃♠后 ♠杀无次数限制。
    const deckIds = ['db1', 'dt1', 'db2', 'dt2', 'db3', 'dt3'];
    const cardMap: Record<string, Card> = {
      h1: makeCard('h1', '杀', '♠', '7'),
      h2: makeCard('h2', '杀', '♣', '8'),
      sk1: makeCard('sk1', '杀', '♠', '2'), // ♠杀(同花色)
      sk2: makeCard('sk2', '杀', '♠', '3'), // ♠杀(同花色)
    };
    for (const id of deckIds) cardMap[id] = makeCard(id, '闪', '♥');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1', 'h2', 'sk1', 'sk2'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          health: 4,
          maxHealth: 4,
          skills: ['闪'],
          hand: ['dg1', 'dg2'],
        }),
        makePlayer({ index: 2, name: 'P3', health: 4, maxHealth: 4, skills: ['闪'] }),
        makePlayer({ index: 3, name: 'P4', health: 4, maxHealth: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...deckIds], discardPile: [], processing: [] },
      cardMap: { ...cardMap, dg1: makeCard('dg1', '闪', '♥'), dg2: makeCard('dg2', '闪', '♦') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 发动成略,弃 ♠ ♣ → 同花色含 ♠
    await P1.triggerAction('成略', 'use', {});
    await P1.respond('成略', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    // 第一张 ♠杀(首张基本牌→恃才触发,不发动)
    await P1.useCardAndTarget('杀', 'sk1', [1]);
    await P2.pass();
    await P1.respond('恃才', { choice: false });

    // 第二张 ♠杀(同花色豁免→不占次数→允许)
    await P1.useCardAndTarget('杀', 'sk2', [1]);
    await P2.pass();
    await harness.waitForStable();
    assertNoEngineErrors(harness.state);

    // P2 受两刀伤害 4→2
    expect(harness.state.players[1].health).toBe(2);
  });

  it('同花色杀无距离限制(弃♠后♠杀命中超距目标)', async () => {
    // 4人环:P1(0)→P3(2)距离2 > 徒手范围1。弃♠后 ♠杀无距离限制。
    const deckIds = ['db1', 'dt1', 'db2', 'dt2'];
    const cardMap: Record<string, Card> = {
      h1: makeCard('h1', '杀', '♠', '7'),
      h2: makeCard('h2', '杀', '♣', '8'),
      sk1: makeCard('sk1', '杀', '♠', '2'), // ♠杀(同花色)
    };
    for (const id of deckIds) cardMap[id] = makeCard(id, '闪', '♥');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1', 'h2', 'sk1'] }),
        makePlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4, skills: ['闪'] }),
        makePlayer({
          index: 2,
          name: 'P3',
          health: 4,
          maxHealth: 4,
          skills: ['闪'],
          hand: ['dg3'],
        }),
        makePlayer({ index: 3, name: 'P4', health: 4, maxHealth: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...deckIds], discardPile: [], processing: [] },
      cardMap: { ...cardMap, dg3: makeCard('dg3', '闪', '♥') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // 发动成略,弃 ♠ ♣
    await P1.triggerAction('成略', 'use', {});
    await P1.respond('成略', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    // ♠杀指定超距 P3(距离2)→ 成略豁免 → 命中
    await P1.useCardAndTarget('杀', 'sk1', [2]);
    await P3.pass();
    await P1.respond('恃才', { choice: false });
    assertNoEngineErrors(harness.state);

    expect(harness.state.players[2].health).toBe(3);
  });

  it('非同花色杀仍受次数限制(弃♠后♥杀第二张被拒)', async () => {
    const deckIds = ['db1', 'dt1', 'db2', 'dt2'];
    const cardMap: Record<string, Card> = {
      h1: makeCard('h1', '杀', '♠', '7'),
      h2: makeCard('h2', '杀', '♣', '8'),
      sk1: makeCard('sk1', '杀', '♠', '2'), // ♠杀(同花色,豁免)
      skH: makeCard('skH', '杀', '♥', '3'), // ♥杀(非同花色,占次数)
    };
    for (const id of deckIds) cardMap[id] = makeCard(id, '闪', '♥');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1', 'h2', 'sk1', 'skH'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          health: 4,
          maxHealth: 4,
          skills: ['闪'],
          hand: ['dg1', 'dg2'],
        }),
      ],
      zones: { deck: [...deckIds], discardPile: [], processing: [] },
      cardMap: { ...cardMap, dg1: makeCard('dg1', '闪', '♥'), dg2: makeCard('dg2', '闪', '♦') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 发动成略,弃 ♠ ♣ → 同花色含 ♠ ♣(不含 ♥)
    await P1.triggerAction('成略', 'use', {});
    await P1.respond('成略', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    // 出 ♥杀(非同花色,占次数)→ 命中
    await P1.useCardAndTarget('杀', 'skH', [1]);
    await P2.pass();
    await P1.respond('恃才', { choice: false });
    expect(harness.state.players[1].health).toBe(3);

    // 再出 ♥杀(非同花色,次数已用尽)→ 应被拒(dispatch 无效,P2 不再受伤)
    await P1.useCardAndTarget('杀', 'skH', [1]);
    await harness.waitForStable();
    assertNoEngineErrors(harness.state);
    expect(harness.state.players[1].health).toBe(3);
  });

  it('出牌阶段限一次(第二次发动被拒)', async () => {
    const deckIds = ['db1', 'dt1', 'db2', 'dt2', 'db3', 'dt3'];
    const cardMap: Record<string, Card> = {
      h1: makeCard('h1', '杀', '♠', '7'),
      h2: makeCard('h2', '杀', '♣', '8'),
      h3: makeCard('h3', '杀', '♥', '9'),
      h4: makeCard('h4', '杀', '♦', '4'),
    };
    for (const id of deckIds) cardMap[id] = makeCard(id, '闪', '♥');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1', 'h2', 'h3', 'h4'] }),
        makePlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...deckIds], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次发动(阳→阴)
    await P1.triggerAction('成略', 'use', {});
    await P1.respond('成略', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['成略/态']).toBe('阴');

    // 第二次发动应被拒(限一次)→ 不产生弃牌询问
    await P1.triggerAction('成略', 'use', {});
    await harness.waitForStable();
    assertNoEngineErrors(harness.state);
    expect(harness.state.pendingSlots.size).toBe(0);
    // 态仍为阴(未翻转)
    expect(harness.state.players[0].vars['成略/态']).toBe('阴');
  });
});
