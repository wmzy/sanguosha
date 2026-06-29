// tests/skill-tests/询问闪事件流.test.ts
// 询问闪事件流端到端测试：验证 applyView 增量维护的 pending 生命周期。
//
// 核心检查点（前端事件流路径,非 buildView 重建路径）:
//   1. 出杀后,target viewer 的 processedView.pending = 询问闪,且 prompt 可操作
//   2. 出杀后,非 target viewer 的 processedView.pending 也有 target(供视角切换)
//   3. 出闪后,两个 viewer 的 pending 都应清除(pendingResolved 事件)
//   4. 不出闪(超时)后,两个 viewer 的 pending 都应清除

import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: { index: number; name: string; hand: string[]; skills: string[] }) {
  return {
    ...opts,
    character: '主公',
    health: 4,
    maxHealth: 4,
    alive: true,
    equipment: {},
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildState(opts?: { p2Hand?: string[]; extraCardMap?: Record<string, Card> }): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
  const dodge: Card = { id: 'c3', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['杀'] }),
      makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand ?? [], skills: ['闪'] }),
    ],
    cardMap: { c1: slash, c3: dodge, ...opts?.extraCardMap },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('询问闪事件流(applyView 增量路径)', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('出杀后:target viewer 的 processedView.pending = 询问闪(可操作)', async () => {
    await harness.setup(buildState({ p2Hand: ['c3'] }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀 → 产生 询问闪 事件
    await P1.useCardAndTarget('杀', 'c1', [1]);

    // P2 是 target,processedView.pending 应为 询问闪
    const p2Pending = P2.processedView.pending;
    expect(p2Pending).not.toBeNull();
    expect(p2Pending!.atom.type).toBe('询问闪');
    expect(p2Pending!.target).toBe(1);

    // prompt 必须是 useCard(可操作),否则前端不会高亮闪牌
    expect(p2Pending!.prompt.type).toBe('useCard');
    expect(p2Pending!.totalMs).toBe(15_000);
  });

  it('出杀后:非 target viewer 的 processedView.pending 也有 target(供视角切换)', async () => {
    await harness.setup(buildState({ p2Hand: ['c3'] }));
    const P1 = harness.player('P1');
    const _P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);

    // P1 不是 target,但 pending 应该有 target=1(供 useDebugPerspective 自动切换)
    const p1Pending = P1.processedView.pending;
    expect(p1Pending).not.toBeNull();
    expect(p1Pending!.target).toBe(1);
    expect(p1Pending!.atom.type).toBe('询问闪');
  });

  it('出闪后:两个 viewer 的 processedView.pending 都应清除', async () => {
    await harness.setup(buildState({ p2Hand: ['c3'] }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    // P2 出闪
    await P2.respond('闪', { cardId: 'c3' });

    // 两边 pending 都应清除
    expect(P1.processedView.pending).toBeNull();
    expect(P2.processedView.pending).toBeNull();
    // P2 不扣血
    expect(P2.processedView.players[1].health).toBe(4);
  });

  it('不出闪(超时)后:两个 viewer 的 processedView.pending 都应清除 + 掉血', async () => {
    await harness.setup(buildState({ p2Hand: ['c3'] }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    // P2 不出闪(pass = 超时)
    await P2.pass();

    expect(P1.processedView.pending).toBeNull();
    expect(P2.processedView.pending).toBeNull();
    expect(P2.processedView.players[1].health).toBe(3);
  });

  it('不回应(respond 空 params)后:pending 清除 + 掉血', async () => {
    await harness.setup(buildState({ p2Hand: ['c3'] }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    // P2 不回应(空 params)
    await P2.respond('闪', {});

    // 两边 pending 都应清除
    expect(P1.processedView.pending).toBeNull();
    expect(P2.processedView.pending).toBeNull();
    // P2 扣血
    expect(P2.processedView.players[1].health).toBe(3);
  });

  it('target viewer 的 pending.prompt 必须有 cardFilter(前端据此高亮可出的牌)', async () => {
    await harness.setup(buildState({ p2Hand: ['c3'] }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);

    const prompt = P2.processedView.pending!.prompt as {
      type: string;
      cardFilter?: { filter?: (c: Card) => boolean };
    };
    expect(prompt.type).toBe('useCard');
    expect(prompt.cardFilter).toBeDefined();
    expect(prompt.cardFilter!.filter).toBeDefined();
    // cardFilter 应该匹配闪牌
    const dodgeCard = harness.state.cardMap['c3'];
    expect(prompt.cardFilter!.filter!(dodgeCard)).toBe(true);
    // 不匹配杀牌
    const slashCard = harness.state.cardMap['c1'];
    expect(prompt.cardFilter!.filter!(slashCard)).toBe(false);
  });
});
