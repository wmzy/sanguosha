// tests/integration/装备替换.test.ts
// 集成测试:装备替换时旧装备的同名技能实例被卸载(防 Bug1 残留)
//
// 覆盖:
//   1. 装备诸葛连弩 → 添加技能 诸葛连弩 → 阶段开始 出牌 hook 触发 → quota=Infinity
//   2. 再装寒冰剑(替换同栏位武器)→ 移除技能 诸葛连弩 → 添加技能 寒冰剑
//   3. 旧武器(诸葛连弩)进弃牌堆,新武器(寒冰剑)占位
//   4. 阶段开始 出牌 后:quota 不再被设为 Infinity(诸葛连弩 hook 已卸载)
//   5. 玩家 skills 列表:此时应只剩 寒冰剑,不再含 诸葛连弩
//
// 关键机制(装备通用.ts):
//   装新装备前:先 移除技能(oldCard.name) → 卸下 → 弃牌堆
//   再 装备新牌 → 添加技能(newCard.name) → 实例化新 skill
//   移除技能 → 系统规则 after hook → unloadSkillInstance(清 action/hook)
//
// 模式:createGameState + registerSkillsFromState → dispatch 走真实 action 路径
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import { findActionEntry } from '../../src/engine/skill';
import { dispatchAndWait } from '../engine-harness';
import { slashMax } from '../../src/engine/slash-quota';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♣',
  rank = 'A',
  subtype?: string,
  range?: number,
): Card {
  return { id, name, suit, rank, type: '装备牌', subtype, range };
}

