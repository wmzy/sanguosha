// 进趋(王基·被动技)测试 —— 来源:2026-08-25 bug 审查修复回归;此前无任何测试文件,
// 归并建议:如后续按武将合并测试文件,可与 奇制.test.ts(同武将 王基)并入同一文件。
//
//   官方逐字:「结束阶段,你可以摸两张牌,然后将手牌弃至X张(X为你本回合发动'奇制'的次数)。」
//
//   修复点:强制弃牌的 respond 曾不校验张数与重复——恶意提交可少弃/多弃,且重复 cardId
//   会经 弃置 atom 的 discardPile.push(...cardIds) 造成弃牌堆同 id 复制。
//
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable, fireTimeoutAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type: '基本牌' };
}

function buildState(hand: string[]): GameState {
  const cardMap: Record<string, Card> = {};
  for (const id of hand) cardMap[id] = makeCard(id, '杀', '♠', '7');
  const state = createGameState({
    players: [
      {
        index: 0,
        name: '王基',
        character: '王基',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand,
        equipment: {},
        skills: ['进趋'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P1',
        character: '敌将',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: [],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap,
    zones: { deck: [], discardPile: [], processing: [] },
    currentPlayerIndex: 0,
    phase: '回合结束',
    turn: { round: 1, phase: '回合结束', vars: { '奇制/count': 2 } },
  });
  return state;
}

/** 驱动到弃牌询问 pending(确认发动 → 摸2 → 发 DISCARD_RT) */
async function driveToDiscardPrompt(h: SkillTestHarness): Promise<void> {
  void applyAtom(h.state, { type: '阶段开始', player: 0, phase: '回合结束' });
  await waitForStable(h.state);

  const P0 = h.player('王基');
  await P0.respond('进趋', { choice: true });
  await waitForStable(h.state);
}

describe('进趋', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── happy path:X=2,手牌 2 → 摸 2 → 弃 2 至 X ────────────────────
  it('发动后摸2张并弃至X=2张', async () => {
    await harness.setup(buildState(['h1', 'h2']));
    const before = harness.state.players[0].hand.length; // 2

    await driveToDiscardPrompt(harness);

    // 已摸 2 张:手牌 4,当前 pending 为弃牌询问
    expect(harness.state.players[0].hand.length).toBe(before + 2);
    const slot = harness.state.pendingSlots.get(0);
    const atom = slot?.atom as { requestType?: string } | undefined;
    expect(atom?.requestType).toBe('进趋/弃牌');

    const P0 = harness.player('王基');
    const handNow = [...harness.state.players[0].hand];
    await P0.respond('进趋', { cardIds: [handNow[0], handNow[1]] });
    await waitForStable(harness.state);

    // 弃至 X=2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.discardPile).toContain(handNow[0]);
    expect(harness.state.zones.discardPile).toContain(handNow[1]);
  });

  // ─── 修复点回归:张数校验 ────────────────────
  it('提交张数不足(excess=2 只交1张)被拒绝,超时兜底自动补弃', async () => {
    await harness.setup(buildState(['h1', 'h2']));
    await driveToDiscardPrompt(harness);

    const P0 = harness.player('王基');
    const handNow = [...harness.state.players[0].hand];
    // 仅提交 1 张(需 2 张) → validate 拒绝
    await P0.expectRejected({ skillId: '进趋', actionType: 'respond', params: { cardIds: [handNow[0]] } });

    // 未发生任何弃置
    expect(harness.state.zones.discardPile.length).toBe(0);
    // 强制型询问超时 → 兜底从手牌首张补弃 excess 张
    await fireTimeoutAndWait(harness.state);
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.discardPile.length).toBe(2);
  });

  // ─── 修复点回归:查重校验 ────────────────────
  it('提交重复 cardId 被拒绝且弃牌堆不产生复制', async () => {
    await harness.setup(buildState(['h1', 'h2']));
    await driveToDiscardPrompt(harness);

    const P0 = harness.player('王基');
    const dupId = harness.state.players[0].hand[0];
    await P0.expectRejected({
      skillId: '进趋',
      actionType: 'respond',
      params: { cardIds: [dupId, dupId] },
    });

    // 超时兜底正常弃置后,弃牌堆不得出现重复条目
    await fireTimeoutAndWait(harness.state);
    const counts = new Map<string, number>();
    for (const id of harness.state.zones.discardPile) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [, n] of counts) expect(n).toBe(1);
    expect(harness.state.players[0].hand.length).toBe(2);
  });

  // ─── 不发动:不摸牌不弃牌 ────────────────────
  it('选择不发动则无事发生', async () => {
    await harness.setup(buildState(['h1', 'h2']));
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await waitForStable(harness.state);

    const P0 = harness.player('王基');
    await P0.respond('进趋', { choice: false });
    await waitForStable(harness.state);

    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.discardPile.length).toBe(0);
  });
});
