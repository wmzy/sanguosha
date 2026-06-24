// 南蛮入侵行为测试:验证逐个询问杀 + 伤害结算 + 无懈可击
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function build(opts?: { p2Hand?: string[]; p3?: boolean; extraCards?: Record<string, Card> }): GameState {
  const slash: Card = { id: 'c0', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  const nanman: Card = { id: 'nm1', name: '南蛮入侵', suit: '♠', rank: '7', type: '锦囊牌' };
  const cards: Record<string, Card> = { c0: slash, nm1: nanman, ...opts?.extraCards };
  const players = [
    { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
      hand: ['nm1'], equipment: {}, skills: ['南蛮入侵'], vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [] },
    { index: 1, name: 'P2', character: '反', health: 4, maxHealth: 4, alive: true,
      hand: opts?.p2Hand ?? [], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [] },
  ];
  if (opts?.p3) {
    players.push({ index: 2, name: 'P3', character: '反', health: 4, maxHealth: 4, alive: true,
      hand: [], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [] });
  }
  return createGameState({ players, cardMap: cards, currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} } });
}

describe('南蛮入侵', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('P2 无杀 → P2 扣 1 血, 南蛮进弃牌堆', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // 先有无懈可击询问 → pass
    const slot0 = [...harness.state.pendingSlots.values()][0];
    if (slot0 && (slot0.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    // P2 被询问杀
    P2.expectPending('询问杀');
    await P2.pass(); // P2 不出杀

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('nm1');
    expect(harness.state.zones.processing).not.toContain('nm1');
    // view 级断言:health 通过 applyView 同步
    P2.processEvents();
    P2.expectView(v => expect(v.players[1].health).toBe(3));
  });

  it('P2 出杀 → P2 不扣血, 杀和南蛮都进弃牌堆', async () => {
    await harness.setup(build({ p2Hand: ['c0'], extraCards: { c0: { id: 'c0', name: '杀', suit: '♠', rank: '2', type: '基本牌' } } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // 先有无懈可击询问 → pass
    const slot0 = [...harness.state.pendingSlots.values()][0];
    if (slot0 && (slot0.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'c0' });

    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('nm1');
    expect(harness.state.zones.discardPile).toContain('c0');
  });

  it('3人局: P2出杀P3无杀 → P3扣血', async () => {
    const c2: Card = { id: 'c2', name: '杀', suit: '♠', rank: '3', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['c2'], p3: true, extraCards: { c2 } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // 先有无懈可击询问 → pass
    const slot0 = [...harness.state.pendingSlots.values()][0];
    if (slot0 && (slot0.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    // P2 先被询问
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'c2' });
    // P3 被询问
    const slot1 = [...harness.state.pendingSlots.values()][0];
    if (slot1 && (slot1.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    P3.expectPending('询问杀');
    await P3.pass();

    expect(harness.state.players[1].health).toBe(4); // P2 出杀不扣血
    expect(harness.state.players[2].health).toBe(3); // P3 无杀扣血
  });

  it('validate: 非自己回合拒绝', async () => {
    await harness.setup(build());
    const P2 = harness.player('P2');
    // P2 不是当前玩家
    await P2.expectRejected({ skillId: '南蛮入侵', actionType: 'use', params: { cardId: 'nm1', targets: [] } });
  });

  it('validate: pending期间拒绝', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // pending 期间 P1 再用
    await P1.expectRejected({ skillId: '南蛮入侵', actionType: 'use', params: { cardId: 'nm1', targets: [] } });
  });

  // Bug1 回归:4人局中当前为 index 0,顺时针顺序应为 1→2→3。
  // 修复前 filter() 顺序是 1→2→3(刚好也对),无法区分;改用 3 人局 from=2 验证。
  it('3人局 from=2: 顺时针目标顺序应为 [0, 1](从下家 0 开始)', async () => {
    const state = build({ p3: true });
    // 改 currentPlayerIndex 为 2(P3 为发起者)
    state.currentPlayerIndex = 2;
    // 让 P3 持有南蛮
    state.players[2].hand = ['nm1'];
    state.players[2].skills = ['南蛮入侵', '杀'];
    await harness.setup(state);
    const P3 = harness.player('P3');

    await P3.useCardAndTarget('南蛮入侵', 'nm1', []);
    // 先过无懈窗口
    const wuxieSlot = [...harness.state.pendingSlots.values()][0];
    if (wuxieSlot && (wuxieSlot.atom as { type: string }).type === '请求回应') {
      await harness.player(0).pass();
    }
    // 期望先问 P1(index 0),再问 P2(index 1)
    harness.player(0).expectPending('询问杀');
    await harness.player(0).pass();
    // 第二个询问杀
    const wuxieSlot2 = [...harness.state.pendingSlots.values()][0];
    if (wuxieSlot2 && (wuxieSlot2.atom as { type: string }).type === '请求回应') {
      await harness.player(1).pass();
    }
    harness.player(1).expectPending('询问杀');
    await harness.player(1).pass();

    // P1、P2 都未出杀 → 各扣 1 血;P3 自己是发起者不扣血
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[2].health).toBe(4);
  });

  // ─────────────────────────────────────────────────────────────
  // 逐目标无懈(新规则):对全体锦囊的某个目标出无懈,只抵消该目标的效果。
  // 3 人局:P3 出南蛮,P1 无杀、P2 无杀。P3 对 P2 出无懈 → P2 被抵消不扣血,
  // P1 正常受伤害。
  // ─────────────────────────────────────────────────────────────
  it('3人局:对 P2 出无懈 → P2 被抵消不扣血,P1 正常受伤害', async () => {
    const state = build({ p3: true });
    // 改为 P3 出南蛮
    state.currentPlayerIndex = 2;
    state.players[2].hand = ['nm1'];
    state.players[2].skills = ['南蛮入侵', '杀'];
    // 给 P3 一张无懈可击,用于抵消对 P2 的效果
    state.cardMap['wx1'] = { id: 'wx1', name: '无懈可击', suit: '♠', rank: 'J', type: '锦囊牌' };
    state.players[2].hand.push('wx1');
    state.players[2].skills.push('无懈可击');
    await harness.setup(state);
    const P3 = harness.player('P3');

    await P3.useCardAndTarget('南蛮入侵', 'nm1', []);

    // 目标顺序 [P1, P2],每个目标独立询问无懈
    // 第一个目标 P1 的无懈窗口:pass
    await harness.player(0).pass();
    // P1 被询问杀 → 不出
    harness.player(0).expectPending('询问杀');
    await harness.player(0).pass();

    // 第二个目标 P2 的无懈窗口:P3 出无懈抵消对 P2 的效果
    // 当前 pending 应是无懈可击广播窗口
    const wuxieSlot = [...harness.state.pendingSlots.values()][0];
    expect((wuxieSlot.atom as { requestType?: string }).requestType).toBe('无懈可击');
    await P3.respond('无懈可击', { cardId: 'wx1' });
    // 无懈 close-reopen:respond 后旧 slot resolve，askWuxie 创建新窗口，需 pass 结束
    await P3.pass();

    // P2 被抵消 → 不会被询问杀,直接结束
    expect(harness.state.players[0].health).toBe(3); // P1 正常受伤
    expect(harness.state.players[1].health).toBe(4); // P2 被抵消不受伤
    expect(harness.state.players[2].health).toBe(4); // P3 发起者
    expect(harness.state.zones.discardPile).toContain('nm1');
    expect(harness.state.zones.discardPile).toContain('wx1');
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
