// 周妃(吴·风林火山,OL hero/411)技能测试:良姻 + 箜声。
//
// 箜声:准备阶段置牌(移出游戏)→ 结束阶段获得非装备牌 + 令角色使用装备牌并失体力。
// 良姻:每回合首次牌移出/移入游戏 → 与一名其他角色各摸/弃一张 → 可令手牌数==X者回血。
//
// 通过直接 dispatch 阶段开始(准备/回合结束)触发阶段技;
// 箜声置牌走 移出至暂存区 → 触发良姻(挂在其 after-hook)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import { applyAtom } from '../../src/engine/core/apply';
import { createGameState } from '../../src/engine/types';
import type { Card, Faction, GameState, PlayerState } from '../../src/engine/types';

// 注册周妃技能(测试注入,见 lifecycle.setSkillModuleOverride)
setSkillModuleOverride('良姻', () =>
  import('../../src/engine/skills/良姻').then((m) => m.default));
setSkillModuleOverride('箜声', () =>
  import('../../src/engine/skills/箜声').then((m) => m.default));

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  subtype?: string,
): Card {
  return {
    id,
    name,
    suit,
    color: suit === '♠' || suit === '♣' ? '黑' : '红',
    rank,
    type,
    subtype,
    ...(type === '装备牌' && subtype === '武器' ? { range: 2 } : {}),
  };
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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '周妃',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['良姻', '箜声'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '吴',
    identity: '忠臣',
  };
}

/** 触发 player 0(周妃)的准备阶段 */
function triggerReadyPhase(harness: SkillTestHarness): void {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
}

/** 触发 player 0(周妃)的结束阶段(回合结束) */
function triggerEndPhase(harness: SkillTestHarness): void {
  void applyAtom(harness.state, {
    type: '阶段开始',
    player: 0,
    phase: '回合结束',
  });
}

/** 当前阻塞型 pending 的 requestType(无则 null) */
function currentRequestType(state: GameState): string | null {
  for (const slot of state.pendingSlots.values()) {
    if (slot.atom.type === '请求回应') {
      return (slot.atom as { requestType?: string }).requestType ?? null;
    }
  }
  return null;
}

/** owner.vars['箜声/牌'] 列表 */
function kongshengCards(state: GameState): string[] {
  return (state.players[0].vars['箜声/牌'] as string[] | undefined) ?? [];
}

