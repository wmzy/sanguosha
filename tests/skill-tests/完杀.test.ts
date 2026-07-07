// 完杀(贾诩·锁定技)测试:在你的回合,除你以外,只有濒死角色才能使用【桃】。
//
// 验证:
//   1. 贾诩回合内,第三方(P3)被完杀跳过求桃问询 → 无人救 → 濒死者死亡
//   2. 贾诩本人可在自己回合内对濒死者使用桃(完杀允许"你")
//   3. 濒死者本人可对自己使用桃(完杀允许濒死角色)
//   4. 负面对照:非贾诩回合,完杀不生效,第三方可正常救援
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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

describe('完杀', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 第三方被完杀跳过 → 濒死者死亡 ─────────────────
  it('贾诩回合内:第三方 P3 求桃被跳过,无人救则濒死者死亡', async () => {
    const slash = mkCard('s1', '杀', '♠', '7');
    const peach = mkCard('p1', '桃', '♥', '3');
    await harness.setup(
      createGameState({
        players: [
          // 贾诩(当前回合),有杀无桃
          mkPlayer({
            index: 0,
            name: '贾诩',
            character: '贾诩',
            hand: [slash.id],
            skills: ['完杀', '杀'],
            health: 3,
            maxHealth: 3,
          }),
          // P2:1 血,即将濒死
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 1, maxHealth: 4 }),
          // P3:有桃,但完杀下不能救
          mkPlayer({ index: 2, name: 'P3', hand: [peach.id], skills: ['桃'], health: 4 }),
        ],
        cardMap: { s1: slash, p1: peach },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('贾诩');
    const P2 = harness.player('P2');

    // 贾诩 杀 P2
    await JX.useCardAndTarget('杀', 's1', [1]);
    // P2 不闪 → 受伤濒死 → 求桃流程
    await P2.pass();
    await harness.waitForStable();

    // 求桃顺序:P2(濒死者本人)→ P3 → 贾诩。
    // P2 先被问 → P2 无桃 pass
    await P2.pass();
    await harness.waitForStable();

    // 完杀:P3 的求桃问询被 cancel(不创建 pending),流程直接跳到贾诩
    // → 当前 pending 应是贾诩(idx 0),而非 P3(idx 2)
    const pendingSlot = [...harness.state.pendingSlots.values()][0];
    expect(pendingSlot).toBeTruthy();
    expect((pendingSlot!.atom as { target: number }).target).toBe(0); // 问贾诩,P3 被跳过

    // 贾诩也无桃,pass → 无人救援,P2 死亡
    await JX.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].alive).toBe(false);
    // P3 的桃从未被使用
    expect(harness.state.players[2].hand).toContain('p1');
  });

  // ─── 2. 贾诩本人可在自己回合内救援 ─────────────────
  it('贾诩回合内:贾诩本人可对濒死者使用桃(完杀允许"你")', async () => {
    const slash = mkCard('s2', '杀', '♠', '8');
    const peach = mkCard('p2', '桃', '♦', '4');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '贾诩',
            hand: [slash.id, peach.id],
            skills: ['完杀', '杀', '桃'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 1, maxHealth: 4 }),
          mkPlayer({ index: 2, name: 'P3', hand: [], skills: [], health: 4 }),
        ],
        cardMap: { s2: slash, p2: peach },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('贾诩');
    const P2 = harness.player('P2');

    await JX.useCardAndTarget('杀', 's2', [1]);
    await P2.pass(); // 不闪 → 濒死
    await harness.waitForStable();

    // P2(濒死者)先被问,无桃 pass
    await P2.pass();
    await harness.waitForStable();

    // P3 被完杀跳过,直接问贾诩 → 贾诩出桃救援
    await JX.respond('桃', { cardId: 'p2' });
    await harness.waitForStable();

    // P2 被救回(1 体力,存活)
    expect(harness.state.players[1].alive).toBe(true);
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[0].hand).not.toContain('p2'); // 贾诩的桃已用
  });

  // ─── 3. 濒死者本人可对自己使用桃 ─────────────────
  it('贾诩回合内:濒死者本人可对自己使用桃', async () => {
    const slash = mkCard('s3', '杀', '♠', '9');
    const peach = mkCard('p3', '桃', '♥', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '贾诩',
            hand: [slash.id],
            skills: ['完杀', '杀'],
            health: 3,
            maxHealth: 3,
          }),
          // P2 濒死者本人持有桃
          mkPlayer({
            index: 1,
            name: 'P2',
            hand: [peach.id],
            skills: ['闪', '桃'],
            health: 1,
            maxHealth: 4,
          }),
          mkPlayer({ index: 2, name: 'P3', hand: [], skills: [], health: 4 }),
        ],
        cardMap: { s3: slash, p3: peach },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('贾诩');
    const P2 = harness.player('P2');

    await JX.useCardAndTarget('杀', 's3', [1]);
    await P2.pass(); // 不闪 → 濒死
    await harness.waitForStable();

    // P2(濒死者)先被问 → 对自己出桃
    await P2.respond('桃', { cardId: 'p3' });
    await harness.waitForStable();

    expect(harness.state.players[1].alive).toBe(true);
    expect(harness.state.players[1].health).toBe(1);
  });

  // ─── 4. 负面对照:非贾诩回合,完杀不生效 ─────────────────
  it('非贾诩回合:第三方可正常救援(完杀仅在贾诩回合生效)', async () => {
    const slash = mkCard('s4', '杀', '♠', '6');
    const peach = mkCard('p4', '桃', '♥', '2');
    await harness.setup(
      createGameState({
        players: [
          // 贾诩作为第三方(非当前回合),持有桃
          mkPlayer({
            index: 0,
            name: '贾诩',
            hand: [peach.id],
            skills: ['完杀', '桃'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 1, maxHealth: 4 }),
          // P3 当前回合,有杀
          mkPlayer({
            index: 2,
            name: 'P3',
            hand: [slash.id],
            skills: ['杀'],
            health: 4,
          }),
        ],
        cardMap: { s4: slash, p4: peach },
        currentPlayerIndex: 2, // P3 回合,完杀不生效
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');
    const JX = harness.player('贾诩');

    // P3 杀 P2 → P2 濒死
    await P3.useCardAndTarget('杀', 's4', [1]);
    await P2.pass();
    await harness.waitForStable();

    // 求桃顺序(从濒死者 P2 起):P2 → P3 → 贾诩
    await P2.pass(); // P2 无桃
    await harness.waitForStable();
    // 接下来问 P3(当前 pending 应是 P3,idx 2——完杀未跳过任何角色)
    let slot = [...harness.state.pendingSlots.values()][0];
    expect((slot!.atom as { target: number }).target).toBe(2);
    await P3.pass(); // P3 无桃
    await harness.waitForStable();
    // 问贾诩(第三方)——完杀不生效,贾诩被正常问询
    slot = [...harness.state.pendingSlots.values()][0];
    expect((slot!.atom as { target: number }).target).toBe(0);
    await JX.respond('桃', { cardId: 'p4' }); // 贾诩 救 P2
    await harness.waitForStable();

    expect(harness.state.players[1].alive).toBe(true);
    expect(harness.state.players[1].health).toBe(1);
  });
});
