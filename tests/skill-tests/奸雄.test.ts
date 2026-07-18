// 奸雄(曹操·被动技)测试
//   官方效果:当你受到伤害后,你可以获得造成此伤害的牌。
//   无来源伤害(闪电等)无牌可获得,技能不发动。
//   获得伤害牌采用延迟拿取,避免父结算重复入弃牌堆。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { TARGET_SYSTEM } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
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
    faction: '魏',
    identity: '主公',
  };
}

describe('奸雄', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 获得伤害牌(杀) ─────────────────────────────
  it('P0 杀 P1(曹操) → P1 不闪 → 奸雄选获得 → 杀牌进 P1 手牌(弃牌堆不重复)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['奸雄', '闪'], health: 4 }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪 → 扣血 → 奸雄询问
    P1.expectPending('请求回应');
    // 选获得伤害牌(choice=true)
    await P1.respond('奸雄', { choice: true });
    await harness.waitForStable();

    // 杀牌进入 P1 手牌
    expect(harness.state.players[1].hand).toContain('k1');
    // 弃牌堆不含杀牌(被奸雄拿走,不重复)
    expect(harness.state.zones.discardPile).not.toContain('k1');
    // P1 受了 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 不发动:choice=false → 杀牌正常入弃牌堆,P1 不获得 ─────
  it('P0 杀 P1(曹操) → P1 不闪 → 奸雄选不发动 → 杀牌正常入弃牌堆,P1 不获得', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['奸雄', '闪'], health: 4 }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    P1.expectPending('请求回应');
    // 选不发动(choice=false)
    await P1.respond('奸雄', { choice: false });
    await harness.waitForStable();

    // P1 未获得杀牌
    expect(harness.state.players[1].hand).not.toContain('k1');
    // 杀牌正常入弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    // P1 受了 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 无来源伤害:技能不发动(无可获得之物) ─────────────────────
  it('无来源伤害(无 cardId)→ 奸雄不发动 → 无询问、无额外效果', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['奸雄'], health: 4 }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 无来源、无 cardId 的伤害(如闪电)
    void applyAtom(harness.state, {
      type: '造成伤害',
      target: 0,
      amount: 1,
      source: TARGET_SYSTEM,
    });
    await waitForStable(harness.state);
    // 无伤害牌 → 技能不发动,无询问 pending
    P0.expectNoPending();

    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand).toHaveLength(0);
  });

  // ─── respond validate:无 pending 拒绝 ─────────────────────────────
  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['奸雄'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    await P0.expectRejected({ skillId: '奸雄', actionType: 'respond', params: { choice: true } });
  });
});
