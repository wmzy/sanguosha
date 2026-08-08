// tests/engine/skill-view-meta.test.ts
// 验证马匹 atom 解耦:通用 atom(添加技能/移除技能)不再 import skills/,
// 改经 skill-view-meta 注册表查询马匹 distanceVars。
//
// 关键时序:马匹技能的 distanceVars 在 onInit(after-hook)设置,但 atom 的
// toViewEvents 早于 after-hook 执行——故 createMountSkill 工厂在模块加载时
// 预注册静态增量,由 skills/index eager-import 保证注册表在 atom 使用前已填充。
import { describe, it, expect } from 'vitest';
// 导入引擎核心:atoms 注册所有 atom 定义;skills/index eager-load 马匹技能模块
// (触发 registerSkillViewDelta),还原真实运行时的模块加载顺序。
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { getAtomDef } from '../../src/engine/core/atom';
import { getSkillViewDelta } from '../../src/engine/core/skill-view-meta';
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

describe('skill-view-meta 注册表(马匹 atom 解耦)', () => {
  it('马匹技能在模块加载时已注册视图增量(eager-load 生效)', () => {
    // 进攻马 → attackMod
    expect(getSkillViewDelta('赤兔')).toEqual({ mountDistanceVars: { attackMod: 1 } });
    expect(getSkillViewDelta('紫骍')).toEqual({ mountDistanceVars: { attackMod: 1 } });
    expect(getSkillViewDelta('大宛')).toEqual({ mountDistanceVars: { attackMod: 1 } });
    // 防御马 → defenseMod
    expect(getSkillViewDelta('的卢')).toEqual({ mountDistanceVars: { defenseMod: 1 } });
    expect(getSkillViewDelta('绝影')).toEqual({ mountDistanceVars: { defenseMod: 1 } });
    expect(getSkillViewDelta('爪黄飞电')).toEqual({ mountDistanceVars: { defenseMod: 1 } });
    expect(getSkillViewDelta('骅骝')).toEqual({ mountDistanceVars: { defenseMod: 1 } });
  });

  it('非马匹技能无视图增量', () => {
    expect(getSkillViewDelta('马术')).toBeUndefined();
    expect(getSkillViewDelta('仁德')).toBeUndefined();
    expect(getSkillViewDelta('不存在')).toBeUndefined();
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
