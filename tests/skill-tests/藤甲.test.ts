// 藤甲(防具):普通杀/非属性锦囊伤害 -1,火焰伤害 +1。
//
// 实现(藤甲.ts):before hook 挂「造成伤害」——target=自己时:
//   - damageType === '火焰' → amount + 1
//   - 否则 → amount - 1(下限 0)
//
// 验证:
//   1. 正面:普通杀(1 点)→ 减为 0(不受伤害)
//   2. 正面:真实火杀('火焰')→ +1(2 点伤害)
//   3. 分支:直接造成火焰伤害 → +1(独立验证 hook)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  damageType?: Card['damageType'],
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌', damageType };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  equipment?: Record<string, string>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: 4,
    maxHealth: 4,
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

const TENGJIA: Card = {
  id: 'tj',
  name: '藤甲',
  suit: '♠',
  color: suitColor('♠'),
  rank: '2',
  type: '装备牌',
  subtype: '防具',
};

describe('藤甲', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:普通杀减为 0 ───────────────────────────────────

  it('正面:普通杀(1 点)→ 减为 0,不受伤害', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('杀', 'k1', [1]);
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪 → 造成 1 点伤害,藤甲减为 0

    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 正面:真实火杀('火焰')→ 火焰伤害 +1 ──────────────────

  it('正面:真实火杀(damageType=火焰)→ 藤甲火焰 +1,1 点变 2 点', async () => {
    const fireKill = makeCard('fk1', '杀', '♥', '7', '火焰');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['fk1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, fk1: fireKill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('杀', 'fk1', [1]);
    await P2.pass();

    // 火焰伤害 +1:1 点变 2 点,扣 2 血
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 分支:直接造成火焰伤害 → +1(独立验证 hook)──────────────

  it('分支:直接造成 1 点火焰伤害 → +1 为 2 点', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接造成 1 点火焰伤害 → 藤甲 +1 → 2 点
    await applyAtom(harness.state, {
      type: '造成伤害',
      target: 1,
      amount: 1,
      source: 0,
      damageType: '火焰',
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(2);
  });
});
