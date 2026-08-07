// 狂骨(魏延·被动可选技)测试:
//   官方:你对距离1以内的一名角色造成1点伤害后,你可以回复1点体力或摸一张牌。
//   距离1 → 造成伤害后询问 → 回复体力 / 摸牌 / 不发动
//   距离>1 → 不触发
//   非魏延造成伤害 → 不触发
//   满血 → 仍可发动(选摸牌有效,选回复体力被上限截断)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState, Json, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  vars?: Record<string, Json>;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '魏延',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('狂骨', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 距离1 → 造成伤害后发动 → 选回复体力 ─────────────────────────────
  it('对距离1的P2造成伤害 → 发动狂骨选回复体力 → 魏延回复1点', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2'); // P2 含闪:走 normal 询问闪
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['狂骨', '杀'], health: 3 }),
        makePlayer({ index: 1, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // P2 无闪 → pass → 受伤
    await P2.pass();

    // P2 扣血
    expect(harness.state.players[1].health).toBe(3);
    // 狂骨触发:询问是否发动
    P1.expectPending('请求回应');
    await P1.respond('狂骨', { choice: true }); // 发动
    // 二选一:选回复体力
    P1.expectPending('请求回应');
    await P1.respond('狂骨', { choice: true }); // 回复1点体力

    // 魏延从 3 回复到 4
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─── 距离1 → 造成伤害后发动 → 选摸一张牌 ─────────────────────────────
  it('对距离1的P2造成伤害 → 发动狂骨选摸牌 → 魏延摸1张(体力不变)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2'); // P2 含闪:走 normal 询问闪
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['狂骨', '杀'], health: 3 }),
        makePlayer({ index: 1, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    // 发动狂骨
    await P1.respond('狂骨', { choice: true });
    // 二选一:选摸一张牌
    P1.expectPending('请求回应');
    await P1.respond('狂骨', { choice: false }); // 摸一张牌

    // 体力不变(仍为 3),手牌 +1(杀已出,摸入 1 张)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 可选触发:不发动 → 无效果 ─────────────────────────────
  it('狂骨询问时选不发动 → 魏延不回复也不摸牌', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2'); // P2 含闪:走 normal 询问闪
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['狂骨', '杀'], health: 3 }),
        makePlayer({ index: 1, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    // 询问是否发动 → 选不发动
    P1.expectPending('请求回应');
    await P1.respond('狂骨', { choice: false }); // 不发动

    // 无效果:体力不变,手牌为空(杀已出)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand.length).toBe(0);
    // 不应再有狂骨二选一询问
    P1.expectNoPending();
  });

  // ─── 满血 → 仍可发动;选回复体力被上限截断(无溢出)──────────────────────
  it('魏延满血 → 发动选回复体力 → 体力不溢出(仍为4)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2'); // P2 含闪:走 normal 询问闪
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['狂骨', '杀'], health: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    // 满血仍询问(官方无体力条件)
    P1.expectPending('请求回应');
    await P1.respond('狂骨', { choice: true }); // 发动
    await P1.respond('狂骨', { choice: true }); // 回复体力(被上限截断)

    // 满血不溢出
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─── 满血 → 发动选摸牌 → 仍摸1张(官方无体力条件)──────────────────────
  it('魏延满血 → 发动选摸牌 → 摸1张', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2'); // P2 含闪:走 normal 询问闪
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['狂骨', '杀'], health: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    // 满血仍可发动并摸牌
    await P1.respond('狂骨', { choice: true }); // 发动
    await P1.respond('狂骨', { choice: false }); // 摸一张牌

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 距离>1 → 不触发(4人局,P0→P2 距离2)─────────────────────
  it('对距离2的P2造成伤害 → 狂骨不触发', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2'); // P2 含闪:走 normal 询问闪
    const state: GameState = createGameState({
      players: [
        // P0=魏延,出杀范围设为3以能打到 P2(环形距离2)
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['狂骨', '杀'],
          health: 3,
          vars: { '距离/出杀范围': 3 },
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'], health: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
        makePlayer({ index: 3, name: 'P3', skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    // P0 杀 P2(距离2 > 1)
    await P0.useCardAndTarget('杀', 'k1', [2]);
    await P2.pass();

    expect(harness.state.players[2].health).toBe(3);
    // 距离>1 → 狂骨不触发:无询问、无回复、无摸牌(仅 health 未变不足以证明不触发)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand.length).toBe(0);
    P0.expectNoPending();
  });

  // ─── 非魏延造成伤害 → 不触发(伤害来源 ≠ 狂骨拥有者)─────────
  it('他人(P0)造成伤害 → 魏延(P1)狂骨不触发', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p1shan = makeCard('sh1', '闪', '♥', '2'); // P1(魏延)含闪:走 normal 询问闪
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'], health: 4, character: '其他' }),
        makePlayer({ index: 1, name: 'P1', hand: ['sh1'], skills: ['狂骨', '闪'], health: 3 }),
      ],
      cardMap: { k1: kill, sh1: p1shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0(非狂骨拥有者)出杀打 P1(魏延)—— source=P0 ≠ 狂骨owner(P1)
    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // P1 不出闪 → 受伤

    // P1 受伤(3→2),但魏延不是伤害来源 → 狂骨不触发
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].hand.length).toBe(1); // 仅持原有闪,未摸牌
    P1.expectNoPending();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 界狂骨(界魏延·锁定技):对距离1以内的角色造成伤害时,回复1点体力或摸一张牌(二选一)。
//   与狂骨差异:锁定技 → 无"是否发动"询问,直接二选一。
//   bug 背景:requestType 原为 '狂骨/choose',前端 resolvePendingRespond 据其
//   前缀推导 skillId='狂骨',但实例注册 skillId='界狂骨' → dispatch 路由失败(点击无效)。
//   修复:requestType 改为 '界狂骨/choose';满血时 prompt.confirmDisabled=true 禁用回复体力。
// ════════════════════════════════════════════════════════════════════════
describe('界狂骨', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 模拟前端 resolvePendingRespond:从 pending requestType 按 [/_] 取前缀作 skillId。
  // 与 src/client/utils/pendingRespond.ts 的推导口径一致,验证路由契约。
  function deriveSkillIdFromPending(state: GameState): string | null {
    const slot = [...state.pendingSlots.values()][0];
    if (!slot) return null;
    const atom = slot.atom as { type?: string; requestType?: string };
    if (atom.type !== '请求回应' || !atom.requestType) return null;
    const sepIdx = atom.requestType.search(/[/_]/);
    return sepIdx >= 0 ? atom.requestType.slice(0, sepIdx) : atom.requestType;
  }

  /** 读取当前 pending 的 prompt(验证 confirmDisabled 等字段) */
  function pendingPrompt(): Record<string, unknown> | null {
    const slot = [...harness.state.pendingSlots.values()][0];
    if (!slot) return null;
    return (slot.atom as { prompt?: Record<string, unknown> }).prompt ?? null;
  }

  // ─── 不满血:二选一选回复体力 ─────────────────────────────
  it('对距离1造成伤害 → 二选一选回复体力 → 界魏延回复1点', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['界狂骨', '杀'],
          health: 3,
          character: '界魏延',
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    // 锁定技:直接二选一(无"是否发动"询问)
    P1.expectPending('请求回应');
    // 路由契约:前端按 requestType 推导出的 skillId 必须能路由到界狂骨实例
    const skillId = deriveSkillIdFromPending(harness.state);
    expect(skillId).toBe('界狂骨');
    await P1.respond(skillId!, { choice: true }); // 回复1点体力

    expect(harness.state.players[0].health).toBe(4);
  });

  // ─── 不满血:二选一选摸牌 ─────────────────────────────
  it('对距离1造成伤害 → 二选一选摸牌 → 界魏延摸1张(体力不变)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['界狂骨', '杀'],
          health: 3,
          character: '界魏延',
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    P1.expectPending('请求回应');
    await P1.respond('界狂骨', { choice: false }); // 摸一张牌

    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 满血:confirmDisabled=true,选摸牌 ─────────────────────────────
  it('满血造成伤害 → prompt.confirmDisabled=true → 选摸牌 → 摸1张', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['界狂骨', '杀'],
          health: 4,
          character: '界魏延',
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    P1.expectPending('请求回应');
    // 满血:回复体力按钮应禁用
    expect(pendingPrompt()?.confirmDisabled).toBe(true);
    // 选摸牌
    await P1.respond('界狂骨', { choice: false });

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 满血:选回复体力 → 体力不溢出(被上限截断)──────────────────────
  it('满血选回复体力 → 体力不溢出(仍为4)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const p2shan = makeCard('sh1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['界狂骨', '杀'],
          health: 4,
          character: '界魏延',
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['sh1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, sh1: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    P1.expectPending('请求回应');
    // 即使前端禁用按钮,引擎层仍接受 choice=true(防客户端绕过),仅被上限截断
    await P1.respond('界狂骨', { choice: true }); // 回复体力(被截断)

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].hand.length).toBe(0);
  });
});
