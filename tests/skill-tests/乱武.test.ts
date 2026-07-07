// 乱武(贾诩·限定技)测试:出牌阶段,令所有其他角色依次对距离最近者出杀,无法如此做者失去1点体力。
//
// 验证:
//   1. 无杀角色 → 失去1点体力
//   2. 有杀角色 → 对距离最近者出杀并结算
//   3. 限定技:用过一次后再次发动被拒绝
//   4. 多人:按座次依次处理,最近目标可自选
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, PlayerState } from '../../src/engine/types';

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
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
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
  };
}

describe('乱武', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 无杀角色 → 失去1点体力 ─────────────────
  it('无杀角色无法出杀 → 失去1点体力', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '贾诩',
            character: '贾诩',
            skills: ['乱武'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: [], health: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('贾诩');
    const P2 = harness.player('P2');

    // 贾诩发动乱武
    await JX.triggerAction('乱武', 'use');
    await harness.waitForStable();

    // P2 被问询(乱武/出杀);P2 无杀 → pass → 失去1体力
    expect(harness.state.players[1].health).toBe(4); // 尚未失血
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot!.atom as { target: number }).target).toBe(1);
    await P2.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3); // 失去1点体力
    // 限定技标记已设
    expect(harness.state.players[0].vars['乱武/used']).toBe(true);
  });

  // ─── 2. 有杀角色 → 对距离最近者出杀并结算 ─────────────────
  it('有杀角色 → 对距离最近者(贾诩)出杀并造成伤害', async () => {
    const slash = mkCard('sk1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '贾诩',
            character: '贾诩',
            skills: ['乱武'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [slash.id], skills: [], health: 4 }),
        ],
        cardMap: { sk1: slash },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('贾诩');
    const P2 = harness.player('P2');

    await JX.triggerAction('乱武', 'use');
    await harness.waitForStable();

    // P2 被问询 → 对唯一最近者贾诩出杀
    await P2.respond('乱武', { cardId: 'sk1', target: 0 });
    await harness.waitForStable();
    // 贾诩被询问闪
    let slot = [...harness.state.pendingSlots.values()][0];
    expect((slot!.atom as { type: string }).type).toBe('询问闪');
    // 贾诩不闪 → 受伤
    await JX.pass();
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(2); // 贾诩受 1 点伤害
    expect(harness.state.players[1].hand).not.toContain('sk1'); // P2 的杀已用
    expect(harness.state.zones.discardPile).toContain('sk1');
    void slot;
  });

  // ─── 3. 限定技:用过一次后再次发动被拒绝 ─────────────────
  it('限定技:用过一次后再次发动被拒绝', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '贾诩',
            character: '贾诩',
            skills: ['乱武'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: [], health: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('贾诩');
    const P2 = harness.player('P2');

    // 第一次发动
    await JX.triggerAction('乱武', 'use');
    await harness.waitForStable();
    await P2.pass(); // P2 无杀失血
    await harness.waitForStable();
    expect(harness.state.players[0].vars['乱武/used']).toBe(true);

    // 第二次发动 → 被拒绝
    await JX.expectRejected({ skillId: '乱武', actionType: 'use', params: {} });
  });

  // ─── 4. 多人:按座次依次处理,最近目标可自选 ─────────────────
  it('三人:依次处理,有杀者选择最近目标,无杀者失血', async () => {
    const slash = mkCard('sk2', '杀', '♣', '8');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '贾诩',
            character: '贾诩',
            skills: ['乱武'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [slash.id], skills: [], health: 4 }),
          mkPlayer({ index: 2, name: 'P3', hand: [], skills: [], health: 4 }),
        ],
        cardMap: { sk2: slash },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('贾诩');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    await JX.triggerAction('乱武', 'use');
    await harness.waitForStable();

    // 先问 P2(贾诩下家);P2 的最近集合={贾诩,P3},选 P3
    let slot = [...harness.state.pendingSlots.values()][0];
    expect((slot!.atom as { target: number }).target).toBe(1);
    await P2.respond('乱武', { cardId: 'sk2', target: 2 });
    await harness.waitForStable();
    // P3 被询问闪(因 P2 对其出杀)
    slot = [...harness.state.pendingSlots.values()][0];
    expect((slot!.atom as { type: string }).type).toBe('询问闪');
    await P3.pass(); // P3 不闪 → 受伤
    await harness.waitForStable();

    // P2 的杀结算完,继续问 P3(无杀)→ 失去1体力
    slot = [...harness.state.pendingSlots.values()][0];
    expect((slot!.atom as { target: number }).target).toBe(2);
    await P3.pass();
    await harness.waitForStable();

    // P3:受 P2 杀 1 点 + 乱武失血 1 点 = 共失 2 点
    expect(harness.state.players[2].health).toBe(2);
    expect(harness.state.players[0].health).toBe(3); // 贾诩未受影响
    expect(harness.state.zones.discardPile).toContain('sk2');
    void slot;
  });

  // ─── 5. 负面对照:非出牌阶段 / 非自己回合 → 拒绝 ─────────────────
  it('负面:非出牌阶段发动乱武被拒绝', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '贾诩',
            character: '贾诩',
            skills: ['乱武'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: [], health: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '摸牌', // 非出牌阶段
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const JX = harness.player('贾诩');
    await JX.expectRejected({ skillId: '乱武', actionType: 'use', params: {} });
  });
});
