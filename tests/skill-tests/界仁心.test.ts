// tests/skill-tests/界仁心.test.ts
// 界仁心(界曹冲·被动技):当一名其他角色进入濒死时,
// 你可以弃置一张装备牌并翻面,然后令其回复至1点体力。
//
// 官方来源:三国杀 OL 界限突破 hero/628。
//
// 验证:
//   1. respond validate:无 pending → 拒绝
//   2. respond validate:SELECT 下选非装备牌 → 拒绝
//   3. respond execute:CONFIRM 下 choice 写入 localVars
//   4. 端到端:P1 进入濒死 → P2(仁心,持装备) confirm → 弃装备+翻面+P1 回1体力
//   5. 端到端:confirm=false → 不发动,P1 继续濒死求桃(P2 不弃牌不翻面)
//   6. 端到端:P2 无装备牌 → 不询问仁心(P2 视角无 pending)
//   7. 端到端:P2 装备区的装备牌可被弃(非仅手牌中的装备牌)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {} as Record<string, never>,
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  subtype?: string,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, subtype };
}

/** 直接向 state 注入一个 fake 请求回应 pending(单元测试 validate/execute 用)。 */
function injectPending(state: GameState, idx: number, requestType: string, prompt: unknown): void {
  state.pendingSlots.set(idx, {
    atom: {
      type: '请求回应',
      requestType,
      target: idx,
      prompt: prompt as never,
    },
    definition: undefined as never,
    startTime: 0,
    deadline: 100000,
    createdSeq: 0,
    isBlocking: true,
    resolve: () => {},
    isTimeout: false,
    isPaused: false,
    pause() {},
    _fireTimeoutNow: undefined,
  });
}