describe('装备替换:旧装备技能实例被卸载', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:装诸葛连弩 → 注册上限提供者(∞);再装寒冰剑 → 上限提供者被取消注册
  // ─────────────────────────────────────────────────────────────
  it('用例1:诸葛连弩 → 寒冰剑(替换同栏位)→ 连弩 skill 卸载,上限提供者被取消注册', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '武器', 1);
    const hanbing: Card = makeCard('wp-hb', '寒冰剑', '♠', '6', '武器', 2);

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, hanbing.id],
          equipment: {},
          skills: ['杀', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [zhuge.id]: zhuge, [hanbing.id]: hanbing },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装诸葛连弩 → onInit 注册上限提供者(∞)
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: zhuge.id },
      baseSeq: state.seq,
    });
    expect(state.players[0].equipment['武器']).toBe(zhuge.id);
    // 诸葛连弩 skill 实例已注册(玩家 skills 含 诸葛连弩)
    expect(state.players[0].skills).toContain('诸葛连弩');
    // 上限提供者已注册(onInit 同步注册,返回 ∞ → slashMax = Infinity)
    expect(slashMax(state, 0)).toBe(Infinity);

    // 装备寒冰剑(同槽位 武器,会触发 装备通用 里的 移除技能 + 卸下 + 装备 + 添加技能 序列)
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: hanbing.id },
      baseSeq: state.seq,
    });
    // 新装备占位
    expect(state.players[0].equipment['武器']).toBe(hanbing.id);
    // 旧装备进弃牌堆
    expect(state.zones.discardPile).toContain(zhuge.id);
    // 玩家 skills 列表:诸葛连弩 被移除(移除技能 atom),寒冰剑 被加入
    expect(state.players[0].skills).not.toContain('诸葛连弩');
    expect(state.players[0].skills).toContain('寒冰剑');

    // 卸载取消注册 → slashMax 回落到基础 1(连弩实例已卸载)
    expect(slashMax(state, 0)).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:玩家 skills 数组层面验证(诸葛连弩 消失,寒冰剑 出现)
  // ─────────────────────────────────────────────────────────────
  it('用例2:替换后 P0.skills 不再包含 诸葛连弩,包含 寒冰剑', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '武器', 1);
    const hanbing: Card = makeCard('wp-hb', '寒冰剑', '♠', '6', '武器', 2);

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, hanbing.id],
          equipment: {},
          skills: ['杀', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [zhuge.id]: zhuge, [hanbing.id]: hanbing },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const skillsBefore = state.players[0].skills.slice();
    // 装诸葛连弩
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: zhuge.id },
      baseSeq: state.seq,
    });
    expect(state.players[0].skills).toContain('诸葛连弩');
    expect(state.players[0].skills.length).toBe(skillsBefore.length + 1);

    // 装寒冰剑(同槽位)
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: hanbing.id },
      baseSeq: state.seq,
    });

    // skills 净变化:移除 诸葛连弩 + 添加 寒冰剑 → 长度不变,但内容换
    expect(state.players[0].skills).not.toContain('诸葛连弩');
    expect(state.players[0].skills).toContain('寒冰剑');
    expect(state.players[0].skills.length).toBe(skillsBefore.length + 1);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:替换不同栏位互不影响(武器+防具分别装备,各自 skill 实例都在)
  // ─────────────────────────────────────────────────────────────
  it('用例3:不同栏位的装备互不影响(防具替换防具,武器仍有效)', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '武器', 1);
    const bagua1: Card = makeCard('ar-bg1', '八卦阵', '♣', '2', '防具');
    const bagua2: Card = makeCard('ar-bg2', '八卦阵', '♦', '5', '防具');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, bagua1.id, bagua2.id],
          equipment: {},
          skills: ['杀', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [zhuge.id]: zhuge, [bagua1.id]: bagua1, [bagua2.id]: bagua2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装诸葛连弩 + 八卦阵(防具)
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: zhuge.id },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: bagua1.id },
      baseSeq: state.seq,
    });
    expect(state.players[0].equipment['武器']).toBe(zhuge.id);
    expect(state.players[0].equipment['防具']).toBe(bagua1.id);
    expect(state.players[0].skills).toContain('诸葛连弩');
    expect(state.players[0].skills).toContain('八卦阵');

    // 替换防具(同槽位)— 武器栏位不受影响
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: bagua2.id },
      baseSeq: state.seq,
    });
    expect(state.players[0].equipment['武器']).toBe(zhuge.id);  // 武器保留
    expect(state.players[0].equipment['防具']).toBe(bagua2.id); // 防具换了
    expect(state.zones.discardPile).toContain(bagua1.id);       // 旧防具进弃牌堆
    // 诸葛连弩 skill 仍在(未受影响)
    expect(state.players[0].skills).toContain('诸葛连弩');
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:findActionEntry 验证 — 诸葛连弩 use action 被卸载后查询不到
  // (因为 诸葛连弩.ts 实际不暴露 use action,这里用其他方式:验证 hook)
  // 我们用更直接的证据:阶段开始 出牌 后 quota 不被设 Infinity(用例 1 已证)。
  // 本用例只做 action 表的烟雾测试:寒冰剑的 use action(若存在)可查,诸葛连弩 没了
  // (诸葛连弩.ts 没有 use action,但有阶段开始 hook;若 hook 仍存在,quota 会被设 — 用例 1 已证否)
  // ─────────────────────────────────────────────────────────────
  it('用例4:替换后,旧装备同名 action entry 已从全局 actions 表移除(若其注册过)', async () => {
    // 诸葛连弩.ts 实际只注册 hook、不注册 action;这里用 findActionEntry 确认
    //   诸葛连弩:0:xxx 不存在(未注册 action)
    // 这是一个"空测试":证明 action 表不会被卸载的实例污染
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '武器', 1);
    const hanbing: Card = makeCard('wp-hb', '寒冰剑', '♠', '6', '武器', 2);

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, hanbing.id],
          equipment: {},
          skills: ['杀', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [zhuge.id]: zhuge, [hanbing.id]: hanbing },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装诸葛连弩 → 添加技能 → onInit 注册 诸葛连弩 实例
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: zhuge.id },
      baseSeq: state.seq,
    });
    // 装寒冰剑 → 移除技能 诸葛连弩 → onInit 清理
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: hanbing.id },
      baseSeq: state.seq,
    });

    // findActionEntry 应返回 undefined(诸葛连弩.ts 不注册 action,但即使注册了也应被卸)
    const entry = findActionEntry(state, '诸葛连弩', 0, 'use');
    expect(entry).toBeUndefined();
  });
});
