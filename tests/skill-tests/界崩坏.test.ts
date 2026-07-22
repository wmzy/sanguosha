// 界崩坏(界董卓·锁定技)测试(界限突破版):
// 核心差异(相对标崩坏 src/engine/skills/崩坏.ts):
//   - 描述完全相同;界版额外读取 turn.vars['崩坏/disabled'](由界酒池写入)。
//   - 当该 var 为 true 时,本回合跳过触发(贴合"酒杀造成伤害后崩坏失效"语义)。
//
// 用例:
//   1. 结束阶段触发:体力 > 全场最小 → 询问选择 → 减体力上限
//   2. 结束阶段触发:体力 > 全场最小 → 询问选择 → 减体力
//   3. 禁用场景:turn.vars['崩坏/disabled']=true → 跳过(不询问/不扣减)
//   4. 体力 == 全场最小 → 不触发
//   5. 非结束阶段(其他 phase)→ 不触发
//   6. 非自己结束阶段 → 不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { GameState, PlayerState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  health?: number;
  maxHealth?: number;
  skills?: string[];
  faction?: '魏' | '蜀' | '吴' | '群';
  identity?: '主公' | '忠臣' | '反贼' | '内奸';
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界董卓',
    health: opts.health ?? 8,
    maxHealth: opts.maxHealth ?? 8,
    alive: true,
    hand: [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction ?? '群',
    identity: opts.identity ?? '反贼',
  };
}

/** 触发 player 的结束阶段(applyAtom 阶段开始 phase='回合结束')。
 * 阶段开始 的 after-hook(界崩坏)会创建 pending 并 await,故用 void fire-and-forget。 */
async function triggerEndPhase(harness: SkillTestHarness, player: number): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '回合结束' });
  await harness.waitForStable();
}

describe('界崩坏', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 触发 → 减体力上限 ─────────────────────────────
  it('结束阶段:体力>最小 → confirm → 减 1 点体力上限', async () => {
    const state: GameState = createGameState({
      players: [
        // P0 界董卓,体力 8(全场最高)
        makePlayer({
          index: 0,
          name: 'P0',
          health: 8,
          maxHealth: 8,
          skills: ['界崩坏'],
        }),
        // P1 体力 4(全场最低)
        makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 触发结束阶段开始 atom
    await triggerEndPhase(harness, 0);

    // 询问崩坏选择
    P0.expectPending('请求回应');
    const slot = [...harness.state.pendingSlots.values()][0];
    const atom = slot.atom as { requestType?: string };
    expect(atom.requestType).toBe('崩坏/choose');

    // 选 confirm = 减体力上限
    await P0.respond('界崩坏', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(7); // 减 1 上限
    expect(harness.state.players[0].health).toBe(7); // 体力跟随上限钳制(8→7)
  });

  // ─── 2. 触发 → 减体力 ─────────────────────────────────
  it('结束阶段:体力>最小 → cancel → 减 1 点体力', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 8,
          maxHealth: 8,
          skills: ['界崩坏'],
        }),
        makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);

    P0.expectPending('请求回应');

    // pass = 减体力
    await P0.pass();
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(7); // 减 1 体力
    expect(harness.state.players[0].maxHealth).toBe(8); // 上限不变
  });

  // ─── 3. 禁用:turn.vars['崩坏/disabled']=true → 跳过 ───
  it('禁用标志为 true → 结束阶段不触发崩坏', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 8,
          maxHealth: 8,
          skills: ['界崩坏'],
        }),
        makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: { '崩坏/disabled': true } },
    });
    await harness.setup(state);

    await triggerEndPhase(harness, 0);

    // 无询问、无扣减
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(8);
    expect(harness.state.players[0].maxHealth).toBe(8);
  });

  // ─── 4. 体力 == 全场最小 → 不触发 ─────────────────────
  it('体力 == 全场最小 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 4,
          maxHealth: 8,
          skills: ['界崩坏'],
        }),
        makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);

    await triggerEndPhase(harness, 0);

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].maxHealth).toBe(8);
  });

  // ─── 5. 非结束阶段 → 不触发 ───────────────────────────
  it('非结束阶段(摸牌)→ 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 8,
          maxHealth: 8,
          skills: ['界崩坏'],
        }),
        makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);

    // 直接发阶段开始(摸牌)atom(不用 triggerEndPhase,后者发的是 回合结束)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(8);
  });

  // ─── 6. 非自己结束阶段 → 不触发 ───────────────────────
  it('他人结束阶段(player≠owner)→ 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 8,
          maxHealth: 8,
          skills: ['界崩坏'],
        }),
        makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 1, // P1 回合
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);

    // P1 的结束阶段(P0 是界崩坏 owner,但不是当前回合角色)
    // 用 void + waitForStable:阶段开始 after-hook 不触发(P1 不是 owner),应无 pending
    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '回合结束' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(8);
  });
});
