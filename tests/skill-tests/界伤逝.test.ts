// 界伤逝(界张春华·被动技)测试:
//   "当你的手牌数小于X后,你可以将手牌摸至X张。(X为你已损失体力值)"
//
// 覆盖:
//   1. 春华受伤后 hand < X → 询问 → 确认 → 摸至 X 张
//   2. 春华受伤后 hand < X → 询问 → 取消 → 不摸牌
//   3. 春华受伤但 hand ≥ X → 不触发
//   4. 春华未受伤(X=0) → 不触发
//   5. 春华失去体力(无来源)后 hand < X → 触发(失去体力 hook)
//   6. 春华出牌后 hand < X → 触发(移动牌 hook)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/core/apply';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
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
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界张春华',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? opts.health ?? 3,
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

describe('界伤逝', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 春华受伤 hand<X → 确认 → 摸至X张 ─────────────────
  it('春华受伤后 hand<X → 确认 → 摸至 X 张', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const c2 = makeCard('d1', '杀', '♠', '8');
    const c3 = makeCard('d2', '杀', '♠', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: [],
          skills: ['界伤逝', '闪'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻',
          character: '张飞',
          hand: ['k1'],
          skills: ['杀'],
        }),
      ],
      cardMap: { k1: slash, d1: c2, d2: c3 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('攻');
    const P0 = harness.player('春华');

    // 攻杀春华 → 春华 0 手牌 → 询问闪 skip(不创建 slot)→ 直接扣血(health=2,X=1)
    // → hand=0 < 1 → 伤逝触发(无需 pass 推进闪询问)
    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state);

    // 应有伤逝 confirm pending
    const slots = [...harness.state.pendingSlots.values()];
    expect(slots.length).toBe(1);
    const slot = slots[0];
    const atom = slot.atom as { type: string; requestType?: string };
    expect(atom.type).toBe('请求回应');
    expect(atom.requestType).toBe('界伤逝/confirm');

    // 确认发动
    await P0.respond('界伤逝', { choice: true });
    await waitForStable(harness.state);

    // 春华摸至 X=1 张:hand=1
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 2. 春华受伤 hand<X → 取消 → 不摸牌 ────────────────────
  it('春华受伤后 hand<X → 取消 → 不摸牌', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: [],
          skills: ['界伤逝', '闪'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻',
          character: '张飞',
          hand: ['k1'],
          skills: ['杀'],
        }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('攻');
    const P0 = harness.player('春华');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass();
    await waitForStable(harness.state);

    // 取消(直接 pass 触发超时 defaultChoice=false)
    await P0.pass();
    await waitForStable(harness.state);

    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 3. 春华受伤但 hand ≥ X → 不触发 ────────────────────
  it('春华受伤但 hand ≥ X → 不触发', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const c1 = makeCard('h1', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: ['h1'],
          skills: ['界伤逝', '闪'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻',
          character: '张飞',
          hand: ['k1'],
          skills: ['杀'],
        }),
      ],
      cardMap: { k1: slash, h1: c1 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('攻');
    const P0 = harness.player('春华');

    // 春华 hand=1,受伤后 X=1, hand=1 ≥ 1 → 不触发
    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass();
    await waitForStable(harness.state);

    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand.length).toBe(1);
    // 无伤逝 confirm pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 4. 春华未受伤(X=0) → 即便手牌减少也不触发 ────────────────────
  it('春华未受伤(X=0)即便手牌减少也不触发', async () => {
    const c1 = makeCard('c1', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: ['c1'],
          skills: ['界伤逝'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '友',
          character: '刘备',
          hand: [],
          skills: [],
        }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 春华满血(X=0)。手牌被弃 → hand 1→0,但 X=0,hand<X 恒不成立 → 不触发
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1'] });
    await waitForStable(harness.state);

    expect(harness.state.players[0].hand.length).toBe(0);
    // X=0,即便 hand 减少也不触发伤逝
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 5. 春华失去体力后 hand<X → 触发(失去体力 hook) ────────
  it('春华失去体力后 hand<X → 触发(失去体力 hook)', async () => {
    // 直接 applyAtom(失去体力) 触发 after-hook(本仓库标准做法,见许降/屯田/奋激等测试)。
    // 春华 maxHealth=3,health=2(X=1),hand=0。失去 1 点体力 → health=1,X=2,hand=0<2 → 触发。
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: [],
          skills: ['界伤逝'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '观',
          character: '刘备',
          hand: [],
          skills: [],
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');

    // 直接失去 1 点体力 → 失去体力 after-hook → hand=0 < X=2 → 伤逝 confirm
    void applyAtom(harness.state, { type: '失去体力', target: 0, amount: 1 });
    await waitForStable(harness.state);

    // 应有伤逝 confirm pending
    const slot = [...harness.state.pendingSlots.values()][0];
    const atom = slot.atom as { type: string; requestType?: string };
    expect(atom.type).toBe('请求回应');
    expect(atom.requestType).toBe('界伤逝/confirm');

    // 确认发动 → 摸至 X=2 张
    await P0.respond('界伤逝', { choice: true });
    await waitForStable(harness.state);

    expect(harness.state.players[0].health).toBe(1);
    expect(harness.state.players[0].hand.length).toBe(2);
  });

  // ─── 6. 春华出牌后 hand<X → 触发(移动牌 hook) ─────────
  it('春华出牌后 hand<X → 触发(移动牌 hook)', async () => {
    // 春华 maxHealth=3,health=1(X=2),hand=1。春华自己出杀 → hand=0 < 2 → 触发
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: ['k1'],
          skills: ['界伤逝', '杀'],
          health: 1,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '敌',
          character: '曹操',
          hand: [],
          skills: [],
        }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');

    // 春华出杀 → 移动牌(手牌→处理区)→ 春华 hand=0 < X=2 → 触发伤逝
    await P0.useCardAndTarget('杀', 'k1', [1]);
    await waitForStable(harness.state);

    // 春华出杀后目标不出闪(她绝情未实现,造成伤害正常)→ 春华出杀完成,
    // 但同时 hand=0 < X=2 → 伤逝 confirm 应出现
    // 等所有 pending 自然完成
    while (harness.state.pendingSlots.size > 0) {
      // 伤逝 confirm → 确认摸牌
      const slot = [...harness.state.pendingSlots.values()][0];
      const atom = slot.atom as { type: string; requestType?: string };
      if (atom.requestType === '界伤逝/confirm') {
        await P0.respond('界伤逝', { choice: true });
      } else {
        // 其他 pending(询问闪)直接 pass
        await P0.pass();
      }
      await waitForStable(harness.state);
    }

    // 春华出杀 hand 1→0,触发伤逝后摸至 X=2 张 → hand=2
    expect(harness.state.players[0].hand.length).toBe(2);
  });
});
