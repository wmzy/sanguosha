// 界乱武(界贾诩·限定技)测试:
//   "限定技,出牌阶段,你可以令所有其他角色依次选择一项:1.对其距离最小的另一名角色
//    使用一张【杀】;2.失去1点体力。所有角色结算完毕后,你可以视为使用一张无距离
//    限制的【杀】。"
//
// 验证:
//   1. 标版主循环沿用:无杀角色 → 失去1点体力;有杀角色 → 对距离最近者出杀
//   2. 限定技:用过一次后再次发动被拒绝
//   3. 非出牌阶段 / 非自己回合 → 拒绝
//   4. 界版新增:主循环结束后,贾诩可视为使用一张无距离限制的【杀】
//   5. 界版新增:贾诩 pass 最终杀询问 → 不视为使用
//   6. 界版新增:贾诩出杀次数已满(canSlash=false)→ 跳过最终杀询问
//   7. 界版新增:无距离限制(目标可在攻击范围外)
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

describe('界乱武', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 标版主循环沿用:无杀角色 → 失去1点体力 ──
  it('无杀角色 → 失去1点体力(主循环结束后贾诩 pass 最终杀)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            skills: ['界乱武'],
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
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.triggerAction('界乱武', 'use');
    await harness.waitForStable();

    // P2 主循环问询 → pass → 失去1体力
    await P2.pass();
    await harness.waitForStable();
    expect(harness.state.players[1].health).toBe(3);

    // 主循环结束 → 贾诩被问最终杀目标(pass)
    const finalSlot = [...harness.state.pendingSlots.values()][0];
    expect((finalSlot.atom as { target: number }).target).toBe(0);
    await JX.pass();
    await harness.waitForStable();

    // 限定技标记
    expect(harness.state.players[0].vars['乱武/used']).toBe(true);
    // P2 未受额外伤害
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 2. 限定技:用过一次后再次发动被拒绝 ──
  it('限定技:用过一次后再次发动被拒绝', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            skills: ['界乱武'],
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
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.triggerAction('界乱武', 'use');
    await harness.waitForStable();
    await P2.pass();
    await harness.waitForStable();
    await JX.pass(); // 跳过最终杀
    await harness.waitForStable();
    expect(harness.state.players[0].vars['乱武/used']).toBe(true);

    await JX.expectRejected({ skillId: '界乱武', actionType: 'use', params: {} });
  });

  // ─── 3. 非出牌阶段 → 拒绝 ──
  it('负面:非出牌阶段发动乱武被拒绝', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            skills: ['界乱武'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: [], health: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '摸牌', // 非出牌
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const JX = harness.player('界贾诩');
    await JX.expectRejected({ skillId: '界乱武', actionType: 'use', params: {} });
  });

  // ─── 4. 界版新增:主循环结束后,贾诩可视为使用无距离限制的【杀】 ──
  it('界版:贾诩视为使用无距离限制【杀】(主循环 P2 失血后,贾诩选择 P2 为最终杀目标)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            skills: ['界乱武'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.triggerAction('界乱武', 'use');
    await harness.waitForStable();
    await P2.pass(); // P2 主循环失血
    await harness.waitForStable();
    expect(harness.state.players[1].health).toBe(3);

    // 主循环结束 → 贾诩选最终杀目标(P2)
    await JX.respond('界乱武', { target: 1 });
    await harness.waitForStable();

    // 贾诩视为对 P2 出杀 → P2 被询问闪
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('询问闪');
    // P2 不闪 → 受伤
    await P2.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(2); // 失血1(乱武) + 受杀1 = 2
    expect(harness.state.players[1].alive).toBe(true);
    // 视为出杀占出杀次数
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);
  });

  // ─── 5. 界版新增:贾诩 pass 最终杀询问 → 不视为使用 ──
  it('界版:贾诩 pass 最终杀询问 → 不视为使用(不消耗出杀次数)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            skills: ['界乱武'],
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
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.triggerAction('界乱武', 'use');
    await harness.waitForStable();
    await P2.pass(); // 主循环失血
    await harness.waitForStable();

    // 最终杀询问:贾诩 pass
    await JX.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3); // 只失血1(乱武)
    expect(harness.state.turn.vars['杀/usedCount']).toBeUndefined(); // 未消耗出杀次数
  });

  // ─── 6. 界版新增:贾诩出杀次数已满 → 跳过最终杀询问 ──
  it('界版:贾诩出杀次数已满 → 跳过最终杀询问(直接结束)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            skills: ['界乱武'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: [], health: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: { '杀/usedCount': 1 } }, // 已出1次杀(达上限)
      }),
    );
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.triggerAction('界乱武', 'use');
    await harness.waitForStable();
    await P2.pass(); // 主循环失血
    await harness.waitForStable();

    // 出杀次数已满 → 不发起最终杀询问,直接结束
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(3); // 只失血1(乱武)
  });

  // ─── 7. 界版新增:无距离限制(目标可在攻击范围外) ──
  it('界版:贾诩视为出杀无距离限制(可指定攻击范围外的目标)', async () => {
    // 4 人局:贾诩 idx 0,P4 idx 3。贾诩无进攻马,默认攻击范围 1,P4 在距离 1(座位邻接)。
    // 用 6 人局确保 P6(idx 5)在攻击范围外(距离 > 1),验证无距离限制。
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            skills: ['界乱武'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: [], health: 4 }),
          mkPlayer({ index: 2, name: 'P3', hand: [], skills: [], health: 4 }),
          mkPlayer({ index: 3, name: 'P4', hand: [], skills: [], health: 4 }),
          mkPlayer({ index: 4, name: 'P5', hand: [], skills: [], health: 4 }),
          mkPlayer({ index: 5, name: 'P6', hand: [], skills: ['闪'], health: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');
    const P4 = harness.player('P4');
    const P5 = harness.player('P5');
    const P6 = harness.player('P6');

    await JX.triggerAction('界乱武', 'use');
    await harness.waitForStable();

    // 主循环:5 个其他角色依次失血(均无杀)
    await P2.pass();
    await harness.waitForStable();
    await P3.pass();
    await harness.waitForStable();
    await P4.pass();
    await harness.waitForStable();
    await P5.pass();
    await harness.waitForStable();
    await P6.pass();
    await harness.waitForStable();

    // 主循环结束 → 贾诩被问最终杀目标
    const finalSlot = [...harness.state.pendingSlots.values()][0];
    expect((finalSlot.atom as { target: number }).target).toBe(0);

    // 选 P6(idx 5):距离 1(环形)→ 在攻击范围内。改选 P3(idx 2):距离 2,默认攻击范围外
    // 验证"无距离限制"接受 P3(距离 2)
    await JX.respond('界乱武', { target: 2 });
    await harness.waitForStable();

    // 贾诩视为对 P3 出杀 → P3 被询问闪
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('询问闪');
    expect((slot.atom as { target: number }).target).toBe(2);
    await P3.pass();
    await harness.waitForStable();

    expect(harness.state.players[2].health).toBe(2); // 失血1(乱武) + 受杀1 = 2
  });
});
