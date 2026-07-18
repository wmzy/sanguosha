// tests/skill-tests/界神速.test.ts
// 界神速(界夏侯渊)测试:
//   3 选项(至多三项):
//   ① 跳过判定+摸牌 → 虚拟杀
//   ② 弃装备 + 跳过出牌 → 虚拟杀
//   ③ 翻面 + 跳过弃牌 → 虚拟杀
//
// 验证:
//   1. 仅①:发动后跳过判定+摸牌,P2 受伤
//   2. 仅③:加翻面标签 + 跳过弃牌 + P2 受伤(P0 不失体力)
//   3. ①+③:双虚拟杀,P0 加翻面标签(不失体力)
//   4. 全否:不发动,判定阶段正常
//   5. ②弃装备 + 虚拟杀 + 跳过出牌标签
//   6. ③翻面:下一回合准备阶段被消费,整回合被跳过,cPI 推进到下家
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

    // 询问①目标(无装备移动块已移除)
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

  // ─── 仅③:翻面 + 跳过弃牌 + 虚拟杀(不失体力) ───────────
  it('仅③:P0 加翻面标签 + P2 受伤 + 加跳过弃牌标签(P0 不失体力)', async () => {
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
    // ③目标(无装备移动块已移除)
    P1.expectPending('请求回应');
    await P1.respond('界神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    const P2 = harness.player('P2');
    await P2.pass();

    // P0 体力不变(代价是翻面,不是失体力)
    expect(harness.state.players[0].health).toBe(4);
    // P2 受伤(虚拟杀)
    expect(harness.state.players[1].health).toBe(3);
    // 跳过弃牌 + 翻面 标签
    expect(harness.state.players[0].tags).toContain('神速/跳过弃牌');
    expect(harness.state.players[0].tags).toContain('神速/翻面');
    expect(harness.state.players[0].tags).not.toContain('神速/跳过摸牌');
  });

  // ─── ①+③:双虚拟杀 ──────────────────────────────────
  it('①+③:P2 受 2 点伤害(双虚拟杀),P0 加翻面标签', async () => {
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
    // ①目标
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
    expect(harness.state.players[0].health).toBe(4); // 不失体力(代价是翻面)
    expect(harness.state.players[0].tags).toContain('神速/跳过摸牌');
    expect(harness.state.players[0].tags).toContain('神速/跳过弃牌');
    expect(harness.state.players[0].tags).toContain('神速/翻面');
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
    // 选弃哪张装备(无装备移动块)
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

  // ─── ③翻面:下一回合准备阶段被消费,整回合被跳过 ─────────
  it('③翻面:下一回合准备阶段消费翻面标签 + skipAll + cPI 推进到下家', async () => {
    const state: GameState = createGameState({
      players: [
        // 预设翻面标签,模拟上一回合界神速③已发动
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界神速'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 2, phase: '准备', vars: {} },
    });
    // 预设翻面标签
    state.players[0].tags = ['神速/翻面'];
    await harness.setup(state);

    // 模拟 回合管理 的回合启动序列:回合开始 → 阶段开始(准备) → 阶段结束(准备)
    // 界神速 在 阶段开始(准备) cancel + 设 skipAll;
    // 阶段结束(准备) before-hook 检测 skipAll → 主动推进回合(下一玩家 + 回合结束)
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '准备' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 翻面标签已被消费
    expect(harness.state.players[0].tags).not.toContain('神速/翻面');
    // cPI 已推进到下家(整回合被跳过)
    expect(harness.state.currentPlayerIndex).toBe(1);
  });
});
