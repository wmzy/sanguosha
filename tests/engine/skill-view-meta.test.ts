// tests/engine/skill-view-meta.test.ts
// 验证马匹 distanceVars 视图同步:添加技能/移除技能 atom 的 toViewEvents 从
// 静态 马匹距离修正表 查询,applyView 同步/清除 distanceVars。
//
// 替代旧 registerSkillViewDelta 运行时注册(已消除模块级可变 Map + 副作用 import)。
// 静态表从 CardDef.subtype 派生:data/card-defs/equipment.ts。
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms';
import { getAtomDef } from '../../src/engine/core/atom';
import { 马匹距离修正表 } from '../../src/engine/data/card-defs/equipment';
import { createGameState } from '../../src/engine/types';
import type { GameState, GameView } from '../../src/engine/types';

function makeState(): GameState {
  return createGameState({
    players: [
      {
        index: 0,
        name: '玩家0',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        pendingTricks: [],
        skills: [],
        vars: {},
        marks: [],
        tags: [],
      },
    ],
    cardMap: {},
  });
}

function makeView(): GameView {
  const state = makeState();
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: state.players.map((p) => ({
      index: p.index,
      name: p.name,
      character: p.character,
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      equipment: p.equipment,
      skills: p.skills,
      handCount: 0,
      marks: [],
      pendingTricks: [],
      distanceVars: { attackMod: 0, defenseMod: 0, attackRange: 1 },
    })),
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

describe('马匹距离修正表(静态数据)', () => {
  it('进攻马 → attackMod:1', () => {
    expect(马匹距离修正表.get('赤兔')).toEqual({ attackMod: 1 });
    expect(马匹距离修正表.get('紫骍')).toEqual({ attackMod: 1 });
    expect(马匹距离修正表.get('大宛')).toEqual({ attackMod: 1 });
  });

  it('防御马 → defenseMod:1', () => {
    expect(马匹距离修正表.get('的卢')).toEqual({ defenseMod: 1 });
    expect(马匹距离修正表.get('绝影')).toEqual({ defenseMod: 1 });
    expect(马匹距离修正表.get('爪黄飞电')).toEqual({ defenseMod: 1 });
    expect(马匹距离修正表.get('骅骝')).toEqual({ defenseMod: 1 });
  });

  it('非马匹技能无修正', () => {
    expect(马匹距离修正表.get('马术')).toBeUndefined();
    expect(马匹距离修正表.get('仁德')).toBeUndefined();
    expect(马匹距离修正表.get('不存在')).toBeUndefined();
  });
});

describe('添加技能 atom — 马匹 distanceVars 视图同步', () => {
  const def = getAtomDef('添加技能');
  const state = makeState();

  it('进攻马(赤兔)toViewEvents 携带 mountDistanceVars', () => {
    const split = def.toViewEvents!(state, { type: '添加技能', player: 0, skillId: '赤兔' });
    const evt = split!.othersView!;
    expect(evt.mountDistanceVars).toEqual({ attackMod: 1 });
    expect(evt.clearMountDistanceVars).toBeUndefined();
  });

  it('防御马(的卢)toViewEvents 携带 mountDistanceVars', () => {
    const split = def.toViewEvents!(state, { type: '添加技能', player: 0, skillId: '的卢' });
    const evt = split!.othersView!;
    expect(evt.mountDistanceVars).toEqual({ defenseMod: 1 });
  });

  it('非马匹技能 toViewEvents 不携带 mountDistanceVars', () => {
    const split = def.toViewEvents!(state, { type: '添加技能', player: 0, skillId: '仁德' });
    const evt = split!.othersView!;
    expect(evt.mountDistanceVars).toBeUndefined();
  });

  it('applyView:进攻马同步 attackMod 到 distanceVars', () => {
    const view = makeView();
    def.applyView!(view, {
      type: '添加技能',
      player: 0,
      skillId: '赤兔',
      mountDistanceVars: { attackMod: 1 },
    });
    expect(view.players[0].skills).toContain('赤兔');
    expect(view.players[0].distanceVars?.attackMod).toBe(1);
    // defenseMod 不受影响
    expect(view.players[0].distanceVars?.defenseMod).toBe(0);
  });

  it('applyView:防御马同步 defenseMod 到 distanceVars', () => {
    const view = makeView();
    def.applyView!(view, {
      type: '添加技能',
      player: 0,
      skillId: '的卢',
      mountDistanceVars: { defenseMod: 1 },
    });
    expect(view.players[0].skills).toContain('的卢');
    expect(view.players[0].distanceVars?.defenseMod).toBe(1);
    expect(view.players[0].distanceVars?.attackMod).toBe(0);
  });
});

describe('移除技能 atom — 马匹 distanceVars 视图清除', () => {
  const def = getAtomDef('移除技能');
  const state = makeState();

  it('进攻马(赤兔)toViewEvents 携带 clearMountDistanceVars', () => {
    const split = def.toViewEvents!(state, { type: '移除技能', player: 0, skillId: '赤兔' });
    const evt = split!.othersView!;
    expect(evt.clearMountDistanceVars).toEqual({ attackMod: 1 });
    expect(evt.mountDistanceVars).toBeUndefined();
  });

  it('防御马(的卢)toViewEvents 携带 clearMountDistanceVars', () => {
    const split = def.toViewEvents!(state, { type: '移除技能', player: 0, skillId: '的卢' });
    const evt = split!.othersView!;
    expect(evt.clearMountDistanceVars).toEqual({ defenseMod: 1 });
  });

  it('非马匹技能 toViewEvents 不携带 clearMountDistanceVars', () => {
    const split = def.toViewEvents!(state, { type: '移除技能', player: 0, skillId: '仁德' });
    const evt = split!.othersView!;
    expect(evt.clearMountDistanceVars).toBeUndefined();
  });

  it('applyView:进攻马清除 attackMod', () => {
    const view = makeView();
    // 先设 attackMod=1(模拟装备中)
    view.players[0].distanceVars = { attackMod: 1, defenseMod: 0, attackRange: 1 };
    def.applyView!(view, {
      type: '移除技能',
      player: 0,
      skillId: '赤兔',
      clearMountDistanceVars: { attackMod: 1 },
    });
    expect(view.players[0].skills).not.toContain('赤兔');
    expect(view.players[0].distanceVars?.attackMod).toBeUndefined();
    // defenseMod 不受影响
    expect(view.players[0].distanceVars?.defenseMod).toBe(0);
  });

  it('applyView:防御马清除 defenseMod', () => {
    const view = makeView();
    view.players[0].distanceVars = { attackMod: 0, defenseMod: 1, attackRange: 1 };
    def.applyView!(view, {
      type: '移除技能',
      player: 0,
      skillId: '的卢',
      clearMountDistanceVars: { defenseMod: 1 },
    });
    expect(view.players[0].skills).not.toContain('的卢');
    expect(view.players[0].distanceVars?.defenseMod).toBeUndefined();
    expect(view.players[0].distanceVars?.attackMod).toBe(0);
  });
});
