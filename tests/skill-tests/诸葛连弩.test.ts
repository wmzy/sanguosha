// tests/skill-tests/诸葛连弩.test.ts
// 诸葛连弩(武器)技能测试:
//   onInit:装备时注册上限提供者(() => Infinity)→ slashMax 返回 ∞(中途装备立即生效)
//   卸载技能实例时取消注册提供者 → slashMax 回到 1(usedCount 保留)
//
// 验证:
//   1. 正面:装诸葛连弩 → equipment.武器 = id,玩家 skills 含 '诸葛连弩'
//   2. 正面:诸葛连弩已在 skills 时装备,slashMax 变 ∞
//   3. 正面:slashMax=∞ 时连续出多张杀
//   4. 正面:换装后 slashMax 回 1,诸葛连弩 skill 卸载
//   5. 负面:无诸葛连弩时上限默认 1,第二张杀被拒
//   6. 负面:装备不存在的牌 → 拒绝
//   7. 负面:非装备牌(基本牌当武器装)→ 拒绝
//   8. 负面:非自己回合 → 拒绝
//   9. 回归:装连弩前出过杀,换装后 usedCount 保留 → 不能再用杀
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { slashMax, slashUsed } from '../../src/engine/slash-quota';
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
    tags: [],
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
    // view 级断言
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].equipment['武器']).toBe('c1');
      expect(v.players[0].handCount).toBe(0);
    });
  });

  // ─── 回归:出牌阶段中途装备诸葛连弩 → 本回合立即可连续出杀 ────
  // 机制:onInit 装备时注册上限提供者(() => Infinity)→ slashMax 返回 ∞ → 可连续出杀。

  it('回归:出牌阶段中装备诸葛连弩 → 本回合立即可连续出 2 张杀', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const slash1 = makeCard('s1', '杀', '♠', 'A');
    const slash2 = makeCard('s2', '杀', '♠', '2');
    // 注意:player.skills 默认 ['装备通用', '杀'],不含 '诸葛连弩'——装备流程会触发 添加技能 atom。
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 's1', 's2'] }),
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

    // 装诸葛连弩(出牌阶段中)
    await P1.useCard('装备通用', 'c1');
    expect(harness.state.players[0].equipment['武器']).toBe('c1');
    expect(harness.state.players[0].skills).toContain('诸葛连弩');
    // 关键:装备后立即注册上限提供者 → slashMax 变 ∞
    expect(slashMax(harness.state, 0)).toBe(Infinity);

    // 第一张杀
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);

    // 第二张杀:slashMax=∞ → 仍允许
    await P1.useCardAndTarget('杀', 's2', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
  });

  it('负面:准备阶段装诸葛连弩 → 装备被拒(装备validate要求出牌阶段)', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    // 准备阶段装备被装备通用validate拦截(phase !== '出牌')。
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 装备被拒 → 提供者未注册
    await P1.expectRejected({ skillId: '装备通用', actionType: 'use', params: { cardId: 'c1' } });
    expect(slashMax(harness.state, 0)).toBe(1);
  });

  // ─── 正面:装后杀 quota = Infinity(可连续出多张) ────────────

  it('正面:诸葛连弩 skill 已加载 → 装备后上限变 ∞(可连续出杀)', async () => {
    // 玩家初始 skills 已含 诸葛连弩(模拟装备技能预先挂载的场景)
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

    // 装诸葛连弩 → onInit 注册上限提供者 → slashMax=∞
    await P1.useCard('装备通用', 'c1');
    expect(slashMax(harness.state, 0)).toBe(Infinity);

    // 第一张杀:P2 4/4 → 3/4
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);

    // 第二张杀:slashMax=∞ → 仍可出,P2 3/4 → 2/4
    await P1.useCardAndTarget('杀', 's2', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
  });

  it('正面:slashMax=∞ 连续出 3 张杀均成功', async () => {
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
    expect(slashMax(harness.state, 0)).toBe(Infinity);

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

  it('换装:诸葛连弩 → 青釭剑 → 取消注册提供者,上限回 1,第二张杀被拒', async () => {
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

    // 装诸葛连弩 → 注册上限提供者 → slashMax=∞
    await P1.useCard('装备通用', 'c1');
    expect(slashMax(harness.state, 0)).toBe(Infinity);
    expect(harness.state.players[0].skills).toContain('诸葛连弩');

    // 换装成青釭剑 → 诸葛连弩 skill 卸载,旧装备进弃牌堆
    await P1.useCard('装备通用', 'w1');
    expect(harness.state.players[0].equipment['武器']).toBe('w1');
    expect(harness.state.players[0].skills).not.toContain('诸葛连弩');
    expect(harness.state.players[0].skills).toContain('青釭剑');
    // 旧诸葛连弩进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');

    // 卸载技能实例时取消注册提供者 → slashMax 回到 1(无 maxBonus);usedCount 仍为 0(未出过杀)
    expect(slashMax(harness.state, 0)).toBe(1);

    // 第一张杀:成功(usedCount 0 < 1)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
    // 出杀后 usedCount = 1
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);

    // 第二张杀:usedCount=1 >= 上限 1 → 被拒
    await P1.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: 's2', targets: [1] } });
  });

  // ─── 负面:无诸葛连弩时 quota = 1(默认) ────────────

  it('负面:无诸葛连弩,上限默认 1,第二张杀被拒', async () => {
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

    // 无提供者 → slashMax = 1;usedCount 默认 0
    expect(slashMax(harness.state, 0)).toBe(1);
    expect(slashUsed(harness.state)).toBe(0);

    // 第一张杀成功(usedCount 0 < 1)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);

    // 第二张杀:usedCount=1 >= 上限 1 → 拒绝
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

  // ─── 回归:装连弩前出过杀,换装后 usedCount 保留 → 不能再用杀 ────────────
  // 这是新模型(分离 usedCount 与上限来源)的关键改进:
  //   旧 杀/quota 方案下,换装重置 quota 会丢失"已出过杀"信息;
  //   新方案 usedCount 不受装备增删影响,slashMax 由当前注册的提供者决定 → 正确拒绝。

  it('回归:装连弩前出过 1 张杀 → 换装青釭剑后不能再出杀(usedCount 保留)', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const sword = makeEquip('w1', '青釭剑', '♠', '武器', 'A', 2);
    const slash1 = makeCard('s1', '杀', '♠', 'A');
    const slash2 = makeCard('s2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1', 'c1', 'w1', 's2'], skills: ['装备通用', '杀', '诸葛连弩', '青釭剑'] }),
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

    // 先出一张杀(无连弩,usedCount 0 → 1,上限 1)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);

    // 装诸葛连弩 → 注册上限提供者 → slashMax=∞ → usedCount(1) < ∞ 可继续出
    await P1.useCard('装备通用', 'c1');
    expect(slashMax(harness.state, 0)).toBe(Infinity);

    // 第二张杀:slashMax=∞ → 成功
    await P1.useCardAndTarget('杀', 's2', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(2);

    // 换装青釭剑 → 取消注册诸葛连弩提供者 → slashMax 回到 1;usedCount 仍为 2
    await P1.useCard('装备通用', 'w1');
    expect(slashMax(harness.state, 0)).toBe(1);
    expect(slashUsed(harness.state)).toBe(2);

    // 第三张杀:usedCount(2) >= 上限(1) → 被拒(关键:旧 杀/quota 方案会错误允许)
    // 手牌已无杀,这里用 expectRejected 验证 validate 拒绝
    // 需要一张杀在手:上面 s2 已出,构造第三张
    const slash3 = makeCard('s3', '杀', '♠', '3');
    harness.state.cardMap['s3'] = slash3;
    harness.state.players[0].hand.push('s3');
    await P1.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: 's3', targets: [1] } });
  });
});