describe('箜声', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 准备阶段:置牌于武将牌上 ──────────────────────────────
  it('准备阶段置牌 → 牌移至武将牌上(vars),手牌减少', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '周妃', hand: ['c1', 'c2'], health: 2 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: { c1: makeCard('c1', '杀'), c2: makeCard('c2', '闪') },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const 周妃 = harness.player('周妃');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    expect(currentRequestType(harness.state)).toBe('箜声/confirm');

    await 周妃.respond('箜声', { choice: true }); // 发动箜声
    await waitForStable(harness.state);
    expect(currentRequestType(harness.state)).toBe('箜声/select');

    await 周妃.respond('箜声', { cardIds: ['c1'] }); // 置 c1
    await waitForStable(harness.state);
    // 移出至暂存区触发良姻(移出游戏)→ 良姻 confirm
    expect(currentRequestType(harness.state)).toBe('良姻/confirm');
    await 周妃.respond('良姻', { choice: false }); // 不发动良姻(隔离箜声)
    await harness.waitForStable();

    // c1 在武将牌上(箜声牌),手牌仅剩 c2
    expect(kongshengCards(harness.state)).toEqual(['c1']);
    expect(harness.state.players[0].hand).toEqual(['c2']);
  });

  // ─── 准备阶段:不发动 ────────────────────────────────────────
  it('准备阶段选择不发动箜声 → 无置牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '周妃', hand: ['c1'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: { c1: makeCard('c1', '杀') },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const 周妃 = harness.player('周妃');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { choice: false }); // 不发动
    await harness.waitForStable();

    expect(kongshengCards(harness.state)).toEqual([]);
    expect(harness.state.players[0].hand).toEqual(['c1']);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 结束阶段:获得非装备牌 ──────────────────────────────────
  it('结束阶段:非装备箜声牌获得到手牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '周妃', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: { c1: makeCard('c1', '杀'), c2: makeCard('c2', '闪') },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    // 模拟准备阶段已置两张非装备牌;且良姻本回合已触发(避免归还时再触发)
    // vars/turn.vars 不投影到 view,直接 mutate 无需重建视图
    harness.state.players[0].vars['箜声/牌'] = ['c1', 'c2'];
    harness.state.turn.vars['良姻/已触发/0'] = true;

    triggerEndPhase(harness);
    await harness.waitForStable();

    // 非装备牌获得到手牌;无装备牌故无询问、无失体力
    expect(harness.state.players[0].hand).toEqual(
      expect.arrayContaining(['c1', 'c2']),
    );
    expect(kongshengCards(harness.state)).toEqual([]);
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(3); // 未失体力
  });

  // ─── 结束阶段:装备牌使用 + 失体力 ───────────────────────────
  it('结束阶段:装备牌令目标使用并失去1点体力', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '周妃', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: {
        e1: makeCard('e1', '青钢剑', '♠', 'A', '装备牌', '武器'),
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    // 模拟准备阶段已置一张装备牌;良姻本回合已触发
    harness.state.players[0].vars['箜声/牌'] = ['e1'];
    harness.state.turn.vars['良姻/已触发/0'] = true;
    const 周妃 = harness.player('周妃');

    triggerEndPhase(harness);
    await waitForStable(harness.state);
    // 有装备牌 → 询问使用目标
    expect(currentRequestType(harness.state)).toBe('箜声/target');
    await 周妃.respond('箜声', { target: 1 }); // 令 P1 使用
    await harness.waitForStable();

    // e1 装备在 P1 武器栏;P1 失去1点体力
    expect(harness.state.players[1].equipment['武器']).toBe('e1');
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.players[0].hand).not.toContain('e1');
  });

  // ─── 结束阶段:无箜声牌时不触发 ───────────────────────────────
  it('结束阶段无箜声牌 → 无效果', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '周妃', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    triggerEndPhase(harness);
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(3);
  });
});

