/**
 * tests/invariants.ts — 游戏状态不变量检查
 *
 * 每次 engine() 调用后自动检查关键不变量，防止状态损坏。
 * 用于 safeEngine 包装器，套到所有现用测试上。
 */

import { expect } from 'vitest';
import { engine } from '@engine/engine';
import type { GameState, GameAction, EngineResult } from '@engine/types';

/**
 * 收集所有可见卡牌 ID（牌堆、弃牌堆、手牌、装备区、判定区）。
 */
function collectVisibleCardIds(state: GameState): Set<string> {
  const ids = new Set<string>();

  for (const id of state.zones.deck) ids.add(id);
  for (const id of state.zones.discardPile) ids.add(id);

  for (const name of state.playerOrder) {
    const p = state.players[name];
    for (const id of p.hand) ids.add(id);

    // 装备区
    for (const slot of Object.values(p.equipment)) {
      if (slot) ids.add(slot);
    }

    // 判定区 / pendingTricks
    if (p.pendingTricks) {
      for (const pt of p.pendingTricks) {
        if (typeof pt === 'string') ids.add(pt);
        else if (pt && typeof pt === 'object' && 'cardId' in pt) ids.add((pt as { cardId: string }).cardId);
      }
    }
  }

  // pending 中的相关卡牌
  if (state.pending) {
    const pending = state.pending as unknown as Record<string, unknown>;
    if (pending.type === '响应窗口') {
      const window = pending.window as Record<string, unknown>;
      const sourceCard = window.sourceCard as string | undefined;
      if (sourceCard) ids.add(sourceCard);
    }
  }

  return ids;
}

/**
 * 检查游戏状态不变量。
 * 使用 vitest expect 断言，失败时抛出清晰错误。
 */
export function checkInvariants(state: GameState): void {
  // ─── 不变量 1: 所有可见卡牌都在 cardMap 中存在 ───
  const visibleIds = collectVisibleCardIds(state);
  const allCardIds = new Set(Object.keys(state.cardMap));

  for (const id of visibleIds) {
    expect(allCardIds.has(id)).toBe(true);
    if (!allCardIds.has(id)) {
      throw new Error(`不变量失败: 可见卡牌 ${id} 不在 cardMap 中`);
    }
  }

  // ─── 不变量 2: 无重复卡牌出现在多个位置 ───
  // 收集每张牌的出现次数
  const idCounts = new Map<string, number>();
  for (const id of state.zones.deck) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  for (const id of state.zones.discardPile) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  for (const name of state.playerOrder) {
    const p = state.players[name];
    for (const id of p.hand) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    for (const slot of Object.values(p.equipment)) {
      if (slot) idCounts.set(slot, (idCounts.get(slot) ?? 0) + 1);
    }
  }

  for (const [id, count] of idCounts) {
    if (count > 1) {
      // 确认是真实重复（测试注入的 test- 前缀卡牌可能因为多次 injectCard 导致重复）
      // 但非 test- 前缀牌不应重复
      if (!id.startsWith('test-')) {
        expect(count).toBeLessThanOrEqual(1);
      }
    }
  }

  // ─── 不变量 3: 当前玩家存活 ───
  if (state.players[state.currentPlayer]) {
    expect(state.players[state.currentPlayer].info.alive).toBe(true);
  }

  // ─── 不变量 4: 生存玩家 health > 0 —— 濒死窗口期间允许 health ≤ 0 ───
  const dyingPlayer = state.pending?.type === '濒死窗口'
    ? state.pending.dyingPlayer
    : undefined;
  for (const name of state.playerOrder) {
    const p = state.players[name];
    if (p.info.alive && name !== dyingPlayer) {
      expect(p.health).toBeGreaterThan(0);
    }
  }

  // ─── 不变量 5: 玩家手牌中的卡牌在 cardMap 中有定义 ───
  for (const name of state.playerOrder) {
    const p = state.players[name];
    for (const id of p.hand) {
      expect(state.cardMap[id]).toBeDefined();
    }
  }

  // ─── 不变量 6: 装备区卡牌存在 ───
  for (const name of state.playerOrder) {
    const p = state.players[name];
    for (const [_slot, id] of Object.entries(p.equipment)) {
      if (id) {
        expect(state.cardMap[id]).toBeDefined();
      }
    }
  }

  // ─── 不变量 7: rngState 是有效数字 ───
  expect(typeof state.rngState).toBe('number');
  expect(Number.isFinite(state.rngState)).toBe(true);

  // ─── 不变量 8: meta 中必填字段存在 ───
  expect(state.meta).toBeDefined();
  expect(state.meta.id).toBeDefined();
  expect(typeof state.meta.seed).toBe('number');
  expect(typeof state.meta.round).toBe('number');
  expect(typeof state.meta.turnNumber).toBe('number');
}

/**
 * 包装 engine() 调用，每次调用后检查不变量。
 * 可安全替代 engine() 用于测试。
 */
export function safeEngine(state: GameState, action: GameAction): EngineResult {
  const result = engine(state, action);
  if (!result.error) {
    checkInvariants(result.state);
  }
  return result;
}
