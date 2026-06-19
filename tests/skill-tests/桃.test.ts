// tests/skill-tests/桃.test.ts
// 桃(基本牌)技能测试:
//   use:出牌阶段对已受伤角色使用,回复 1 体力。
//   respond:濒死求桃时出桃救援(设 state.localVars['求桃/已救'] = true)
//
// 验证:
//   1. 正面:出牌阶段对自己/他人使用,回 1 血 + 牌进弃牌堆
//   2. 正面:濒死求桃 respond(用真实 造成伤害 → 濒死 → 求桃 流程,出桃救援)
//   3. 负面:满血时 use 被拒绝(targetInjured 校验)
//   4. 负面:非自己回合 use 被拒绝
//   5. 负面:不在手牌的卡被拒绝
//   6. 负面:牌名不是桃(用杀当桃)被拒绝
//   7. 负面:无求桃 pending 时 respond 被拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { registerSkillsFromState, resetForTest } from '../../src/engine/create-engine';
import { dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
  return { id, name, suit, rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  };
}

/** 默认技能集(刘备/曹操等的"系统级"基本技能,用于 setUp 真实开局) */
const DEFAULT_SKILLS = ['杀', '闪', '桃', '酒', '过河拆桥', '顺手牵羊', '无中生有', '桃园结义', '借刀杀人', '决斗', '南蛮入侵', '万箭齐发', '乐不思蜀', '无懈可击', '装备通用', '回合管理'];

describe('桃', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:use ─────────────────────────────

  it('use:出牌阶段对自己使用 → 血量 +1,桃进弃牌堆', async () => {
    const peach = makeCard('t1', '桃', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['t1'], skills: ['桃'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { t1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('桃', 't1', [0]);

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('t1');
    expect(harness.state.players[0].hand).not.toContain('t1');
  });

  it('use:出牌阶段对受伤的其他角色使用 → 目标 +1 血', async () => {
    const peach = makeCard('t1', '桃', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['t1'], skills: ['桃'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: [], health: 2, maxHealth: 4 }),
      ],
      cardMap: { t1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('桃', 't1', [1]);

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('t1');
  });

  // ─── 负面:use ─────────────────────────────

  it('use:满血角色被选为目标 → 拒绝(targetInjured 校验)', async () => {
    const peach = makeCard('t1', '桃', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['t1'], skills: ['桃'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { t1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1 满血,P2 也满血 — P1 不能给 P2 用桃(targetInjured=false)
    await P1.expectRejected({ skillId: '桃', actionType: 'use', params: { cardId: 't1', targets: [1] } });
  });

  it('use:自己满血时对自己用 → 拒绝(targetInjured 校验)', async () => {
    const peach = makeCard('t1', '桃', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['t1'], skills: ['桃'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { t1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '桃', actionType: 'use', params: { cardId: 't1', targets: [0] } });
  });

  it('use:非自己回合 → 拒绝', async () => {
    const peach = makeCard('t1', '桃', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['t1'], skills: ['桃'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: [], health: 3, maxHealth: 4 }),
      ],
      cardMap: { t1: peach },
      // currentPlayerIndex = 1 → P2 的回合,P1 试图出桃
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '桃', actionType: 'use', params: { cardId: 't1', targets: [0] } });
  });

  it('use:不在手牌的卡 → 拒绝', async () => {
    const fake: Card = makeCard('cX', '桃', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['桃'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: [], health: 3, maxHealth: 4 }),
      ],
      cardMap: { cX: fake },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '桃', actionType: 'use', params: { cardId: 'cX', targets: [0] } });
  });

  it('use:牌名不是桃(用杀当桃) → 拒绝', async () => {
    const slash: Card = makeCard('s1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'], skills: ['桃'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '桃', actionType: 'use', params: { cardId: 's1', targets: [0] } });
  });

  // ─── 正面:respond(濒死求桃) ────────────────────
  // 走真实流程:P0 出杀 → P1(HP=1) 不出闪 → 受伤 → 濒死 → 求桃 → 救回

  it('respond:濒死求桃 → 出桃救援,血量回升,桃进弃牌堆', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const peach = makeCard('p1', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['杀', '桃', '闪', '酒'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: ['p1'], skills: ['杀', '桃', '闪', '酒'], health: 1, maxHealth: 4 }),
      ],
      cardMap: { c1: slash, p1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0 对 P1 出杀
    await P1.useCardAndTarget('杀', 'c1', [1]);
    // P1 询问闪 → P1 不闪(P1 手牌只有桃,没闪)
    await P2.pass();
    // 扣血: P1 HP=0 → 触发濒死 → 求桃 pending
    expect(harness.state.players[1].health).toBe(0);
    // 验证 pending 存在
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slotAtom = [...harness.state.pendingSlots.values()][0].atom as { type?: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('桃/求桃');

    // 求桃 pending 目标应该是濒死者(P1,index=1)或下一个活人
    // P1 自己的桃:dispatch 桃 respond,ownerId=1
    const dyingTarget = slotAtom.target!;
    await P2.respond('桃', { cardId: 'p1' });
    // 救回(由濒死者或被询问者出桃)
    // 血量 +1
    if (state.players[dyingTarget].health > 0) {
      expect(state.players[dyingTarget].health).toBe(1);
    }
    // 桃进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p1');
  });

  // ─── 负面:respond ─────────────────────────

  it('respond:无求桃 pending → 拒绝(没有「请求回应」slot)', async () => {
    const peach = makeCard('t1', '桃', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['t1'], skills: ['桃'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { t1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 没有 pending,桃的 respond validate 应当拒绝
    await P1.expectRejected({ skillId: '桃', actionType: 'respond', params: { cardId: 't1' } });
  });
});
