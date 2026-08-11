// 袁术(群·风林火山 hero/100)技能测试:
//   庸肆(锁定技)— 摸牌阶段多摸X张;弃牌阶段开始时弃置X张(X为全场势力数)
//   伪帝(锁定技)— 视为拥有主公的主公技(复制主公的主公技给袁术)
//
// 验证:
//   庸肆:
//     1. 摸牌阶段多摸 X 张(X=存活玩家势力数)
//     2. X 随势力数变化
//     3. 弃牌阶段开始时弃置 X 张(玩家选择)
//     4. 弃牌数封顶为手牌数(X>手牌时全弃)
//     5. 非摸牌阶段的摸牌(无中生有)不触发庸肆
//   伪帝:
//     6. 场上有主公(曹操):袁术获得主公技护驾
//     7. 场上无主公:袁术不获得任何主公技
//     8. 整局只复制一次(多次回合开始不重复)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { skillLoaders } from '../../src/engine/skills';
import * as 庸肆Module from '../../src/engine/skills/庸肆';
import * as 伪帝Module from '../../src/engine/skills/伪帝';
import { applyAtom } from '../../src/engine/core/apply';
import { createGameState, suitColor } from '../../src/engine/types';
import type { Card, PlayerState } from '../../src/engine/types';

// 本地注册技能模块(主 agent 统一在 skills/index.ts 注册;测试本地兜底)
skillLoaders['庸肆'] = async () => 庸肆Module;
skillLoaders['伪帝'] = async () => 伪帝Module;

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  faction?: PlayerState['faction'];
  identity?: PlayerState['identity'];
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    identity: opts.identity,
    faction: opts.faction,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('庸肆', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 摸牌阶段多摸 X 张 ──────────────────────────────
  it('摸牌阶段多摸 X 张(群+魏+蜀=3 → 摸 2+3=5)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '袁术', faction: '群', hand: [], skills: ['庸肆', '回合管理'] }),
          makePlayer({ index: 1, name: 'P1', faction: '魏', skills: ['回合管理'] }),
          makePlayer({ index: 2, name: 'P2', faction: '蜀', skills: ['回合管理'] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const P0 = harness.player('袁术');

    // 启动回合:准备→判定→摸牌(庸肆 +X)→出牌(窗口暂停)
    await P0.triggerAction('回合管理', 'start');

    // X=3(群/魏/蜀),庸肆多摸 3 → 2+3=5
    expect(harness.state.players[0].hand.length).toBe(5);
  });

  // ─── 2. X 随势力数变化 ──────────────────────────────────
  it('X 随势力数变化(群+魏=2 → 摸 2+2=4)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '袁术', faction: '群', hand: [], skills: ['庸肆', '回合管理'] }),
          makePlayer({ index: 1, name: 'P1', faction: '魏', skills: ['回合管理'] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const P0 = harness.player('袁术');

    await P0.triggerAction('回合管理', 'start');

    // X=2(群/魏),庸肆多摸 2 → 2+2=4
    expect(harness.state.players[0].hand.length).toBe(4);
  });

  // ─── 3. 弃牌阶段开始时弃置 X 张(玩家选择) ────────────────
  it('弃牌阶段开始时弃置 X 张(群+魏=2 → 弃 2,玩家选择)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '袁术',
            faction: '群',
            hand: ['c1', 'c2', 'c3', 'c4'],
            skills: ['庸肆', '回合管理'],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P1', faction: '魏', skills: ['回合管理'] }),
        ],
        cardMap: {
          c1: makeCard('c1', '杀'),
          c2: makeCard('c2', '杀'),
          c3: makeCard('c3', '闪'),
          c4: makeCard('c4', '闪'),
        },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('袁术');

    // 结束出牌阶段 → 进入弃牌阶段 → 庸肆弃牌询问
    await P0.triggerAction('回合管理', 'end');

    // 袁术选择弃 c1、c2
    await P0.respond('庸肆', { cardIds: ['c1', 'c2'] });

    // 庸肆弃了 2 张;余 2 张 ≤ 手牌上限(体力 4)→ 无系统 __弃牌
    expect(harness.state.players[0].hand).toEqual(['c3', 'c4']);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'c2']));
  });

  // ─── 4. 弃牌数封顶为手牌数(X>手牌时全弃) ────────────────
  it('弃牌数封顶为手牌数(手牌 1 < X=2 → 仅弃 1)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '袁术',
            faction: '群',
            hand: ['c1'],
            skills: ['庸肆', '回合管理'],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P1', faction: '魏', skills: ['回合管理'] }),
        ],
        cardMap: { c1: makeCard('c1', '杀') },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('袁术');

    await P0.triggerAction('回合管理', 'end');

    // X=2 但手牌仅 1 → 只弃 1 张
    await P0.respond('庸肆', { cardIds: ['c1'] });

    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  // ─── 5. 非摸牌阶段的摸牌不触发庸肆 ────────────────────────
  it('非摸牌阶段的摸牌不触发庸肆(出牌阶段摸牌不加 X)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '袁术', faction: '群', hand: [], skills: ['庸肆'] }),
          makePlayer({ index: 1, name: 'P1', faction: '魏', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    // 出牌阶段摸 2(模拟无中生有/遗计等非摸牌阶段摸牌):庸肆仅在自己摸牌阶段触发
    void applyAtom(harness.state, { type: '摸牌', player: 0, count: 2 });
    await harness.waitForStable();

    // X 本应为 2(群/魏),但 phase≠摸牌 → 庸肆不加 X,仅摸 2
    expect(harness.state.players[0].hand.length).toBe(2);
  });
});

