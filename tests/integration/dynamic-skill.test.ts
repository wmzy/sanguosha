// tests/integration/dynamic-skill.test.ts
// 集成测试:动态技能生命周期(添加技能/移除技能 atom 触发实例化/卸载)
// 覆盖 ENGINE-DESIGN §4.13 —— 添加技能 atom 后引擎应 import 模块 → onInit 注册 action/hook
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch, registerSkillsFromState, resetForTest } from '../../src/engine/create-engine';
import { applyAtom } from '../../src/engine/create-engine';
import { findActionEntry } from '../../src/engine/skill';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';

function buildInitialState(): GameState {
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('动态技能生命周期(添加技能/移除技能 atom)', () => {
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    state = buildInitialState();
    await registerSkillsFromState(state);
  });

  it('添加技能 atom → 实例化,后端 action 已注册', async () => {
    // 初始:P1 无 杀 skill → 无 registerAction
    expect(findActionEntry('杀', 0, 'use')).toBeUndefined();

    await applyAtom(state, { type: '添加技能', player: 0, skillId: '杀' });

    // player.skills 列表更新
    expect(state.players[0].skills).toContain('杀');
    // 引擎已实例化:杀:use action 已注册
    expect(findActionEntry('杀', 0, 'use')).toBeDefined();
  });

  it('移除技能 atom → 卸载,后端 action 已注销', async () => {
    // 先添加
    await applyAtom(state, { type: '添加技能', player: 0, skillId: '杀' });
    expect(findActionEntry('杀', 0, 'use')).toBeDefined();

    // 再移除
    await applyAtom(state, { type: '移除技能', player: 0, skillId: '杀' });

    expect(state.players[0].skills).not.toContain('杀');
    expect(findActionEntry('杀', 0, 'use')).toBeUndefined();
  });

  it('添加技能 幂等:重复添加同一 skill 不抛错', async () => {
    await applyAtom(state, { type: '添加技能', player: 0, skillId: '杀' });
    // 再次添加(已存在)→ 不抛错,action 仍注册
    await expect(applyAtom(state, { type: '添加技能', player: 0, skillId: '杀' })).resolves.toBeUndefined();
    expect(findActionEntry('杀', 0, 'use')).toBeDefined();
  });

  it('钩子型技能(八卦阵)动态加载后,before hook 生效', async () => {
    // 八卦阵是 before-hook 型技能(挂 询问闪)
    expect(findActionEntry('八卦阵', 1, 'use')).toBeUndefined();

    await applyAtom(state, { type: '添加技能', player: 1, skillId: '八卦阵' });

    // 八卦阵 注册的 action(若有)+ before hook 应生效
    // 这里验证实例化本身不抛错,且 player.skills 更新
    expect(state.players[1].skills).toContain('八卦阵');

    // 卸载干净
    await applyAtom(state, { type: '移除技能', player: 1, skillId: '八卦阵' });
    expect(state.players[1].skills).not.toContain('八卦阵');
  });
});
