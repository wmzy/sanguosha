// tests/headless/availableActions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { enumerateAvailableActions } from '../../src/client/headless/availableActions';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView, Card } from '../../src/engine/types';
import type { SkillActionDef } from '../../src/client/skillActionRegistry';

function makeView(
  seat: number,
  phase: GameView['phase'],
  hand: Card[],
  currentPlayer = seat,
): GameView {
  return {
    viewer: seat,
    currentPlayerIndex: currentPlayer,
    phase,
    turn: { round: 1, phase, vars: {} },
    players: [
      {
        index: seat,
        name: 'P0',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['杀'],
        handCount: hand.length,
        hand,
        marks: [],
      },
      {
        index: 1,
        name: 'P1',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 4,
        marks: [],
      },
    ],
    cardMap: Object.fromEntries(hand.map((c) => [c.id, c])),
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

// 3 玩家 view（用于距离过滤测试：玩家1在范围内，玩家2不在）
function makeView3(
  seat: number,
  phase: GameView['phase'],
  hand: Card[],
  currentPlayer = seat,
): GameView {
  return {
    viewer: seat,
    currentPlayerIndex: currentPlayer,
    phase,
    turn: { round: 1, phase, vars: {} },
    players: [
      {
        index: seat,
        name: 'P0',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['杀'],
        handCount: hand.length,
        hand,
        marks: [],
      },
      {
        index: 1,
        name: 'P1',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 4,
        marks: [],
      },
      {
        index: 2,
        name: 'P2',
        character: '孙权',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 4,
        marks: [],
      },
    ],
    cardMap: Object.fromEntries(hand.map((c) => [c.id, c])),
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

const killCard: Card = { id: 'c1', name: '杀', suit: '♠', color: '黑', rank: '5', type: '基本牌' };
const redCard: Card = { id: 'c2', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' };
const redCard2: Card = { id: 'c3', name: '闪', suit: '♦', color: '红', rank: '7', type: '基本牌' };

// 杀的 use action：useCardAndTarget，cardFilter 匹配 name==='杀'，targetFilter 选一个其他玩家
const killUseAction: SkillActionDef = {
  skillId: '杀',
  ownerId: 0,
  actionType: 'use',
  label: '杀',
  prompt: {
    type: 'useCardAndTarget',
    title: '杀',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  },
};

// 带距离过滤的杀 use action：只允许攻击玩家1（模拟玩家2距离不够）
const killUseActionWithFilter: SkillActionDef = {
  skillId: '杀',
  ownerId: 0,
  actionType: 'use',
  label: '杀',
  prompt: {
    type: 'useCardAndTarget',
    title: '杀',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1, filter: (_view: GameView, target: number) => target === 1 },
  },
};

// 所有目标都距离不够的杀 use action
const killUseActionAllOutOfRange: SkillActionDef = {
  skillId: '杀',
  ownerId: 0,
  actionType: 'use',
  label: '杀',
  prompt: {
    type: 'useCardAndTarget',
    title: '杀',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1, filter: () => false },
  },
};

// 带距离过滤的武圣 transform action：只允许攻击玩家1
const wushengTransformActionWithFilter: SkillActionDef = {
  skillId: '武圣',
  ownerId: 0,
  actionType: 'transform',
  label: '武圣',
  prompt: {
    type: 'useCardAndTarget',
    title: '选择一张红色牌当杀使用',
    cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1, filter: (_view: GameView, target: number) => target === 1 },
  },
  transform: (card: Card) => ({ name: '杀', sourceCardId: card.id, fromSkill: '武圣' }),
};

// 所有目标都距离不够的武圣 transform action
const wushengTransformActionAllOutOfRange: SkillActionDef = {
  skillId: '武圣',
  ownerId: 0,
  actionType: 'transform',
  label: '武圣',
  prompt: {
    type: 'useCardAndTarget',
    title: '选择一张红色牌当杀使用',
    cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1, filter: () => false },
  },
  transform: (card: Card) => ({ name: '杀', sourceCardId: card.id, fromSkill: '武圣' }),
};

// 武圣的 transform action：cardFilter 匹配红色牌，把红色牌当杀
const wushengTransformAction: SkillActionDef = {
  skillId: '武圣',
  ownerId: 0,
  actionType: 'transform',
  label: '武圣',
  prompt: {
    type: 'useCardAndTarget',
    title: '选择一张红色牌当杀使用',
    cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  },
  transform: (card: Card) => ({ name: '杀', sourceCardId: card.id, fromSkill: '武圣' }),
};

// 丈八蛇矛的 transform action（多卡转化）
const zhangbaTransformAction: SkillActionDef = {
  skillId: '丈八蛇矛',
  ownerId: 0,
  actionType: 'transform',
  label: '丈八蛇矛',
  prompt: {
    type: 'useCardAndTarget',
    title: '选择 2 张手牌当杀使用',
    cardFilter: { filter: () => true, min: 2, max: 2 },
    targetFilter: { min: 1, max: 1 },
  },
  transform: (card: Card) => ({ name: '杀', sourceCardId: card.id, fromSkill: '丈八蛇矛' }),
};

// 制衡的 distribute action（select 模式）
const zhihengDistributeAction: SkillActionDef = {
  skillId: '制衡',
  ownerId: 0,
  actionType: 'use',
  label: '制衡',
  prompt: {
    type: 'distribute',
    mode: 'select',
    title: '制衡：选择要弃置的牌（可多选）',
    source: 'handAndEquip',
    minTotal: 1,
    maxTotal: 99,
  },
};

// 仁德的 distribute action（allocate 模式）
const rendeDistributeAction: SkillActionDef = {
  skillId: '仁德',
  ownerId: 0,
  actionType: 'use',
  label: '仁德',
  prompt: {
    type: 'distribute',
    mode: 'allocate',
    title: '仁德：选择要送出的手牌和目标角色',
    source: 'hand',
    minPerTarget: 1,
    maxPerTarget: 99,
    minTotal: 1,
    maxTotal: 99,
    allowSelf: false,
  },
};

describe('enumerateAvailableActions', () => {
  it('出牌阶段枚举手牌中可出的牌，并算出合法目标', () => {
    const view = makeView(0, '出牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    const a = actions.find((x) => x.category === 'play');
    expect(a).toBeDefined();
    expect(a!.message.actionType).toBe('use');
    expect(a!.message.params).toHaveProperty('cardId', 'c1');
    expect(a!.validTargets).toContain(1);
  });

  it('非出牌阶段不枚举主动出牌', () => {
    const view = makeView(0, '摸牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions.find((x) => x.category === 'play')).toBeUndefined();
  });

  it('空手牌不产出牌操作', () => {
    const view = makeView(0, '出牌', []);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    // 空手牌不出牌,但仍可结束出牌阶段
    expect(actions.filter((a) => a.message.actionType !== 'end')).toHaveLength(0);
    expect(actions.find((a) => a.message.actionType === 'end')).toBeDefined();
  });

  // ─── transform 类（武圣/丈八蛇矛） ───

  it('武圣转化：有红色牌时生成 transform action', () => {
    const view = makeView(0, '出牌', [redCard]);
    const actions = enumerateAvailableActions(view, 0, [
      killUseAction,
      wushengTransformAction,
    ]);
    const tf = actions.filter((x) => x.category === 'transform');
    expect(tf.length).toBeGreaterThanOrEqual(1);
    const a = tf[0];
    expect(a.message.skillId).toBe('杀'); // 主 action 是杀.use
    expect(a.message.actionType).toBe('use');
    // cardId 是影子 id `${原id}#武圣`
    expect(a.message.params).toHaveProperty('cardId', 'c2#武圣');
    // preceding 包含武圣 transform
    expect(a.message.preceding).toHaveLength(1);
    expect(a.message.preceding![0].skillId).toBe('武圣');
    expect(a.message.preceding![0].actionType).toBe('transform');
    expect(a.message.preceding![0].params).toHaveProperty('cardId', 'c2');
    // 合法目标包含 P1
    expect(a.validTargets).toContain(1);
  });

  it('武圣转化：多张红色牌每张各生成一个 action', () => {
    const view = makeView(0, '出牌', [redCard, redCard2]);
    const actions = enumerateAvailableActions(view, 0, [wushengTransformAction]);
    const tf = actions.filter((x) => x.category === 'transform');
    expect(tf).toHaveLength(2);
    const cardIds = tf.map((a) => a.message.params.cardId);
    expect(cardIds).toContain('c2#武圣');
    expect(cardIds).toContain('c3#武圣');
  });

  it('武圣转化：非出牌阶段不枚举', () => {
    const view = makeView(0, '摸牌', [redCard]);
    const actions = enumerateAvailableActions(view, 0, [wushengTransformAction]);
    expect(actions.find((x) => x.category === 'transform')).toBeUndefined();
  });

  it('丈八蛇矛转化（多卡）：生成描述性 action，validTargets 为空', () => {
    const view = makeView(0, '出牌', [redCard, redCard2]);
    const actions = enumerateAvailableActions(view, 0, [zhangbaTransformAction]);
    const tf = actions.find((x) => x.category === 'transform');
    expect(tf).toBeDefined();
    expect(tf!.message.skillId).toBe('杀');
    expect(tf!.validTargets).toHaveLength(0);
    expect(tf!.description).toContain('丈八蛇矛');
  });

  // ─── distribute 类（制衡/仁德） ───

  it('制衡分配：出牌阶段生成 distribute action（select 模式）', () => {
    const view = makeView(0, '出牌', [killCard, redCard]);
    const actions = enumerateAvailableActions(view, 0, [
      killUseAction,
      zhihengDistributeAction,
    ]);
    const dist = actions.find((x) => x.category === 'distribute');
    expect(dist).toBeDefined();
    expect(dist!.message.skillId).toBe('制衡');
    expect(dist!.message.actionType).toBe('use');
    expect(dist!.message.params).toHaveProperty('cardIds');
    expect(dist!.message.params.cardIds).toEqual([]); // agent 需自填
    expect(dist!.validTargets).toHaveLength(0); // select 模式无目标
  });

  it('制衡分配：非出牌阶段不枚举', () => {
    const view = makeView(0, '摸牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [zhihengDistributeAction]);
    expect(actions.find((x) => x.category === 'distribute')).toBeUndefined();
  });

  it('仁德分配：出牌阶段生成 distribute action（allocate 模式）', () => {
    const view = makeView(0, '出牌', [killCard, redCard]);
    const actions = enumerateAvailableActions(view, 0, [
      killUseAction,
      rendeDistributeAction,
    ]);
    const dist = actions.find((x) => x.category === 'distribute');
    expect(dist).toBeDefined();
    expect(dist!.message.skillId).toBe('仁德');
    expect(dist!.message.params).toHaveProperty('allocation');
    expect(dist!.message.params.allocation).toEqual([]); // agent 需自填
    // allowSelf=false → 目标不含自己，只有 P1
    expect(dist!.validTargets).toContain(1);
    expect(dist!.validTargets).not.toContain(0);
  });

  it('三种类别同时枚举不冲突', () => {
    const view = makeView(0, '出牌', [killCard, redCard]);
    const actions = enumerateAvailableActions(view, 0, [
      killUseAction,
      wushengTransformAction,
      zhihengDistributeAction,
    ]);
    const cats = new Set(actions.map((a) => a.category));
    expect(cats.has('play')).toBe(true);
    expect(cats.has('transform')).toBe(true);
    expect(cats.has('distribute')).toBe(true);
  });

  // ─── end action（结束出牌阶段）───
  it('出牌阶段+当前玩家+无 pending → 包含 end action', () => {
    const view = makeView(0, '出牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    const end = actions.find((a) => a.message.actionType === 'end');
    expect(end).toBeDefined();
    expect(end!.message.skillId).toBe('回合管理');
    expect(end!.message.ownerId).toBe(0);
    expect(end!.validTargets).toEqual([]);
    expect(end!.category).toBe('play');
  });

  it('出牌阶段+当前玩家+阻塞 pending → 不包含 end action', () => {
    const view = makeView(0, '出牌', [killCard]);
    view.pending = { type: 'awaits', atom: {} as never, prompt: {} as never, target: 0, isBlocking: true };
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions.find((a) => a.message.actionType === 'end')).toBeUndefined();
  });

  it('出牌阶段+当前玩家+非阻塞 pending → 包含 end action', () => {
    const view = makeView(0, '出牌', [killCard]);
    view.pending = { type: 'awaits', atom: {} as never, prompt: {} as never, target: 0, isBlocking: false };
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions.find((a) => a.message.actionType === 'end')).toBeDefined();
  });

  it('非当前玩家 → 不包含 end action', () => {
    const view = makeView(1, '出牌', [killCard], /* currentPlayer */ 0);
    const actions = enumerateAvailableActions(view, 1, [killUseAction]);
    expect(actions.find((a) => a.message.actionType === 'end')).toBeUndefined();
  });

  it('非出牌阶段 → 不包含 end action', () => {
    const view = makeView(0, '摸牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions.find((a) => a.message.actionType === 'end')).toBeUndefined();
  });

  // ─── targetFilter.filter 距离过滤 ───

  it('杀的 validTargets 只包含距离足够的目标（过滤掉距离不够的玩家）', () => {
    const view = makeView3(0, '出牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseActionWithFilter]);
    const play = actions.find((x) => x.category === 'play' && x.message.skillId === '杀');
    expect(play).toBeDefined();
    expect(play!.validTargets).toContain(1);
    expect(play!.validTargets).not.toContain(2);
    expect(play!.validTargets).toHaveLength(1);
  });

  it('所有目标都距离不够时，杀不出现在 availableActions 中', () => {
    const view = makeView3(0, '出牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseActionAllOutOfRange]);
    const play = actions.find((x) => x.category === 'play' && x.message.skillId === '杀');
    expect(play).toBeUndefined();
  });

  it('武圣转化的 validTargets 也应用距离过滤', () => {
    const view = makeView3(0, '出牌', [redCard]);
    const actions = enumerateAvailableActions(view, 0, [wushengTransformActionWithFilter]);
    const tf = actions.filter((x) => x.category === 'transform');
    expect(tf).toHaveLength(1);
    expect(tf[0].validTargets).toContain(1);
    expect(tf[0].validTargets).not.toContain(2);
  });

  it('武圣转化所有目标都距离不够时，不出现在 availableActions 中', () => {
    const view = makeView3(0, '出牌', [redCard]);
    const actions = enumerateAvailableActions(view, 0, [wushengTransformActionAllOutOfRange]);
    const tf = actions.find((x) => x.category === 'transform');
    expect(tf).toBeUndefined();
  });
});

// 回归测试：choosePlayer prompt（突袭/select、激将、节命 等）
//   修复前：兜底分支生成空 params:{} 和空 validTargets:[]，LLM 不知道合法目标
//   修复后：choosePlayer 分支计算合法目标，params.targets 为空数组待 agent 填入
describe('HeadlessGameClient.getAvailableActions() — choosePlayer pending', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('choosePlayer + filter 排除自己:validTargets 正确、params.targets 为空数组', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    const view = makeView3(0, '出牌', []);
    view.pending = {
      type: 'awaits',
      atom: { type: '请求回应', requestType: '突袭/select', target: 0 } as never,
      prompt: {
        type: 'choosePlayer',
        title: '选择突袭目标',
        min: 1,
        max: 1,
        filter: (_v: GameView, target: number) => target !== 0,
      },
      target: 0,
      isBlocking: true,
    };
    (hgc as unknown as { _view: GameView | null })._view = view;

    const actions = hgc.getAvailableActions();
    const respondActions = actions.filter((a) => a.category === 'respond');
    expect(respondActions).toHaveLength(1);
    expect(respondActions[0].message.params).toEqual({ targets: [] });
    expect(respondActions[0].validTargets).toContain(1);
    expect(respondActions[0].validTargets).toContain(2);
    expect(respondActions[0].validTargets).not.toContain(0);
    expect(respondActions[0].validTargets).toHaveLength(2);
    // description 使用 prompt.title
    expect(respondActions[0].description).toBe('选择突袭目标');
  });

  it('choosePlayer 无 filter:所有存活玩家为合法目标', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    const view = makeView3(0, '出牌', []);
    view.pending = {
      type: 'awaits',
      atom: { type: '请求回应', requestType: '激将/select', target: 0 } as never,
      prompt: {
        type: 'choosePlayer',
        title: '激将：选择出杀的角色',
        min: 1,
        max: 1,
      },
      target: 0,
      isBlocking: true,
    };
    (hgc as unknown as { _view: GameView | null })._view = view;

    const actions = hgc.getAvailableActions();
    const respondActions = actions.filter((a) => a.category === 'respond');
    expect(respondActions).toHaveLength(1);
    expect(respondActions[0].message.params).toEqual({ targets: [] });
    // 无 filter → 所有存活玩家（含自己）
    expect(respondActions[0].validTargets).toHaveLength(3);
    expect(respondActions[0].validTargets).toContain(0);
    expect(respondActions[0].validTargets).toContain(1);
    expect(respondActions[0].validTargets).toContain(2);
  });

  it('choosePlayer:死亡玩家不在 validTargets 中', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    const view = makeView3(0, '出牌', []);
    view.players[2].alive = false;
    view.pending = {
      type: 'awaits',
      atom: { type: '请求回应', requestType: '节命/select', target: 0 } as never,
      prompt: {
        type: 'choosePlayer',
        title: '节命：选择目标',
        min: 1,
        max: 1,
      },
      target: 0,
      isBlocking: true,
    };
    (hgc as unknown as { _view: GameView | null })._view = view;

    const actions = hgc.getAvailableActions();
    const respondActions = actions.filter((a) => a.category === 'respond');
    expect(respondActions).toHaveLength(1);
    expect(respondActions[0].validTargets).toHaveLength(2);
    expect(respondActions[0].validTargets).toContain(0);
    expect(respondActions[0].validTargets).toContain(1);
    expect(respondActions[0].validTargets).not.toContain(2);
  });
});

// 回归测试：pickTargetCard prompt（过河拆桥/顺手牵羊/挑衅 选牌）
//   修复前：appendRespondActions 不认识 pickTargetCard，availableActions 只有 skip
//   修复后：为每张装备/判定牌生成 respond 动作，手牌生成盲选动作
describe('HeadlessGameClient.getAvailableActions() — pickTargetCard pending', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('pickTargetCard：装备+判定+手牌都生成可选动作', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    (hgc as unknown as { _debugMode: boolean })._debugMode = true;
    const view = makeView3(0, '出牌', []);
    view.pending = {
      type: 'awaits',
      atom: { type: '请求回应', requestType: '过河拆桥_选牌', target: 0 } as never,
      prompt: {
        type: 'pickTargetCard',
        title: '选择弃置的目标牌',
        target: 1,
        equipment: [
          { slot: 'weapon', cardId: 'equip-1', cardName: '诸葛连弩' },
          { slot: 'armor', cardId: 'equip-2', cardName: '八卦阵' },
        ],
        judge: [{ cardId: 'judge-1', cardName: '乐不思蜀' }],
        handCount: 3,
      },
      target: 0,
      isBlocking: true,
    };
    (hgc as unknown as { _view: GameView | null })._view = view;

    const actions = hgc.getAvailableActions();
    const respondActions = actions.filter((a) => a.category === 'respond');
    // 2 装备 + 1 判定 + 1 手牌盲选 = 4 个动作
    expect(respondActions).toHaveLength(4);

    // 装备动作：zone=equipment, cardId 正确
    const equipActions = respondActions.filter((a) => a.message.params.zone === 'equipment');
    expect(equipActions).toHaveLength(2);
    expect(equipActions[0].message.params.cardId).toBe('equip-1');
    expect(equipActions[1].message.params.cardId).toBe('equip-2');

    // 判定区动作：zone=judge
    const judgeActions = respondActions.filter((a) => a.message.params.zone === 'judge');
    expect(judgeActions).toHaveLength(1);
    expect(judgeActions[0].message.params.cardId).toBe('judge-1');

    // 手牌盲选动作：zone=hand, handIndex=0
    const handActions = respondActions.filter((a) => a.message.params.zone === 'hand');
    expect(handActions).toHaveLength(1);
    expect(handActions[0].message.params.handIndex).toBe(0);
  });

  it('pickTargetCard：只有手牌时生成手牌盲选动作', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    (hgc as unknown as { _debugMode: boolean })._debugMode = true;
    const view = makeView3(0, '出牌', []);
    view.pending = {
      type: 'awaits',
      atom: { type: '请求回应', requestType: '顺手牵羊_选牌', target: 0 } as never,
      prompt: {
        type: 'pickTargetCard',
        title: '选择获得的目标牌',
        target: 1,
        equipment: [],
        judge: [],
        handCount: 2,
      },
      target: 0,
      isBlocking: true,
    };
    (hgc as unknown as { _view: GameView | null })._view = view;

    const actions = hgc.getAvailableActions();
    const respondActions = actions.filter((a) => a.category === 'respond');
    expect(respondActions).toHaveLength(1);
    expect(respondActions[0].message.params.zone).toBe('hand');
    expect(respondActions[0].message.params.handIndex).toBe(0);
  });

  it('pickTargetCard：无牌可选时不生成 respond 动作', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    (hgc as unknown as { _debugMode: boolean })._debugMode = true;
    const view = makeView3(0, '出牌', []);
    view.pending = {
      type: 'awaits',
      atom: { type: '请求回应', requestType: '过河拆桥_选牌', target: 0 } as never,
      prompt: {
        type: 'pickTargetCard',
        title: '选择弃置的目标牌',
        target: 1,
        equipment: [],
        judge: [],
        handCount: 0,
      },
      target: 0,
      isBlocking: true,
    };
    (hgc as unknown as { _view: GameView | null })._view = view;

    const actions = hgc.getAvailableActions();
    const respondActions = actions.filter((a) => a.category === 'respond');
    expect(respondActions).toHaveLength(0);
  });
});
