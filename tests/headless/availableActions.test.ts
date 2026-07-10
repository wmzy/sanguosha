// tests/headless/availableActions.test.ts
import { describe, it, expect } from 'vitest';
import { enumerateAvailableActions } from '../../src/client/headless/availableActions';
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
    expect(actions).toHaveLength(0);
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
});