describe('良姻', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 摸模式 + 回血(完整流程)──────────────────────────────
  it('箜声置牌触发良姻 → 选目标+各摸1 → 回血手牌数==X者', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '周妃',
          hand: ['c1', 'c2'],
          health: 2,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          health: 2,
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        d1: makeCard('d1', '桃', '♥'),
        d2: makeCard('d2', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 周妃 = harness.player('周妃');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { choice: true }); // 发动箜声
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { cardIds: ['c1'] }); // 置 c1(X=1)
    await waitForStable(harness.state);
    // 良姻触发
    expect(currentRequestType(harness.state)).toBe('良姻/confirm');
    await 周妃.respond('良姻', { choice: true }); // 发动良姻
    await waitForStable(harness.state);
    expect(currentRequestType(harness.state)).toBe('良姻/目标');
    await 周妃.respond('良姻', { targets: [1] }); // 选 P1
    await waitForStable(harness.state);
    expect(currentRequestType(harness.state)).toBe('良姻/摸弃');
    await 周妃.respond('良姻', { choice: true }); // 各摸一张
    await waitForStable(harness.state);

    // X=1:周妃摸后手牌 [c2,d2]=2≠1;P1 摸后 [d1]=1==X → 候选(摸牌从牌堆末尾抽)
    expect(currentRequestType(harness.state)).toBe('良姻/回血');
    await 周妃.respond('良姻', { targets: [1] }); // 令 P1 回血
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toEqual(['c2', 'd2']);
    expect(harness.state.players[1].hand).toEqual(['d1']);
    expect(harness.state.players[1].health).toBe(3); // 回复1点
    expect(kongshengCards(harness.state)).toEqual(['c1']);
  });

  // ─── 弃模式 ────────────────────────────────────────────────
  it('良姻弃模式 → 双方各弃一张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '周妃',
          hand: ['c1', 'c2'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1'],
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        p1: makeCard('p1', '桃', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const 周妃 = harness.player('周妃');
    const P1 = harness.player('P1');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { choice: true });
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { cardIds: ['c1'] }); // 置 c1(手牌剩 c2)
    await waitForStable(harness.state);
    await 周妃.respond('良姻', { choice: true });
    await waitForStable(harness.state);
    await 周妃.respond('良姻', { targets: [1] });
    await waitForStable(harness.state);
    await 周妃.respond('良姻', { choice: false }); // 各弃一张
    await waitForStable(harness.state);
    // 周妃弃(手牌有 c2)
    expect(currentRequestType(harness.state)).toBe('良姻/弃牌');
    await 周妃.respond('良姻', { cardIds: ['c2'] });
    await waitForStable(harness.state);
    // P1 弃(手牌有 p1)
    expect(currentRequestType(harness.state)).toBe('良姻/弃牌');
    await P1.respond('良姻', { cardIds: ['p1'] });
    await waitForStable(harness.state);

    // X=1:双方弃后手牌均 0 → 无手牌数==1 者 → 无回血询问
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toEqual(
      expect.arrayContaining(['c2', 'p1']),
    );
  });

  // ─── 每回合只触发一次 ───────────────────────────────────────
  it('良姻每回合仅触发一次(结束阶段归还不再触发)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '周妃',
          hand: ['c1', 'c2'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: { c1: makeCard('c1', '杀'), c2: makeCard('c2', '闪') },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const 周妃 = harness.player('周妃');

    // 准备阶段:置牌 → 良姻触发(拒绝)→ 标记已消耗
    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { choice: true });
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { cardIds: ['c1'] });
    await waitForStable(harness.state);
    expect(currentRequestType(harness.state)).toBe('良姻/confirm');
    await 周妃.respond('良姻', { choice: false }); // 拒绝,但触发已消耗
    await harness.waitForStable();
    expect(harness.state.turn.vars['良姻/已触发/0']).toBe(true);

    // 结束阶段:归还(移入游戏)→ 良姻不再触发
    triggerEndPhase(harness);
    await harness.waitForStable();
    // 无良姻询问(非装备牌直接获得,无装备牌无询问)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── 拒绝发动良姻 ───────────────────────────────────────────
  it('拒绝发动良姻 → 无摸弃无回血', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '周妃', hand: ['c1'], health: 2 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: { c1: makeCard('c1', '杀') },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const 周妃 = harness.player('周妃');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { choice: true });
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { cardIds: ['c1'] });
    await waitForStable(harness.state);
    await 周妃.respond('良姻', { choice: false }); // 拒绝
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(3); // 未回血
    expect(harness.state.players[1].hand.length).toBe(0); // 未摸牌
  });

  // ─── 回血可放弃(不选目标)──────────────────────────────────
  it('回血阶段放弃(不选)→ 不回血', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '周妃',
          hand: ['c1', 'c2'],
          health: 2,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          health: 2,
          skills: [],
          faction: '魏',
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        d1: makeCard('d1', '桃', '♥'),
        d2: makeCard('d2', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 周妃 = harness.player('周妃');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { choice: true });
    await waitForStable(harness.state);
    await 周妃.respond('箜声', { cardIds: ['c1'] });
    await waitForStable(harness.state);
    await 周妃.respond('良姻', { choice: true });
    await waitForStable(harness.state);
    await 周妃.respond('良姻', { targets: [1] });
    await waitForStable(harness.state);
    await 周妃.respond('良姻', { choice: true }); // 各摸一张
    await waitForStable(harness.state);
    expect(currentRequestType(harness.state)).toBe('良姻/回血');
    // 放弃回血(超时/pass)
    await 周妃.pass();
    await harness.waitForStable();

    // 摸牌生效但未回血(摸牌从牌堆末尾抽:P1 摸 d1)
    expect(harness.state.players[1].hand).toEqual(['d1']);
    expect(harness.state.players[1].health).toBe(2); // 未回血
  });
});
