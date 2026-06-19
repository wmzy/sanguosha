// tests/skill-tests/诸葛连弩.test.ts
// 诸葛连弩(武器)技能测试:
//   onInit:出牌阶段开始前 hook 若 owner 装备了诸葛连弩 → 设 turn.vars['杀/quota'] = Infinity
//         装备 atom after hook 也补设 quota(中途装备生效)
//
// 验证:
//   1. 正面:装诸葛连弩 → equipment.武器 = id,玩家 skills 含 '诸葛连弩'
//   2. 正面:诸葛连弩已在 skills 时装备,quota 立即 = Infinity(after hook 触发)
//   3. 正面:quota = Infinity 时可连续出多张杀
//   4. 正面:换装后 quota 恢复(默认 1),诸葛连弩 skill 卸载
//   5. 负面:无诸葛连弩时 quota 默认 1,第二张杀被拒
//   6. 负面:装备不存在的牌 → 拒绝
//   7. 负面:非装备牌(基本牌当武器装)→ 拒绝
//   8. 负面:非自己回合 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeEquip(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物', rank = 'A', range?: number): Card {
  return { id, name, suit, rank, type: '装备牌', subtype, range };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
  return { id, name, suit, rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['装备通用', '杀'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  };
}

describe('诸葛连弩', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:装备诸葛连弩 ─────────────────────────

  it('use:装诸葛连弩 → equipment.武器 = id,玩家 skills 增加诸葛连弩', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'c1');

    expect(harness.state.players[0].equipment['武器']).toBe('c1');
    expect(harness.state.players[0].skills).toContain('诸葛连弩');
    expect(harness.state.players[0].hand).not.toContain('c1');
  });

  // ─── 正面:装后杀 quota = Infinity(可连续出多张) ────────────

  it('正面:诸葛连弩 skill 已加载 → 装备后 quota 立即 = Infinity', async () => {
    // 玩家初始 skills 已含 诸葛连弩(模拟装备技能预先挂载的场景)
    // 此时诸葛连弩 hook 已注册,装备 atom 后 quota 被 after hook 刷新
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const slash1 = makeCard('s1', '杀', '♠', 'A');
    const slash2 = makeCard('s2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 's1', 's2'], skills: ['装备通用', '杀', '诸葛连弩'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow, s1: slash1, s2: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 诸葛连弩 skill 已在 P1.skills,setup() 时 instantiateSkill 注册了 hooks
    expect(harness.state.players[0].skills).toContain('诸葛连弩');

    // 装诸葛连弩 → after hook(装备) 设置 quota = Infinity
    await P1.useCard('装备通用', 'c1');
    expect(harness.state.turn.vars['杀/quota']).toBe(Infinity);

    // 第一张杀:P2 4/4 → 3/4
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);

    // 第二张杀:有 Infinity quota → 仍可出,P2 3/4 → 2/4
    await P1.useCardAndTarget('杀', 's2', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
  });

  it('正面:quota = Infinity 时连续出 3 张杀均成功', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const slash1 = makeCard('s1', '杀', '♠', 'A');
    const slash2 = makeCard('s2', '杀', '♠', '2');
    const slash3 = makeCard('s3', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 's1', 's2', 's3'], skills: ['装备通用', '杀', '诸葛连弩'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow, s1: slash1, s2: slash2, s3: slash3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCard('装备通用', 'c1');
    expect(harness.state.turn.vars['杀/quota']).toBe(Infinity);

    // 3 张杀全部命中(P2 4 → 3 → 2 → 1)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    await P1.useCardAndTarget('杀', 's2', [1]);
    await P2.pass();
    await P1.useCardAndTarget('杀', 's3', [1]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(1);
  });

  // ─── 正面:换装后 quota 恢复 1(默认) ────────────

  it('换装:诸葛连弩 → 青釭剑 → quota 恢复 1,第二张杀被拒', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const sword = makeEquip('w1', '青釭剑', '♠', '武器', 'A', 2);
    const slash1 = makeCard('s1', '杀', '♠', 'A');
    const slash2 = makeCard('s2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'w1', 's1', 's2'], skills: ['装备通用', '杀', '诸葛连弩', '青釭剑'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow, w1: sword, s1: slash1, s2: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 装诸葛连弩 → quota = Infinity
    await P1.useCard('装备通用', 'c1');
    expect(harness.state.turn.vars['杀/quota']).toBe(Infinity);
    expect(harness.state.players[0].skills).toContain('诸葛连弩');

    // 换装成青釭剑 → 诸葛连弩 skill 卸载,旧装备进弃牌堆
    await P1.useCard('装备通用', 'w1');
    expect(harness.state.players[0].equipment['武器']).toBe('w1');
    expect(harness.state.players[0].skills).not.toContain('诸葛连弩');
    expect(harness.state.players[0].skills).toContain('青釭剑');
    // 旧诸葛连弩进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');

    // BUG 修复后:卸载时诸葛连弩的 after 移除技能 hook 清 quota → quota 恢复 1
    expect(harness.state.turn.vars['杀/quota']).toBe(1);

    // 第一张杀:成功(quota 1)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
    // quota 扣减后为 0
    expect(harness.state.turn.vars['杀/quota']).toBe(0);

    // 第二张杀:quota=0 → 被拒
    await P1.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: 's2', targets: [1] } });
  });

  // ─── 负面:无诸葛连弩时 quota = 1(默认) ────────────

  it('负面:无诸葛连弩,quota 默认 1,第二张杀被拒', async () => {
    const slash1 = makeCard('s1', '杀', '♠', 'A');
    const slash2 = makeCard('s2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1', 's2'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { s1: slash1, s2: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // quota 默认 undefined → 视为 1
    expect(harness.state.turn.vars['杀/quota']).toBeUndefined();

    // 第一张杀成功
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);

    // 第二张杀:quota 已用尽 → 拒绝
    await P1.expectRejected({
      skillId: '杀', actionType: 'use', params: { cardId: 's2', targets: [1] },
    });
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 负面:装备不存在的牌 → 拒绝 ────────────

  it('负面:装备不存在的牌 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '装备通用', actionType: 'use', params: { cardId: 'nonexistent' },
    });
  });

  // ─── 负面:非装备牌(基本牌当武器)→ 拒绝 ────────────

  it('负面:装备基本牌(无 subtype)→ 拒绝', async () => {
    const slash = makeCard('s1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '装备通用', actionType: 'use', params: { cardId: 's1' },
    });
  });

  // ─── 负面:非自己回合装备 → 拒绝 ────────────

  it('负面:非自己回合装诸葛连弩 → 拒绝', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '装备通用', actionType: 'use', params: { cardId: 'c1' },
    });
  });
});