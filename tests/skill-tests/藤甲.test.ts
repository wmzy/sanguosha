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
import { applyAtom } from '../../src/engine/index';
import { runDamageFlow } from '../../src/engine/damage-flow';
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
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        // P2 带一张闪:询问闪走 normal(P2 选择不出闪),藤甲将普通杀减为 0
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, k1: kill, d1: dodge },
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
    await runDamageFlow(harness.state, 0, 1, 1, undefined, '火焰');
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 边界:藤甲只保护装备者(目标合法性)──────────────────
  //   实现:before hook 内 `if (atom.target !== ownerId) return;` ——
  //   伤害目标非装备者时 hook 直接 pass,不修改 amount。验证藤甲不会越权替他人减伤。

  it('边界:藤甲不保护其他玩家——普通杀 P3,P3 正常扣血、P2 不受影响', async () => {
    const kill = makeCard('k2', '杀', '♠', '7');
    const shan = makeCard('s1', '闪', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k2'], skills: ['杀'] }),
        // P2 持藤甲但不是本杀的目标
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
        makePlayer({ index: 2, name: 'P3', hand: ['s1'], skills: ['闪'] }),
      ],
      cardMap: { tj: TENGJIA, k2: kill, s1: shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P3 = harness.player('P3');

    // P1 普通杀 P3(非藤甲持有者):受到伤害时 hook 因 target≠ownerId 直接 pass
    await harness.player('P1').useCardAndTarget('杀', 'k2', [2]);
    P3.expectPending('询问闪');
    await P3.pass();

    // P3 正常受 1 点伤害;藤甲持有者 P2 完全不受影响
    expect(harness.state.players[2].health).toBe(3);
    expect(harness.state.players[1].health).toBe(4);
  });
});
