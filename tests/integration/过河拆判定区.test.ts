// tests/integration/过河拆判定区.test.ts
// 集成测试:过河拆桥拆判定区(延时锦囊)
//
// 覆盖:
//   1. 端到端:P0 对 P1(判定区有乐不思蜀)出 过河拆桥 → 判定区被清空
//   2. 判定区优先于手牌/装备:目标判定区有 乐不思蜀 且手牌有 杀 → 拆判定区
//   3. 目标无判定区无手牌,但有装备:validate 接受(因为判定区也可能后续填)
//      (实际:过河拆桥 validate 检查三区任一非空,本用例只验有装备的目标)
//   4. validate 接受:目标只有判定区(无手牌无装备)→ Bug2 修复后 validate 放行
//
// 关键机制(过河拆桥.ts):
//   validate 检查三区任一非空:hand / equipment / pendingTricks
//   execute 优先级:pendingTricks > hand > equipment → 移除延时锦囊 / 弃手牌 / 弃装备
//
// 模式:SkillTestHarness(因为该测试多客户端视角);触发 无懈可击 窗口
//   用 P1.pass() 跳过,直接进入拆判定区
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, PendingTrick } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
  pendingTricks?: PendingTrick[];
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
    pendingTricks: opts.pendingTricks ?? [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = '7',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

describe('过河拆桥:拆判定区(延时锦囊)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:端到端——P0 对 P1(判定区有乐不思蜀)出 过河拆桥 → 判定区清空
  // ─────────────────────────────────────────────────────────────
  it('用例1:P1 判定区有乐不思蜀 → P0 出过河拆桥 → pendingTricks 清空', async () => {
    const gq: Card = makeCard('gq1', '过河拆桥', '♠', '3');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '7');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [gq.id], skills: ['过河拆桥', '杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: {},
          skills: ['杀'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card: lb }],
        }),
      ],
      cardMap: { [gq.id]: gq, [lb.id]: lb },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');

    // 验证初始:判定区有乐不思蜀
    expect(harness.state.players[1].pendingTricks).toHaveLength(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');

    // P0 对 P1 出 过河拆桥
    await P0.useCardAndTarget('过河拆桥', gq.id, [1]);
    // 跳过 无懈可击 窗口
    await P0.pass();
    // 选牌面板选判定区
    await P0.respond('过河拆桥', { zone: 'judge', cardId: lb.id });

    // 判定区被清空
    expect(harness.state.players[1].pendingTricks).toHaveLength(0);
    // 过河拆桥进弃牌堆
    expect(harness.state.zones.discardPile).toContain(gq.id);
    // 处理区已清
    expect(harness.state.zones.processing).not.toContain(gq.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:判定区优先于手牌/装备:目标有乐不思蜀 + 手牌 + 装备 → 拆判定区
  // ─────────────────────────────────────────────────────────────
  it('用例2:目标判定区 + 手牌 + 装备都有 → 过河拆桥 优先拆判定区', async () => {
    const gq: Card = makeCard('gq1', '过河拆桥', '♠', '3');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '7');
    const victimHand: Card = makeCard('v1', '杀', '♥', '5', '基本牌');
    const victimWeapon: Card = makeCard('wp1', '诸葛连弩', '♣', 'A', '装备牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [gq.id], skills: ['过河拆桥', '杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [victimHand.id],
          equipment: { 武器: victimWeapon.id },
          skills: ['杀'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card: lb }],
        }),
      ],
      cardMap: {
        [gq.id]: gq,
        [lb.id]: lb,
        [victimHand.id]: victimHand,
        [victimWeapon.id]: victimWeapon,
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');

    await P0.useCardAndTarget('过河拆桥', gq.id, [1]);
    await P0.pass();
    // 选牌面板:P0 选判定区(zone=judge)
    await P0.respond('过河拆桥', { zone: 'judge', cardId: lb.id });

    // 判定区被清空
    expect(harness.state.players[1].pendingTricks).toHaveLength(0);
    // 手牌保留(没拆到)
    expect(harness.state.players[1].hand).toContain(victimHand.id);
    // 武器保留(没拆到)
    expect(harness.state.players[1].equipment['武器']).toBe(victimWeapon.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:目标判定区被拆空后,过河拆桥 可再被用来拆手牌(同一目标,可重拆)
  // ─────────────────────────────────────────────────────────────
  it('用例3:同一目标判定区 + 手牌分两次拆(第二张拆手牌)', async () => {
    const gq1: Card = makeCard('gq1', '过河拆桥', '♠', '3');
    const gq2: Card = makeCard('gq2', '过河拆桥', '♠', '4');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '7');
    const victimHand: Card = makeCard('v1', '杀', '♥', '5', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [gq1.id, gq2.id], skills: ['过河拆桥', '杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [victimHand.id],
          equipment: {},
          skills: ['杀'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card: lb }],
        }),
      ],
      cardMap: { [gq1.id]: gq1, [gq2.id]: gq2, [lb.id]: lb, [victimHand.id]: victimHand },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');

    // 第一次拆判定区(选牌面板选 judge)
    await P0.useCardAndTarget('过河拆桥', gq1.id, [1]);
    await P0.pass();
    await P0.respond('过河拆桥', { zone: 'judge', cardId: lb.id });
    expect(harness.state.players[1].pendingTricks).toHaveLength(0);
    expect(harness.state.players[1].hand).toContain(victimHand.id);

    // 第二次拆手牌(盲选)
    await P0.useCardAndTarget('过河拆桥', gq2.id, [1]);
    await P0.pass();
    await P0.respond('过河拆桥', { zone: 'hand', handIndex: 0 });
    expect(harness.state.players[1].hand).not.toContain(victimHand.id);
    expect(harness.state.zones.discardPile).toContain(victimHand.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:validate 接受纯判定区目标(无手牌无装备)— Bug2 修复后放行
  // ─────────────────────────────────────────────────────────────
  it('用例4:目标只有判定区 → validate 接受(过河拆桥可拆判定区)', async () => {
    const gq: Card = makeCard('gq1', '过河拆桥', '♠', '3');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '7');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [gq.id], skills: ['过河拆桥', '杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: {},
          skills: ['杀'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card: lb }],
        }),
      ],
      cardMap: { [gq.id]: gq, [lb.id]: lb },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');

    // 验证 P1 确实三区都空(无手牌无装备)
    expect(harness.state.players[1].hand).toHaveLength(0);
    expect(Object.keys(harness.state.players[1].equipment)).toHaveLength(0);
    // 但判定区有乐不思蜀(过河拆桥的 validate 应接受)
    expect(harness.state.players[1].pendingTricks).toHaveLength(1);

    // 期望:action 被接受(state.seq 增长)
    const seqBefore = harness.state.seq;
    await P0.useCardAndTarget('过河拆桥', gq.id, [1]);
    await P0.pass();
    // 选牌面板选判定区
    await P0.respond('过河拆桥', { zone: 'judge', cardId: lb.id });

    expect(harness.state.seq).toBeGreaterThan(seqBefore);
    // 判定区被清空
    expect(harness.state.players[1].pendingTricks).toHaveLength(0);
    // 过河拆桥进弃牌堆
    expect(harness.state.zones.discardPile).toContain(gq.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5:判定区有多个延时锦囊 → 一次过河拆桥 只拆第一个
  // ─────────────────────────────────────────────────────────────
  it('用例5:判定区有多个延时锦囊 → 一次过河拆桥 只拆一个(按数组顺序)', async () => {
    const gq: Card = makeCard('gq1', '过河拆桥', '♠', '3');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '7');
    const sd: Card = makeCard('sd1', '闪电', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [gq.id], skills: ['过河拆桥', '杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: {},
          skills: ['杀'],
          pendingTricks: [
            { name: '乐不思蜀', source: 0, card: lb },
            { name: '闪电', source: 0, card: sd },
          ],
        }),
      ],
      cardMap: { [gq.id]: gq, [lb.id]: lb, [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');

    // 验证初始:判定区有两个延时锦囊
    expect(harness.state.players[1].pendingTricks).toHaveLength(2);

    await P0.useCardAndTarget('过河拆桥', gq.id, [1]);
    await P0.pass();
    // 选牌面板选第一个判定区(乐不思蜀)
    await P0.respond('过河拆桥', { zone: 'judge', cardId: lb.id });

    // 拆一个(使用者选的乐不思蜀)
    expect(harness.state.players[1].pendingTricks).toHaveLength(1);
    // 留下的应该是第二个(闪电),不是被拆的(乐不思蜀)
    expect(harness.state.players[1].pendingTricks[0].name).toBe('闪电');
  });
});
