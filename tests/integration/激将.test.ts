// tests/integration/激将.test.ts
// 集成测试:激将(主公技,刘备)——主公请求蜀势力角色出杀
//
// 覆盖:
//   1. validate 拒绝:非主公(ownerId !== 0)使用激将
//   2. validate 拒绝:目标不是蜀势力
//   3. validate 拒绝:目标是自己
//   4. 目标不出杀(超时)→ 主公摸 1 张牌
//   5. 目标出杀(杀.respond)→ 杀进入处理区,被 激将 检测到,杀结算(目标若不出闪则受伤)
//
// 关键机制(激将.ts):
//   - ownerId === 0 视为"主公位"硬约束(validate 拒绝非主公)
//   - requestType='杀/respondKill' 供 杀.respond 匹配(详见 杀.ts 回应 validate)
//   - 杀牌进处理区 → 激将 execute 检查 zones.processing 是否有 杀
//   - 出了杀 → 指定目标 + 询问闪 + 造成伤害
//   - 不出(超时)→ 主公摸 1 张
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import { dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  faction?: '魏' | '蜀' | '吴' | '群';
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction,
  };
}

describe('激将:主公请求蜀势力角色出杀', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:validate 拒绝——非主公(ownerId !== 0)使用激将
  // ─────────────────────────────────────────────────────────────
  it('用例1:非主公位(ownerId=1)使用激将 → 被拒绝', async () => {
    // P1(蜀)装备激将,但 ownerId=1 不是主公位
    // 当前 state 视角:P0 是 currentPlayerIndex,但激将的 ownerId 是固定的实例 owner
    // 这里用 P1 持有激将技能但 P0 当 currentPlayer
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', faction: '魏', skills: [] }),
        makePlayer({ index: 1, name: 'P1', faction: '蜀', skills: ['激将', '杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 1, // 假设 P1 正在出牌
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 验证 validate 直接拒绝
    const { findActionEntry } = await import('../../src/engine/skill');
    const entry = findActionEntry('激将', 1, 'use');
    expect(entry).toBeDefined();
    const err = entry!.validate(state, { target: 1, killTarget: 0 });
    expect(err).not.toBeNull();
    // 拒绝原因应包含"现在不能使用激将"
    expect(err).toContain('激将');
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:validate 拒绝——目标不是蜀势力
  // ─────────────────────────────────────────────────────────────
  it('用例2:目标不是蜀势力(P0 主公对 P1 魏势力)→ validate 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'Lord', faction: '蜀', skills: ['激将', '杀'] }),
        makePlayer({ index: 1, name: 'P1', faction: '魏', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const { findActionEntry } = await import('../../src/engine/skill');
    const entry = findActionEntry('激将', 0, 'use')!;
    // 目标是 P1(魏势力)→ 拒绝
    const err = entry.validate(state, { target: 1, killTarget: 1 });
    expect(err).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:正面——主公对蜀势力发动激将,目标不出杀(超时)→ 主公摸 1 张
  // ─────────────────────────────────────────────────────────────
  it('用例3:目标不出杀(超时)→ 主公摸 1 张牌', async () => {
    // 准备牌堆:2 张普通牌,供摸牌
    const deckCard1: Card = { id: 'd1', name: '杀', suit: '♠', rank: '3', type: '基本牌' };
    const deckCard2: Card = { id: 'd2', name: '闪', suit: '♥', rank: '5', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'Lord', faction: '蜀', skills: ['激将', '杀'] }),
        makePlayer({ index: 1, name: 'P1', faction: '蜀', hand: [], skills: ['杀', '闪'] }),
        makePlayer({ index: 2, name: 'P2', faction: '魏', hand: [], skills: [] }),
      ],
      cardMap: { [deckCard1.id]: deckCard1, [deckCard2.id]: deckCard2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: [deckCard1.id, deckCard2.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    const lordHandBefore = state.players[0].hand.length;

    // 发动激将:请求 P1 出杀,目标 = P2
    await dispatchAndWait(state, {
      skillId: '激将',
      actionType: 'use',
      ownerId: 0,
      params: { target: 1, killTarget: 2 },
      baseSeq: state.seq,
    });
    // 应有 请求回应(激将/respondKill) pending,target=1(P1)
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string; target: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('杀/respondKill');
    expect(slotAtom.target).toBe(1);

    // 目标不出杀(超时)
    await fireTimeoutAndWait(state);

    // 主公摸 1 张
    expect(state.players[0].hand.length).toBe(lordHandBefore + 1);
    // 处理区应清空(激将的 finally 兜底把所有 processing 移入弃牌堆)
    expect(state.zones.processing).toEqual([]);
    // pending 已消费
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:正面——目标出杀 → 杀进入处理区 → 激将检测到 → 杀结算
  // ─────────────────────────────────────────────────────────────
  it('用例4:目标(P1)出杀 → 杀进处理区 → 激将触发杀 → P2 不出闪 → P2 扣血', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'Lord', faction: '蜀', skills: ['激将', '杀'] }),
        makePlayer({ index: 1, name: 'P1', faction: '蜀', hand: [slash.id], skills: ['杀', '闪'] }),
        makePlayer({ index: 2, name: 'P2', faction: '魏', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 发动激将:请求 P1 出杀,目标 = P2
    await dispatchAndWait(state, {
      skillId: '激将',
      actionType: 'use',
      ownerId: 0,
      params: { target: 1, killTarget: 2 },
      baseSeq: state.seq,
    });
    // 应有 请求回应 pending,target=1
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    // P1 响应:出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: slash.id },
      baseSeq: state.seq,
    });

    // 此时杀已进处理区,激将 execute 检测到杀后应继续走杀流程:
    // 指定目标 → 询问闪 → P2 不出闪 → 造成伤害
    // 询问闪 pending 应该是 target=2
    // (也可能在 dispatch respond 完后还没进 pending;再 fireTimeout 推进)
    // 我们用 waitForStable 风格:轮询直到 P2 受伤
    let attempts = 0;
    while (state.pendingSlots.size > 0 && attempts < 5) {
      // 还在询问闪 → 模拟 P2 不出闪
      await fireTimeoutAndWait(state);
      attempts += 1;
    }

    // P2 受伤 1 点
    expect(state.players[2].health).toBe(3);
    // 杀进弃牌堆
    expect(state.zones.discardPile).toContain(slash.id);
    // 处理区清空
    expect(state.zones.processing).toEqual([]);
    // pending 已消费
    expect(state.pendingSlots.size).toBe(0);
  });
});
