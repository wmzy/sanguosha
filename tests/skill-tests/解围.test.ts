// 解围(界曹仁·转化技)测试 —— 来源:2026-08-25 bug 审查修复回归
//   修复点①:transform validate 收窄为仅装备区牌(官方:「装备区里的牌当【无懈可击】使用」,
//     原实现放行手牌中的装备牌;该收窄为纯 validate 条件变更,依赖无懈窗口才能端到端驱动,
//     本文件以效果②回归为主,效果①由类型检查与代码审查覆盖)。
//   修复点②(本文件核心):「翻面后」after-hook 触发方向曾写反——官方描述为
//     「当你从背面翻至正面时」(faceDown===false),原实现在 faceDown===true(翻成背面)时
//     触发。本文件锁定正确方向。
//
// 效果②完整链路:确认发动 → 弃一张手牌 → 选源玩家 → 选源牌 → 选目标玩家 → 移动场上牌。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '曹仁',
    health: 4,
    maxHealth: 4,
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

function baseState(): GameState {
  const cardMap: Record<string, Card> = {
    jw1: makeCard('jw1', '杀', '♠', '7'),
    x1: makeCard('x1', '闪', '♥', '2'),
  };
  return createGameState({
    players: [
      // P0 界曹仁:持有解围,手牌留一张可弃
      makePlayer({ index: 0, name: 'P0', hand: ['jw1'], skills: ['解围'] }),
      // P1 有手牌(满足"场上有可移动的牌")
      makePlayer({ index: 1, name: 'P1', character: '张辽', hand: ['x1'], skills: [] }),
    ],
    cardMap,
    zones: { deck: [], discardPile: [], processing: [] },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('解围', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 触发方向回归(修复点②)────────────────────
  it('翻成背面(faceDown=true)时不触发解围', async () => {
    await harness.setup(baseState());

    await applyAtom(harness.state, { type: '翻面后', player: 0, faceDown: true });
    await waitForStable(harness.state);

    expect(harness.state.pendingSlots.get(0)).toBeUndefined();
  });

  it('从背面翻至正面(faceDown=false)时触发解围询问', async () => {
    await harness.setup(baseState());

    void applyAtom(harness.state, { type: '翻面后', player: 0, faceDown: false });
    await waitForStable(harness.state);

    const slot = harness.state.pendingSlots.get(0);
    expect(slot).toBeDefined();
    const atom = slot!.atom as { type?: string; requestType?: string };
    expect(atom.requestType).toBe('解围/confirm');
  });

  // ─── 效果②完整链路(方向修正后可达)────────────────────
  it('确认发动后弃1张手牌并将场上牌移动到目标玩家', async () => {
    await harness.setup(baseState());
    const P0 = harness.player('P0');

    // 翻回正面触发(hook 内发阻塞型询问,fire-and-forget 驱动)
    void applyAtom(harness.state, { type: '翻面后', player: 0, faceDown: false });
    await waitForStable(harness.state);

    // 步骤1:确认发动
    await P0.respond('解围', { choice: true });
    await waitForStable(harness.state);

    // 步骤2:弃置 jw1
    await P0.respond('解围', { cardId: 'jw1' });
    await waitForStable(harness.state);

    // 步骤3:源玩家 P1
    await P0.respond('解围', { target: 1 });
    await waitForStable(harness.state);

    // 步骤4:源牌(P1 手牌第 0 张 x1)
    await P0.respond('解围', { zone: 'hand', cardId: 'x1', handIndex: 0 });
    await waitForStable(harness.state);

    // 步骤5:目标玩家(2 人局只能选 P0 自己)
    await P0.respond('解围', { target: 0 });
    await waitForStable(harness.state);

    // 断言:jw1 已弃置,x1 从 P1 移动到 P0
    expect(harness.state.zones.discardPile).toContain('jw1');
    expect(harness.state.players[0].hand).toContain('x1');
    expect(harness.state.players[1].hand).not.toContain('x1');
    // 重入保护标志已清理
    expect(harness.state.localVars['解围/moving']).toBeUndefined();
  });

  // ─── 无手牌可弃时不触发 ────────────────────
  it('曹仁无手牌时不询问解围', async () => {
    const st = baseState();
    st.players[0].hand = [];
    await harness.setup(st);

    await applyAtom(harness.state, { type: '翻面后', player: 0, faceDown: false });
    await waitForStable(harness.state);

    expect(harness.state.pendingSlots.get(0)).toBeUndefined();
  });
});
