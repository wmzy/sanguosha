// tests/skill-tests/判定阶段多延时锦囊.test.ts
// 判定阶段多延时锦囊循环结算（模块 I）：
//   规则（game.md）：判定阶段检测判定区有延时锦囊 → 结算最后置入的 → 重复直到判定区清空。
//   回归 bug：registerDelayedTrickHooks 旧实现只 find 第一个 + 单次 resumeDelayedSettlement，
//   判定区有多个延时锦囊时只结算一个就返回，剩余的永不结算。
//
// 用 order-dependent 判定牌验证「最后置入先结算」：
//   牌堆顶 = deck[0] 最先被 判定 消耗（判定 atom shift 牌堆顶）。
//   把最后置入的延时锦囊（闪电）配上一张会让其「传递/命中」的判定牌，
//   其余延时锦囊配上可区分花色的判定牌 —— 结算顺序错位时观测状态会不同。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, fireTimeoutAndWait, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  pendingTricks?: Array<{ name: string; source: number; card: Card }>;
  tags?: string[];
  health?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    judgeZone: [],
    tags: opts.tags ?? [],
  };
}

/** 逐个消耗判定阶段的无懈窗口，直到无 pending（每个延时锦囊结算时各开一个无懈窗口）。 */
async function drainJudgePendings(state: GameState, max = 8): Promise<void> {
  for (let i = 0; i < max; i++) {
    await waitForStable(state);
    if (state.pendingSlots.size === 0) return; // 全部结算完毕
    await fireTimeoutAndWait(state);
  }
}

describe('判定阶段多延时锦囊循环', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 两个延时锦囊（乐不思蜀 + 闪电）：都被结算，最后置入（闪电）先结算
  //    牌堆顶 j1=♥5 → 闪电判定 ♥（非命中）→ 传递给 P0，P1 不受伤
  //    j2=♠5       → 乐不思蜀判定 ♠（非♥）→ 加跳过出牌标签
  //    若顺序错误（乐不思蜀先），乐不思蜀会吃到 j1=♥5 → ♥ 不加标签，
  //    闪电会吃到 j2=♠5 → 命中 3 点伤害 —— 断言可区分。
  // ─────────────────────────────────────────────────────────────
  it('两个延时锦囊（乐不思蜀+闪电）都被结算，最后置入的闪电先结算', async () => {
    const leCard = makeCard('le1', '乐不思蜀', '♠');
    const sdCard = makeCard('sd1', '闪电', '♠');
    const j1 = makeCard('j1', '判定牌', '♥', '5'); // 闪电（非命中→传递）
    const j2 = makeCard('j2', '判定牌', '♠', '5'); // 乐不思蜀（非♥→跳过出牌）
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['乐不思蜀', '闪电', '回合管理'],
          // pendingTricks 按置入顺序：乐不思蜀先置入，闪电最后置入
          pendingTricks: [
            { name: '乐不思蜀', source: 0, card: leCard },
            { name: '闪电', source: 1, card: sdCard },
          ],
        }),
      ],
      cardMap: { le1: leCard, sd1: sdCard, j1, j2 },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1', 'j2'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await drainJudgePendings(harness.state);

    // 两个延时锦囊都被结算：P2 判定区清空
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    // 闪电（最后置入）先结算，吃到 j1=♥5 → 非命中 → 传递给 P1，P2 不受伤
    expect(harness.state.players[0].pendingTricks.some((t) => t.name === '闪电')).toBe(true);
    expect(harness.state.players[1].health).toBe(4);
    // 乐不思蜀后结算，吃到 j2=♠5 → 非♥ → 加跳过出牌标签
    expect(harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌')).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 三个延时锦囊（乐不思蜀 + 兵粮寸断 + 闪电）：全部结算，顺序正确
  //    置入顺序：乐不思蜀 → 兵粮寸断 → 闪电（最后）
  //    结算顺序（最后置入先）：闪电 → 兵粮寸断 → 乐不思蜀
  //    j1=♥5 → 闪电（非命中→传递给 P0，不受伤）
  //    j2=♠5 → 兵粮寸断（非♣→跳过摸牌）
  //    j3=♠5 → 乐不思蜀（非♥→跳过出牌）
  // ─────────────────────────────────────────────────────────────
  it('三个延时锦囊全部结算且顺序正确（最后置入先结算）', async () => {
    const leCard = makeCard('le1', '乐不思蜀', '♠');
    const blCard = makeCard('bl1', '兵粮寸断', '♣');
    const sdCard = makeCard('sd1', '闪电', '♠');
    const j1 = makeCard('j1', '判定牌', '♥', '5'); // 闪电（非命中→传递）
    const j2 = makeCard('j2', '判定牌', '♠', '5'); // 兵粮寸断（非♣→跳过摸牌）
    const j3 = makeCard('j3', '判定牌', '♠', '5'); // 乐不思蜀（非♥→跳过出牌）
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['乐不思蜀', '兵粮寸断', '闪电', '回合管理'],
          // 置入顺序：乐不思蜀 → 兵粮寸断 → 闪电（最后）
          pendingTricks: [
            { name: '乐不思蜀', source: 0, card: leCard },
            { name: '兵粮寸断', source: 0, card: blCard },
            { name: '闪电', source: 1, card: sdCard },
          ],
        }),
      ],
      cardMap: { le1: leCard, bl1: blCard, sd1: sdCard, j1, j2, j3 },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1', 'j2', 'j3'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await drainJudgePendings(harness.state);

    // 全部结算：P2 判定区清空
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    // 闪电（最后置入）先结算，吃到 j1=♥5 → 非命中 → 传递给 P0，P2 不受伤
    expect(harness.state.players[0].pendingTricks.some((t) => t.name === '闪电')).toBe(true);
    expect(harness.state.players[1].health).toBe(4);
    // 兵粮寸断结算，吃到 j2=♠5 → 非♣ → 跳过摸牌
    expect(harness.state.players[1].tags?.includes('兵粮寸断/跳过摸牌')).toBe(true);
    // 乐不思蜀结算，吃到 j3=♠5 → 非♥ → 跳过出牌
    expect(harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌')).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 牌堆耗尽保护：判定区有延时锦囊但牌堆为空 → 不结算（不死循环、不报错）
  // ─────────────────────────────────────────────────────────────
  it('牌堆为空时判定区有延时锦囊 → 不结算不报错', async () => {
    const leCard = makeCard('le1', '乐不思蜀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['乐不思蜀', '回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card: leCard }],
        }),
      ],
      cardMap: { le1: leCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state);

    // 牌堆空 → 无法判定，延时锦囊保留未结算（未死循环、未报错、未判定）
    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    // 未判定 → 不应加跳过标签
    expect(harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌')).toBe(false);
  });
});
