// tests/skill-tests/界诛害.test.ts
// 界诛害(界徐庶·被动技)测试:
//   其他角色的结束阶段，若其本回合造成过伤害，你可以对其使用一张【杀】。
//
// 验证:
//   1. happy path:P1 在自己回合造成伤害 → 结束阶段触发 → P0 用杀 → P1 受伤
//   2. 不发动:P1 造成过伤害但 P0 选不发动 → 无事发生
//   3. 不满足"P1 本回合造成过伤害" → 不触发
//   4. 不满足"其他角色"(P0 自己回合结束) → 不触发
//   5. P0 无杀 → 不触发(无法发动)
//   6. P1 受伤后用闪抵消 → 不受伤
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
// 临时注册界诛害(主 agent 会统一注册到 index.ts)
import { skillLoaders } from '../../src/engine/skills';
import * as 界诛害Module from '../../src/engine/skills/界诛害';
import type { SkillModule } from '../../src/engine/skill';
skillLoaders['界诛害'] = async () => 界诛害Module as unknown as SkillModule;

import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
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
  alive?: boolean;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界徐庶',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界诛害'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发 P1 的回合结束阶段:applyAtom(阶段开始, 1, 回合结束) */
async function triggerEndPhase(harness: SkillTestHarness, player = 1): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '回合结束' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界诛害', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path ─────────────────────────────────────
  it('happy path:P1 回合造成伤害 → 结束阶段触发 → P0 用杀 → P1 受伤', async () => {
    const kill = makeCard('kill1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['kill1'], skills: ['界诛害'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 在自己回合造成伤害(直接 runDamageFlow 模拟)
    await runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    // 触发 P1 的结束阶段
    await triggerEndPhase(harness);
    // P0 被询问是否发动
    P0.expectPending('请求回应');
    await P0.respond('界诛害', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 被询问选杀
    P0.expectPending('请求回应');
    await P0.respond('界诛害', { cardId: 'kill1' });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 被询问闪 → 不闪
    const P1 = harness.player('P1');
    await P1.pass();

    // P1 受 1 伤(诛害杀生效),P0 杀已用
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].hand).not.toContain('kill1');
  });

  // ─── 2. 不发动 ────────────────────────────────────────
  it('P0 选不发动 → 无事发生,P1 不受伤,P0 杀仍在手', async () => {
    const kill = makeCard('kill1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['kill1'], skills: ['界诛害'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    await triggerEndPhase(harness);
    P0.expectPending('请求回应');
    await P0.respond('界诛害', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].hand).toContain('kill1');
  });

  // ─── 3. P1 本回合未造成伤害 → 不触发 ─────────────────
  it('P1 本回合未造成伤害 → 不触发', async () => {
    const kill = makeCard('kill1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['kill1'], skills: ['界诛害'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 不造成伤害,直接触发结束阶段
    await triggerEndPhase(harness);

    // 无 pending(诛害未触发)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 4. 自己回合结束 → 不触发 ─────────────────────────
  it('P0 自己回合结束 → 不触发(必须其他角色)', async () => {
    const kill = makeCard('kill1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['kill1'], skills: ['界诛害'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P0 自己造成过伤害
    await runDamageFlow(harness.state, 0, 1, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 自己的结束阶段 → 不触发
    await triggerEndPhase(harness, 0);

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(3); // 之前那次伤害
    expect(harness.state.players[0].hand).toContain('kill1'); // 杀仍在
  });

  // ─── 5. P0 手牌无杀 → 不触发 ──────────────────────────
  it('P0 手牌无杀 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界诛害'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    await triggerEndPhase(harness);

    // 无 pending(诛害未触发因 P0 无杀)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 6. P1 出闪抵消 ───────────────────────────────────
  it('P1 出闪抵消 → 不受伤', async () => {
    const kill = makeCard('kill1', '杀', '♠');
    const dodge = makeCard('dodge1', '闪', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['kill1'], skills: ['界诛害'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['dodge1'],
          skills: ['闪'],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill, dodge1: dodge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    await triggerEndPhase(harness);
    await P0.respond('界诛害', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界诛害', { cardId: 'kill1' });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 出闪
    const P1 = harness.player('P1');
    P1.expectPending('询问闪');
    await P1.respond('闪', { cardId: 'dodge1' });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(4); // 闪抵消,未受伤
    expect(harness.state.players[1].hand).not.toContain('dodge1');
  });
});
