// tests/skill-tests/贯石斧.test.ts
// 贯石斧(武器,攻击范围 3):
//   目标角色使用【闪】后,你可以弃置 2 张牌(手牌或装备区),令此【杀】依然造成伤害。
//
// 完整链路:P1 出杀 → P2 出闪 → 贯石斧 after hook:
//   1. confirm 询问"是否弃 2 张牌强命"
//   2. 玩家选发动 → select prompt 选 2 张牌弃置
//   3. 弃牌 + 移走闪 → 杀.execute 检测无闪 → 造成伤害
//
// 验证:
//   1. 正面:P2 出闪,P1 confirm+select 弃 2 手牌 → 强命,P2 扣血
//   2. 正面:选发动但弃牌不足 → 不强命
//   3. 不发动:confirm=false → 正常被闪,不扣血
//   4. 装备区弃牌:从装备区弃 2 张牌强命
//   5. 手牌不足 2 张 → 跳过(无法强命)
//   6. respond 校验:select 阶段必须选 2 张牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['杀', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

const GUANSHI = makeCard('gs', '贯石斧', '♠', '5', '装备牌');

describe('贯石斧', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:杀 → 出闪 → confirm+select → 强命 ─────────────

  it('用例1:P2 出闪,P1 confirm+select 弃 2 手牌 → 强命,P2 扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♦', '2');
    const discard1 = makeCard('x1', '桃', '♥', '3');
    const discard2 = makeCard('x2', '桃', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'x1', 'x2'], skills: ['杀', '贯石斧'], equipment: { 武器: 'gs' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { gs: GUANSHI, k1: kill, d1: dodge, x1: discard1, x2: discard2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀指定 P2
    await P1.useCardAndTarget('杀', 'k1', [1]);

    // P2 出闪
    await P2.respond('闪', { cardId: 'd1' });

    // 贯石斧 after hook 触发:confirm 询问 P1 是否强命
    expect(harness.state.pendingSlots.get(0)).toBeDefined();
    await P1.respond('贯石斧', { choice: true });

    // 接着 select prompt 让 P1 选 2 张牌
    await P1.respond('贯石斧', { cardIds: ['x1', 'x2'] });

    // 强命:P2 扣血
    expect(harness.state.players[1].health).toBe(3);
    // x1/x2 进弃牌堆
    expect(harness.state.zones.discardPile).toContain('x1');
    expect(harness.state.zones.discardPile).toContain('x2');
    expect(harness.state.zones.discardPile).toContain('d1'); // 闪也移走
    // P1 手牌只剩 k1 已出,空了
    expect(harness.state.players[0].hand).toHaveLength(0);
    // view 级断言
    P2.processEvents();
    P2.expectView(v => {
      expect(v.players[1].health).toBe(3);
      expect(v.pending).toBeNull();
    });
  });

  // ─── 不发动 ─────────────────────────────

  it('用例2:confirm=false → 正常被闪,不扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♦', '2');
    const extra = makeCard('x1', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'x1'], skills: ['杀', '贯石斧'], equipment: { 武器: 'gs' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { gs: GUANSHI, k1: kill, d1: dodge, x1: extra },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });

    // 贯石斧 confirm 询问 → P1 不发动
    await P1.respond('贯石斧', { choice: false });

    // 正常被闪:B2 不扣血
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].hand).toContain('x1'); // P1 未弃牌
  });

  // ─── 装备区弃牌:从装备区弃 2 张牌强命 ─────────────────

  it('用例3:从装备区弃 2 张牌也能强命', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♦', '2');
    const horse1 = makeCard('h1', '赤兔', '♥', '5', '装备牌');
    const horse2 = makeCard('h2', '的卢', '♣', '5', '装备牌');
    const state: GameState = createGameState({
      players: [
        // P1 只剩 k1 手牌 + 2 匹马装备(共 2 张可弃)
        makePlayer({
          index: 0, name: 'P1', hand: ['k1'],
          skills: ['杀', '贯石斧'],
          equipment: { 武器: 'gs', 进攻马: 'h1', 防御马: 'h2' },
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { gs: GUANSHI, k1: kill, d1: dodge, h1: horse1, h2: horse2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });

    await P1.respond('贯石斧', { choice: true });
    // 从装备区弃 2 张马
    await P1.respond('贯石斧', { cardIds: ['h1', 'h2'] });

    // 强命:B2 扣血
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('h1');
    expect(harness.state.zones.discardPile).toContain('h2');
  });

  // ─── 手牌不足 2 张(无装备)→ 跳过强命 ─────────────────

  it('用例4:可弃牌不足 2 张 → 不触发 confirm(直接被闪)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        // P1 只有 k1(出杀后 0 张手牌)+ 装备贯石斧(1 张,不足 2)
        makePlayer({
          index: 0, name: 'P1', hand: ['k1'],
          skills: ['杀', '贯石斧'],
          equipment: { 武器: 'gs' }, // 只有 1 张装备
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { gs: GUANSHI, k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });

    // 出杀后 P1 手牌 0 + 装备 1 = 1 张可弃 < 2 → 跳过 confirm
    // 杀正常被闪:B2 不扣血,无 pending
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── respond 校验:select 阶段必须选 2 张牌 ─────────────

  it('用例5:select 阶段只选 1 张牌 → 拒绝', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♦', '2');
    const x1 = makeCard('x1', '桃', '♥', '3');
    const x2 = makeCard('x2', '桃', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'x1', 'x2'], skills: ['杀', '贯石斧'], equipment: { 武器: 'gs' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { gs: GUANSHI, k1: kill, d1: dodge, x1, x2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });
    await P1.respond('贯石斧', { choice: true });

    // select 阶段只给 1 张牌 → 拒绝
    await P1.expectRejected({
      skillId: '贯石斧', actionType: 'respond', params: { cardIds: ['x1'] },
    });

    // 补正常提交 2 张
    await P1.respond('贯石斧', { cardIds: ['x1', 'x2'] });
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── respond 校验:select 阶段选同一张牌 → 拒绝 ─────────

  it('用例6:select 阶段选同一张牌 → 拒绝', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♦', '2');
    const x1 = makeCard('x1', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'x1'], skills: ['杀', '贯石斧'], equipment: { 武器: 'gs' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { gs: GUANSHI, k1: kill, d1: dodge, x1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });
    await P1.respond('贯石斧', { choice: true });

    // 选同一张牌 → 拒绝
    await P1.expectRejected({
      skillId: '贯石斧', actionType: 'respond', params: { cardIds: ['x1', 'x1'] },
    });
  });
});
