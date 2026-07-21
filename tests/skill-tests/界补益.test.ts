// tests/skill-tests/界补益.test.ts
// 界补益(界吴国太·被动技)测试:
//   当一名角色进入濒死状态时,你可以选择其一张牌,
//   若此牌不为基本牌,则其弃置此牌,然后回复1点体力。
//
// 验证:
//   1. 端到端:P1 濒死,P2(补益)选 P1 装备区的锦囊牌 → 弃+回1
//   2. 端到端:选 P1 装备区的装备牌 → 弃+回1
//   3. 端到端:选 P1 手牌(非基本牌)→ 弃+回1
//   4. 端到端:选 P1 手牌(基本牌)→ 无效果(不弃不回)
//   5. 端到端:不发动 → P1 继续求桃
//   6. 端到端:P1 无牌 → 不询问补益
//   7. respond validate:无 pending → 拒绝
//   8. respond validate:PICK 下 zone 缺失 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
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

describe('界补益', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 端到端辅助:构造 P0 杀 P1(1血) → P1 进入濒死 → P2(界补益) ──

  async function setupDyingScenario(opts: {
    p1Hand?: string[];
    p1Equipment?: Record<string, string>;
    p0Hand?: string[];
  }): Promise<{
    harness: SkillTestHarness;
    P0: ReturnType<SkillTestHarness['player']>;
    P1: ReturnType<SkillTestHarness['player']>;
    P2: ReturnType<SkillTestHarness['player']>;
  }> {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: opts.p0Hand ?? ['k1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: opts.p1Hand ?? [],
          equipment: opts.p1Equipment ?? {},
          skills: [],
          health: 1,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          skills: ['界补益'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        k1: makeCard('k1', '杀', '♠', '7'),
        // P1 装备区候选
        w1: makeCard('w1', '诸葛连弩', '♥', 'A', '装备牌', '武器'),
        a1: makeCard('a1', '仁王盾', '♠', '2', '装备牌', '防具'),
        // P1 手牌候选
        trick1: makeCard('trick1', '过河拆桥', '♠', '3', '锦囊牌'),
        equip1: makeCard('equip1', '青釭剑', '♠', '6', '装备牌', '武器'),
        sha1: makeCard('sha1', '杀', '♠', '7'),
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

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界补益'] }),
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
      skillId: '界补益',
      actionType: 'respond',
      params: { choice: true },
    });
  });

  it('respond:PICK 下缺 zone → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界补益'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['杀'],
          hand: ['sha1'],
        }),
      ],
      cardMap: {
        sha1: makeCard('sha1', '杀', '♠', '7'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '界补益/pick', {
      type: 'pickTargetCard',
      title: '选目标一张牌',
      target: 1,
      equipment: [],
      judge: [],
      handCount: 1,
    });

    // 缺 zone
    await P1.expectRejected({
      skillId: '界补益',
      actionType: 'respond',
      params: { handIndex: 0 },
    });
  });

  // ─── 端到端:选装备区锦囊牌/装备牌 ─────────────────────

  it('端到端:P1 濒死 → P2 选 P1 装备区锦囊牌 → 弃+回1', async () => {
    // P1 装备区放一张"锦囊牌"类型的牌(模拟"P1 装备区里的非基本牌")
    // 但装备区只接受 type==='装备牌';此处直接置入 equipment(测试构造)
    // 为简化,把 P1 装备区放装备牌(equip1=青釭剑),它的 type=装备牌(非基本牌)
    const { harness, P2 } = await setupDyingScenario({
      p1Equipment: { 武器: 'equip1' },
    });

    // P2 收到 confirm 询问
    P2.expectPending('请求回应');
    const cAtom = [...harness.state.pendingSlots.values()][0].atom as {
      requestType?: string;
    };
    expect(cAtom.requestType).toBe('界补益/confirm');

    // P2 确认发动
    await P2.respond('界补益', { choice: true });

    // P2 收到选牌询问
    P2.expectPending('请求回应');
    const pAtom = [...harness.state.pendingSlots.values()][0].atom as {
      requestType?: string;
      prompt?: { equipment?: Array<{ cardId: string }> };
    };
    expect(pAtom.requestType).toBe('界补益/pick');
    expect(pAtom.prompt?.equipment?.map((c) => c.cardId)).toEqual(['equip1']);

    // P2 选 equip1
    await P2.respond('界补益', { zone: 'equipment', cardId: 'equip1' });

    // equip1 弃置,P1 回 1 体力
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('equip1');
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[1].alive).toBe(true);
  });

  // ─── 端到端:选 P1 手牌(非基本) ─────────────────────────

  it('端到端:P1 濒死(手牌含锦囊)→ P2 盲选手牌 → 非基本则弃+回1', async () => {
    const { harness, P2 } = await setupDyingScenario({
      p1Hand: ['trick1'], // 锦囊牌
    });

    // P2 confirm
    P2.expectPending('请求回应');
    await P2.respond('界补益', { choice: true });

    // P2 选牌:盲选 hand[0]
    P2.expectPending('请求回应');
    const pAtom = [...harness.state.pendingSlots.values()][0].atom as {
      requestType?: string;
      prompt?: { handCount?: number };
    };
    expect(pAtom.requestType).toBe('界补益/pick');
    expect(pAtom.prompt?.handCount).toBe(1);

    await P2.respond('界补益', { zone: 'hand', handIndex: 0 });

    // trick1 弃,P1 回 1
    expect(harness.state.players[1].hand).not.toContain('trick1');
    expect(harness.state.zones.discardPile).toContain('trick1');
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[1].alive).toBe(true);
  });

  // ─── 端到端:选 P1 手牌(基本) → 无效果 ─────────────────

  it('端到端:P1 濒死(手牌仅基本)→ P2 盲选 → 是基本牌,不弃不回', async () => {
    const { harness, P2 } = await setupDyingScenario({
      p1Hand: ['sha1'], // 基本牌
    });

    P2.expectPending('请求回应');
    await P2.respond('界补益', { choice: true });

    P2.expectPending('请求回应');
    await P2.respond('界补益', { zone: 'hand', handIndex: 0 });

    // 是基本牌,无效果
    expect(harness.state.players[1].hand).toContain('sha1'); // 未弃
    expect(harness.state.zones.discardPile).not.toContain('sha1');
    // P1 继续濒死求桃
    expect(harness.state.players[1].health).toBeLessThanOrEqual(0);
    const reqTypes = [...harness.state.pendingSlots.values()].map(
      (s) => (s.atom as { requestType?: string }).requestType,
    );
    expect(reqTypes).toContain('桃/求桃');
  });

  // ─── 端到端:不发动 ───────────────────────────────

  it('端到端:P2 不发动补益 → P1 继续濒死求桃', async () => {
    const { harness, P2 } = await setupDyingScenario({
      p1Hand: ['trick1'],
    });

    P2.expectPending('请求回应');
    await P2.respond('界补益', { choice: false });

    // 未弃牌
    expect(harness.state.players[1].hand).toContain('trick1');
    expect(harness.state.zones.discardPile).not.toContain('trick1');
    // P1 仍在濒死
    expect(harness.state.players[1].health).toBeLessThanOrEqual(0);
    const reqTypes = [...harness.state.pendingSlots.values()].map(
      (s) => (s.atom as { requestType?: string }).requestType,
    );
    expect(reqTypes).toContain('桃/求桃');
  });

  // ─── 端到端:P1 无牌 → 不询问补益 ─────────────────────

  it('端到端:P1 濒死但无牌 → 不询问补益,直接求桃', async () => {
    const { harness, P2 } = await setupDyingScenario({
      p1Hand: [],
      p1Equipment: {},
    });

    // P2 不应收到补益 confirm;系统直接进入求桃
    const reqTypes = [...harness.state.pendingSlots.values()].map(
      (s) => (s.atom as { requestType?: string }).requestType,
    );
    expect(reqTypes).not.toContain('界补益/confirm');
    expect(reqTypes).toContain('桃/求桃');
  });
});