describe('伪帝', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 6. 场上有主公:袁术获得主公技 ────────────────────────
  it('场上有主公(曹操):袁术获得主公技护驾', async () => {
    await harness.setup(
      createGameState({
        players: [
          // 曹操(主公,魏)拥有护驾
          makePlayer({ index: 0, name: '曹操', faction: '魏', identity: '主公', skills: ['护驾'] }),
          // 袁术(群)拥有伪帝
          makePlayer({ index: 1, name: '袁术', faction: '群', skills: ['庸肆', '伪帝'] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 触发首回合开始(主公回合):伪帝复制主公的主公技
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    // 袁术获得了护驾
    expect(harness.state.players[1].skills).toContain('护驾');
    expect(harness.state.players[1].vars['伪帝/granted']).toBe(true);
  });

  // ─── 7. 场上无主公:袁术不获得任何主公技 ──────────────────
  it('场上无主公:袁术不获得任何主公技', async () => {
    await harness.setup(
      createGameState({
        players: [
          // 无主公身份玩家
          makePlayer({ index: 0, name: 'P0', faction: '魏', skills: [] }),
          makePlayer({ index: 1, name: '袁术', faction: '群', skills: ['庸肆', '伪帝'] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    // 袁术未获得任何主公技,且未标记已复制(后续仍可再检查)
    expect(harness.state.players[1].skills).not.toContain('护驾');
    expect(harness.state.players[1].vars['伪帝/granted']).toBeUndefined();
  });

  // ─── 8. 整局只复制一次 ──────────────────────────────────
  it('整局只复制一次(多次回合开始不重复添加)', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: '曹操', faction: '魏', identity: '主公', skills: ['护驾'] }),
          makePlayer({ index: 1, name: '袁术', faction: '群', skills: ['庸肆', '伪帝'] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 首次回合开始:复制护驾
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(harness.state.players[1].skills.filter((s) => s === '护驾').length).toBe(1);

    // 再次回合开始:不重复添加(skills 中护驾仍只有 1 个)
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(harness.state.players[1].skills.filter((s) => s === '护驾').length).toBe(1);
  });
});
