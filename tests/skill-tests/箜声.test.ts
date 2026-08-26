// 箜声(周妃·吴·被动技)测试:
//   准备阶段可置任意张手牌于武将牌上;结束阶段获得其中非装备牌并令一名角色使用剩余装备牌。
//
// 本文件来源:2026-08-26「useCard 型 pending 客户端形状错配」修复——SELECT_RT('箜声/select')
// 修复前 validate 只认 params.cardIds 数组并拒绝,而浏览器 AwaitingPrompt 两步式 UI 只发
// respond{cardId}(单数),点「不回应」发 respond{} → 浏览器玩家无法置牌且询问卡到超时。
// 该技能此前无专属测试文件,按测试放置规范新建(归并建议:后续箜声其余用例并入本文件)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import 箜声Mod from '../../src/engine/skills/箜声';
import { createGameState, suitColor } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

setSkillModuleOverride('箜声', async () => 箜声Mod);

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '周妃',
    health: 3,
    maxHealth: 3,
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

/** 读玩家的箜声牌(vars['箜声/牌'],由 移出至暂存区 维护) */
function kongshengCards(state: GameState, player: number): string[] {
  const v = state.players[player]?.vars['箜声/牌'];
  return Array.isArray(v) ? (v as string[]) : [];
}

describe('箜声', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  function setupState() {
    return createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], skills: ['箜声'] }),
        mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {
        c1: mkCard('c1', '杀', '♠', '7'),
        c2: mkCard('c2', '闪', '♣', '4'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
      zones: { deck: [], discardPile: [], processing: [] },
    });
  }

  it('准备阶段:{cardId} 单数形状(浏览器两步式 UI)也能置牌', async () => {
    await harness.setup(setupState());
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', phase: '准备', player: 0 } as unknown as Parameters<typeof applyAtom>[1]);
    await harness.waitForStable();

    // confirm → select
    P0.expectPending('请求回应');
    await P0.respond('箜声', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('箜声', { cardId: 'c1' }); // 浏览器真实形状(单数)
    await harness.waitForStable();

    expect(kongshengCards(harness.state, 0)).toEqual(['c1']);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('准备阶段:{}(不回应)视为放弃置牌,不卡询问', async () => {
    await harness.setup(setupState());
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', phase: '准备', player: 0 } as unknown as Parameters<typeof applyAtom>[1]);
    await harness.waitForStable();

    await P0.respond('箜声', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('箜声', {});
    await harness.waitForStable();

    expect(kongshengCards(harness.state, 0)).toEqual([]); // 未置牌
    expect(harness.state.pendingSlots.size).toBe(0); // 询问已结束
  });

  it('准备阶段:仍兼容 {cardIds} 数组形状(AI/headless 路径)', async () => {
    await harness.setup(setupState());
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', phase: '准备', player: 0 } as unknown as Parameters<typeof applyAtom>[1]);
    await harness.waitForStable();

    await P0.respond('箜声', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('箜声', { cardIds: ['c1', 'c2'] });
    await harness.waitForStable();

    expect(kongshengCards(harness.state, 0)).toEqual(['c1', 'c2']);
  });
});
