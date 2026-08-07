// tests/skill-tests/仁王盾.test.ts
// 仁王盾(防具):锁定技,黑色【杀】对你无效。
//   时机:使用结算开始时(检测有效性 before-hook)。
//   黑色杀(含黑色雷杀)→ cancel,杀.execute 据 false 跳过该目标
//   (不询问闪、不造成伤害、不触发"被抵消")。红色杀(含红色火杀)正常结算。
//
// 与藤甲的关键区别:仁王盾按颜色(黑杀无效);藤甲按属性(普通杀/AOE 无效)。
//   - 黑色雷杀(♠/♣):仁王盾无效(颜色黑);藤甲有效(属性杀穿透)。
//   - 红色火杀(♥/♦):仁王盾有效(颜色红);藤甲有效且伤害+1。
//
// 牌堆事实(src/engine/deck.ts):火杀/雷杀底层 name 均为 '杀',仅 damageType 不同;
//   火杀=♥/♦(红),雷杀=♣/♠(黑)。故仁王盾 name==='杀' && color==='黑' 覆盖全部杀。
//
// 验证(参考 tests/skill-tests/贯石斧.test.ts 写法):
//   1. 黑色普通杀(♣) → 仁王盾无效,不扣血,无询问闪,杀进弃牌堆
//   2. 黑色雷杀(♠雷电) → 仁王盾无效(与藤甲区别点),不扣血,无询问闪
//   3. 红色火杀(♥火焰) → 仁王盾不生效,询问闪,P2 出闪 → 被抵消不扣血
//   4. 红色火杀(♥火焰) → P2 无闪 → 受1点伤害
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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

const RENWANG = makeCard('rw', '仁王盾', '♣', '2', '装备牌');

describe('仁王盾', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 黑色普通杀 → 仁王盾无效 ─────────────────────────────

  it('用例1:黑色普通杀(♣) → 仁王盾无效,P2 不扣血、不询问闪、杀进弃牌堆', async () => {
    const kill = makeCard('k1', '杀', '♣', '10'); // 黑色普通杀
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: ['闪', '仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { rw: RENWANG, k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出黑色普通杀指定 P2
    await P1.useCardAndTarget('杀', 'k1', [1]);

    // 仁王盾 cancel 检测有效性:P2 不扣血
    expect(harness.state.players[1].health).toBe(4);
    // 无询问闪 pending(杀未进入询问闪阶段)
    expect(harness.state.pendingSlots.size).toBe(0);
    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    // view 级断言
    P2.processEvents();
    P2.expectView((v) => {
      expect(v.players[1].health).toBe(4);
      expect(v.pending).toBeNull();
    });
  });

  // ─── 黑色雷杀 → 仁王盾无效(与藤甲的关键区别点) ────────────

  it('用例2:黑色雷杀(♠雷电) → 仁王盾无效(颜色黑),P2 不扣血、不询问闪', async () => {
    const thunderKill: Card = {
      id: 'k2',
      name: '杀',
      suit: '♠',
      color: '黑',
      rank: '4',
      type: '基本牌',
      damageType: '雷电',
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k2'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: ['闪', '仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { rw: RENWANG, k2: thunderKill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const _P2 = harness.player('P2');

    // P1 出黑色雷杀指定 P2
    await P1.useCardAndTarget('杀', 'k2', [1]);

    // 仁王盾按颜色判定:黑色雷杀无效(与藤甲"属性杀穿透"不同)
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.zones.discardPile).toContain('k2');
  });

  // ─── 红色火杀 → 仁王盾不生效,正常询问闪 ──────────────────

  it('用例3:红色火杀(♥火焰) → 仁王盾不生效,询问闪,P2 出闪 → 被抵消不扣血', async () => {
    const fireKill: Card = {
      id: 'k3',
      name: '杀',
      suit: '♥',
      color: '红',
      rank: '4',
      type: '基本牌',
      damageType: '火焰',
    };
    const dodge = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k3'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪', '仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { rw: RENWANG, k3: fireKill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出红色火杀指定 P2
    await P1.useCardAndTarget('杀', 'k3', [1]);

    // 仁王盾不生效(颜色红)→ 进入询问闪:P2 有 pending
    expect(harness.state.pendingSlots.get(1)).toBeDefined();

    // P2 出闪 → 杀被抵消
    await P2.respond('闪', { cardId: 'd1' });

    // P2 不扣血
    expect(harness.state.players[1].health).toBe(4);
    // 闪 + 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('d1');
    expect(harness.state.zones.discardPile).toContain('k3');
  });

  // ─── 红色火杀,P2 无闪 → 受1点伤害 ─────────────────────────

  it('用例4:红色火杀(♥火焰) → P2 无闪 → 受1点伤害', async () => {
    const fireKill: Card = {
      id: 'k4',
      name: '杀',
      suit: '♥',
      color: '红',
      rank: '7',
      type: '基本牌',
      damageType: '火焰',
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k4'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: ['闪', '仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { rw: RENWANG, k4: fireKill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出红色火杀指定 P2
    await P1.useCardAndTarget('杀', 'k4', [1]);

    // 仁王盾不生效(颜色红)→ 杀进入正常结算。P2 无闪,若仍有询问闪 pending 则放弃。
    if (harness.state.pendingSlots.get(1)) {
      await P2.pass();
    }

    // P2 受1点伤害(证明红色火杀未被仁王盾无效化)
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('k4');
  });
});
