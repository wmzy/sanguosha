// tests/skill-tests/界神速.test.ts
// 界神速(界夏侯渊)测试:
//   3 选项(至多三项)+ 界版移动场上装备:
//   ① 跳过判定+摸牌 → 虚拟杀
//   ② 弃装备 + 跳过出牌 → 虚拟杀
//   ③ 失1血 + 跳过弃牌 → 虚拟杀
//   发动时可移动场上一张装备牌
//
// 验证:
//   1. 仅①:发动后跳过判定+摸牌,P2 受伤
//   2. 仅③:失1血 + 跳过弃牌 + 虚拟杀
//   3. ①+③:双虚拟杀,跳过判定+摸牌+弃牌
//   4. 界版移动装备:P2 武器→P0
//   5. 全否:不发动,判定阶段正常
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
// 临时注册界神速(主 agent 会统一注册到 index.ts)
import { skillLoaders } from '../../src/engine/skills';
import * as 界神速Module from '../../src/engine/skills/界神速';
import type { SkillModule } from '../../src/engine/skill';
skillLoaders['界神速'] = async () => 界神速Module as unknown as SkillModule;

import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
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
  equipment?: PlayerState['equipment'];
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界夏侯渊',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界神速'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发判定阶段 → 界神速 before-hook 询问 */
async function triggerJudgePhase(harness: SkillTestHarness, player = 0): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '判定' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界神速', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 仅①:跳过判定+摸牌,虚拟杀 ────────────────────────
  it('仅①:发动后 P2 受伤 + 加跳过摸牌标签', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界神速'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    // ① 询问
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无装备→跳过②;③询问
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无场上装备→跳过移动;询问①目标
    P1.expectPending('请求回应');
    await P1.respond('界神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // virtualKill 询问 P2 出闪 → 不闪
    const P2 = harness.player('P2');
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3); // P2 受 1 伤
    expect(harness.state.players[0].tags).toContain('神速/跳过摸牌');
    expect(harness.state.players[0].vars['神速/usedThisTurn']).toBe(true);
  });

  // ─── 仅③:失1血 + 跳过弃牌 + 虚拟杀 ────────────────────
  it('仅③:P0 失1血 + P2 受伤 + 加跳过弃牌标签', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界神速'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    // ① 不发动
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();
    // ③(无装备→②跳过)
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // 无场上装备→跳过移动;③目标
    P1.expectPending('请求回应');
    await P1.respond('界神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    const P2 = harness.player('P2');
    await P2.pass();

    expect(harness.state.players[0].health).toBe(3); // P0 失1血
    expect(harness.state.players[1].health).toBe(3); // P2 受伤
    expect(harness.state.players[0].tags).toContain('神速/跳过弃牌');
    expect(harness.state.players[0].tags).not.toContain('神速/跳过摸牌');
  });

  // ─── ①+③:双虚拟杀 ──────────────────────────────────
  it('①+③:P2 受 2 点伤害(双虚拟杀)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界神速'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    // ① 发动
    await P1.respond('界神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // ③ 发动(②跳过)
    await P1.respond('界神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // 无场上装备→跳过移动;①目标
    await P1.respond('界神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();
    // ① P2 被杀 → 不闪
    const P2a = harness.player('P2');
    await P2a.pass();

    // ③目标
    await P1.respond('界神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();
    // ③ P2 被杀 → 不闪
    const P2b = harness.player('P2');
    await P2b.pass();

    expect(harness.state.players[1].health).toBe(2); // 2 次虚拟杀
    expect(harness.state.players[0].health).toBe(3); // ③失1血
    expect(harness.state.players[0].tags).toContain('神速/跳过摸牌');
    expect(harness.state.players[0].tags).toContain('神速/跳过弃牌');
  });

  // ─── 界版移动装备:P2 武器→P0 ────────────────────────
  it('界版移动装备:P2 武器移动到 P0', async () => {
    const weapon: Card = {
      id: 'w1',
      name: '诸葛连弩',
      suit: '♣',
      color: '黑',
      rank: 'A',
      type: '装备牌',
      subtype: '武器',
      range: 1,
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界神速'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
          equipment: { '武器': 'w1' },
        }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    // ① 发动
    await P1.respond('界神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // ③ 不发动(②无装备跳过)
    await P1.respond('界神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 界版:移动装备确认(场上有 P2 武器)
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: true }); // 选择移动
    await harness.waitForStable();
    harness.processAllEvents();

    // 选源玩家 → P2
    P1.expectPending('请求回应');
    await P1.respond('界神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // 选源装备 → w1
    P1.expectPending('请求回应');
    await P1.respond('界神速', { cardIds: ['w1'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 选目标玩家 → P0(自己,P0 武器槽为空)
    P1.expectPending('请求回应');
    await P1.respond('界神速', { target: 0 });
    await harness.waitForStable();
    harness.processAllEvents();

    // ①虚拟杀目标 → P2
    P1.expectPending('请求回应');
    await P1.respond('界神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // P2 被杀 → 不闪
    const P2 = harness.player('P2');
    await P2.pass();

    // 验证:武器从 P2 移到 P0
    expect(harness.state.players[0].equipment['武器']).toBe('w1');
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].health).toBe(3); // P2 受伤
  });

  // ─── 全否:不发动 ──────────────────────────────────────
  it('全否:判定阶段正常进行,无标签', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界神速'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    // ① 不发动
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();
    // ③ 不发动(②无装备跳过)
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 未发动神速:无标签,无受伤,无 usedThisTurn
    expect(harness.state.players[0].tags).toHaveLength(0);
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].vars['神速/usedThisTurn']).toBeUndefined();
  });

  // ─── ②弃装备 + 虚拟杀 ─────────────────────────────────
  it('②:P0 弃装备 + P2 受伤 + 加跳过出牌标签', async () => {
    const weapon: Card = {
      id: 'w1',
      name: '诸葛连弩',
      suit: '♣',
      color: '黑',
      rank: 'A',
      type: '装备牌',
      subtype: '武器',
      range: 1,
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [],
          skills: ['界神速'],
          equipment: { '武器': 'w1' },
        }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [], character: '曹操' }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    // ① 不发动
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();
    // ② 发动(有装备)
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // ③ 不发动
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();
    // 不移动装备
    P1.expectPending('请求回应');
    await P1.respond('界神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();
    // 选弃哪张装备
    P1.expectPending('请求回应');
    await P1.respond('界神速', { cardIds: ['w1'] });
    await harness.waitForStable();
    harness.processAllEvents();
    // ②目标
    P1.expectPending('请求回应');
    await P1.respond('界神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // P2 被杀 → 不闪
    const P2 = harness.player('P2');
    await P2.pass();

    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].tags).toContain('神速/跳过出牌');
  });
});