describe('界仁心', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界仁心'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界仁心',
      actionType: 'respond',
      params: { choice: true },
    });
  });

  it('respond:SELECT 下选非装备牌 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['a', 'w1'],
          skills: ['界仁心'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {
        a: makeCard('a', '杀', '♠', '7'),
        w1: makeCard('w1', '丈八蛇矛', '♥', 'A', '装备牌', '武器'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '仁心/selectCard', {
      type: 'pickProcessingCard',
      title: '选装备',
      cards: [
        { cardId: 'w1', cardName: '丈八蛇矛', suit: '♥', rank: 'A' },
      ],
    });

    // 选了非装备牌 'a' → 拒绝
    await P1.expectRejected({
      skillId: '界仁心',
      actionType: 'respond',
      params: { cardId: 'a' },
    });
  });

  // ─── respond execute ─────────────────────────

  it('respond:CONFIRM 下 choice=true 写入 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界仁心'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '仁心/confirm', { type: 'confirm', title: '是否发动?' });

    await P1.expectAccepted({
      skillId: '界仁心',
      actionType: 'respond',
      params: { choice: true },
    });
    await harness.waitForStable();
    expect(state.localVars['仁心/confirmed']).toBe(true);
  });

  // ─── 端到端 ─────────────────────────────────

  /**
   * 构造 P0 杀 P1(1血) → P1 进入濒死 → P2(界仁心) 是否发动 的标准场景。
   * 返回 setup 完成的 harness 与 P0/P1/P2 句柄。
   */
  async function setupDyingScenario(opts: {
    p2Hand?: string[];
    p2Equipment?: Record<string, string>;
  }): Promise<{
    harness: SkillTestHarness;
    P0: ReturnType<SkillTestHarness['player']>;
    P1: ReturnType<SkillTestHarness['player']>;
    P2: ReturnType<SkillTestHarness['player']>;
  }> {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 1,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: opts.p2Hand ?? [],
          equipment: opts.p2Equipment ?? {},
          skills: ['界仁心'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        k1: slash,
        w1: makeCard('w1', '丈八蛇矛', '♥', 'A', '装备牌', '武器'),
        w2: makeCard('w2', '青釭剑', '♠', '6', '装备牌', '武器'),
        a: makeCard('a', '杀', '♠', '7'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // P1 不闪 → 进入濒死(1→0 血)

    return { harness, P0, P1, P2 };
  }

  it('端到端:P1 濒死 → P2 confirm → 弃手牌装备+翻面+P1 回1体力', async () => {
    const { harness, P2 } = await setupDyingScenario({
      p2Hand: ['w1'], // 装备牌在手牌
    });

    // P2 收到仁心 confirm 询问
    P2.expectPending('请求回应');
    const cslot = [...harness.state.pendingSlots.values()][0];
    const cAtom = cslot.atom as { requestType?: string; target?: number };
    expect(cAtom.requestType).toBe('仁心/confirm');
    expect(cAtom.target).toBe(2);

    // P2 确认发动
    await P2.respond('界仁心', { choice: true });

    // 唯一装备候选(w1)→ 直接弃置,无 selectCard 询问
    // P2 弃了 w1;翻面(加 tag);P1 回 1 体力
    expect(harness.state.players[2].hand).not.toContain('w1');
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[2].tags).toContain('仁心/翻面');
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[1].alive).toBe(true);
  });

  it('端到端:P2 confirm=false → 不发动,P1 继续濒死求桃', async () => {
    const { harness, P2 } = await setupDyingScenario({
      p2Hand: ['w1'],
    });

    // P2 选择不发动
    P2.expectPending('请求回应');
    await P2.respond('界仁心', { choice: false });

    // P2 未弃牌、未翻面
    expect(harness.state.players[2].hand).toContain('w1');
    expect(harness.state.players[2].tags).not.toContain('仁心/翻面');
    // P1 仍在濒死(求桃窗口出现)
    expect(harness.state.players[1].health).toBeLessThanOrEqual(0);
    // runDyingFlow 继续求桃,产生「桃/求桃」pending(指向某存活玩家)
    const slots = [...harness.state.pendingSlots.values()];
    expect(slots.length).toBeGreaterThan(0);
    const reqTypes = slots.map((s) => (s.atom as { requestType?: string }).requestType);
    expect(reqTypes).toContain('桃/求桃');
  });

  it('端到端:P2 无装备牌 → 不询问仁心(直接进入求桃)', async () => {
    const { harness, P2 } = await setupDyingScenario({
      p2Hand: ['a'], // 仅基本牌,无装备牌
    });

    // P2 不应收到仁心 confirm;系统进入求桃流程
    // 求桃 pending 必然出现(可能针对 P0/P1/P2 任一存活玩家,但不会是 仁心/confirm)
    const slots = [...harness.state.pendingSlots.values()];
    expect(slots.length).toBeGreaterThan(0);
    const reqTypes = slots.map((s) => (s.atom as { requestType?: string }).requestType);
    expect(reqTypes).not.toContain('仁心/confirm');
    expect(reqTypes).toContain('桃/求桃');

    // P2 未弃牌、未翻面
    expect(harness.state.players[2].hand).toContain('a');
    expect(harness.state.players[2].tags).not.toContain('仁心/翻面');
  });

  it('端到端:P2 装备区的装备牌可被弃', async () => {
    const { harness, P2 } = await setupDyingScenario({
      p2Equipment: { 武器: 'w1' }, // 装备在装备区
    });

    // P2 收到 confirm
    P2.expectPending('请求回应');
    await P2.respond('界仁心', { choice: true });

    // 唯一候选(装备区 w1)→ 直接弃置
    expect(harness.state.players[2].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[2].tags).toContain('仁心/翻面');
    expect(harness.state.players[1].health).toBe(1);
  });

  it('端到端:多个装备候选 → 询问选牌', async () => {
    const { harness, P2 } = await setupDyingScenario({
      p2Hand: ['w2'], // 手牌有装备
      p2Equipment: { 武器: 'w1' }, // 装备区也有
    });

    // P2 confirm
    P2.expectPending('请求回应');
    await P2.respond('界仁心', { choice: true });

    // 有 2 个候选 → 询问选牌
    P2.expectPending('请求回应');
    const sslot = [...harness.state.pendingSlots.values()][0];
    const sAtom = sslot.atom as {
      requestType?: string;
      prompt?: { cards?: Array<{ cardId: string }> };
    };
    expect(sAtom.requestType).toBe('仁心/selectCard');
    expect(sAtom.prompt?.cards?.map((c) => c.cardId)).toEqual(
      expect.arrayContaining(['w1', 'w2']),
    );

    // P2 选 w1
    await P2.respond('界仁心', { cardId: 'w1' });

    // w1 被弃,w2 留手牌;翻面;P1 回 1
    expect(harness.state.players[2].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[2].hand).toContain('w2');
    expect(harness.state.players[2].tags).toContain('仁心/翻面');
    expect(harness.state.players[1].health).toBe(1);
  });
});
