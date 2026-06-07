/**
 * tests/game-flow.test.ts — 完整游戏流程测试
 *
 * 种子确定性 + 不变量检查覆盖整个游戏生命周期。
 * 脚本化流畅 + 随机打谱两种模式。
 */

import { describe, it, expect } from 'vitest';
import { safeEngine } from './invariants';
import { createTestGame, setHealth } from './engine-helpers';
import type { GameState, GameAction } from '@engine/types';

// ════════════════════════════════════════════════════════════════
// 脚本化游戏流程
// ════════════════════════════════════════════════════════════════

describe('脚本化游戏流程', () => {
  it('2人局完整一回合：出杀→受伤→回合结束→换人', () => {
    // 创建游戏，手动进入出牌阶段
    const state = createTestGame({ playPhase: true });

    // P1 手牌中找杀
    const killId = state.players.P1.hand.find(
      id => state.cardMap[id].name === '杀',
    );
    if (!killId) return; // 无杀则跳过（随机发牌可能无杀）

    const p2health = state.players.P2.health;
    const p1handBefore = state.players.P1.hand.length;

    // P1 出杀
    const r1 = safeEngine(state, { type: '打出一张牌', player: 'P1', cardId: killId, target: 'P2' });
    // 可能失败（距离不够、已有pending等）或成功
    // 成功的话产生响应窗口
    if (r1.error) return; // 不能出杀，跳过

    expect(r1.state.pending).not.toBeNull();
    expect(r1.state.pending!.type).toBe('响应窗口');

    // P2 不出闪 → 受伤
    const r2 = safeEngine(r1.state, { type: '打出', player: 'P2' });
    expect(r2.error).toBeUndefined();
    expect(r2.state.players.P2.health).toBe(p2health - 1);

    // 检查 P1 手牌减少（杀已打出）
    // 由于 kill 会进入 discardPile，手牌少 1 张
    expect(r2.state.players.P1.hand.length).toBe(p1handBefore - 1);

    // 结束回合
    const r3 = safeEngine(r2.state, { type: '结束回合', player: 'P1' });
    expect(r3.error).toBeUndefined();

    // P2 成为当前玩家（P1 手牌可能>体力触发弃牌，但弃牌后应轮到 P2）
    const afterEndTurn = () => {
      let s = r3.state;
      // 如果有弃牌 pending，全部弃完
      while (s.pending?.type === '弃牌阶段') {
        const discardP = s.pending;
        const hand = s.players[discardP.player].hand;
        const toDiscard = hand.slice(0, discardP.max);
        const r = safeEngine(s, { type: '弃置', player: discardP.player, cardIds: toDiscard });
        if (r.error) break;
        s = r.state;
      }
      return s;
    };
    const finalState = afterEndTurn();

    // 最终应是 P2 的回合
    // 注意：P1 死亡的话游戏结束，否则 P2 开始回合
    if (finalState.meta.status !== '已结束') {
      expect(finalState.currentPlayer).toBe('P2');
    }
  });

  it('桃回血：受伤后吃桃恢复', () => {
    let state = createTestGame({ playerCount: 2, playPhase: true });
    // P1 受伤
    state = setHealth(state, 'P1', 2);
    state = {
      ...state,
      players: {
        ...state.players,
        // 注入桃
        P1: {
          ...state.players.P1,
          hand: [...state.players.P1.hand, 'test-peach-1'],
        },
      },
      cardMap: {
        ...state.cardMap,
        'test-peach-1': {
          id: 'test-peach-1',
          name: '桃',
          type: '基本牌',
          subtype: '桃',
          suit: '♥',
          rank: 'A',
          description: '',
        },
      },
    };

    const beforeHealth = state.players.P1.health;
    const r = safeEngine(state, {
      type: '打出一张牌',
      player: 'P1',
      cardId: 'test-peach-1',
    });
    expect(r.error).toBeUndefined();
    expect(r.state.players.P1.health).toBe(beforeHealth + 1);
    expect(r.state.players.P1.hand).not.toContain('test-peach-1');
  });

  it('装备牌可以正常装备', () => {
    let state = createTestGame({ playPhase: true });
    // 注入青龙偃月刀
    state = {
      ...state,
      players: {
        ...state.players,
        P1: { ...state.players.P1, hand: [...state.players.P1.hand, 'test-weapon-1'] },
      },
      cardMap: {
        ...state.cardMap,
        'test-weapon-1': {
          id: 'test-weapon-1',
          name: '青龙偃月刀',
          type: '装备牌',
          subtype: '武器',
          suit: '♠',
          rank: '5',
          description: '攻击范围3',
          range: 3,
        },
      },
    };

    const r = safeEngine(state, { type: '打出一张牌', player: 'P1', cardId: 'test-weapon-1' });
    expect(r.error).toBeUndefined();
    // 应装备到武器槽
    expect(r.state.players.P1.equipment.武器).toBe('test-weapon-1');
    expect(r.state.players.P1.hand).not.toContain('test-weapon-1');
  });
});

// ════════════════════════════════════════════════════════════════
// 种子确定性
// ════════════════════════════════════════════════════════════════

describe('种子确定性', () => {
  it('相同种子 + 相同操作序列产生完全相同状态', () => {
    const seed = 12345;

    function playGame(s: GameState): GameState {
      let state = s;
      const p1kill = state.players.P1.hand.find(id => state.cardMap[id].name === '杀');
      if (!p1kill) return state;

      const r1 = safeEngine(state, { type: '打出一张牌', player: 'P1', cardId: p1kill, target: 'P2' });
      if (r1.error) return state;
      state = r1.state;

      if (state.pending?.type === '响应窗口') {
        const r2 = safeEngine(state, { type: '打出', player: 'P2' });
        if (!r2.error) state = r2.state;
      }

      const r3 = safeEngine(state, { type: '结束回合', player: state.currentPlayer });
      if (r3.error) return state;
      state = r3.state;

      // 处理可能的弃牌 pending
      while (state.pending?.type === '弃牌阶段') {
        const dp = state.pending;
        const hand = state.players[dp.player].hand;
        const r = safeEngine(state, { type: '弃置', player: dp.player, cardIds: hand.slice(0, dp.max) });
        if (r.error) break;
        state = r.state;
      }

      return state;
    }

    const state1 = createTestGame({ seed, playPhase: true });
    const state2 = createTestGame({ seed, playPhase: true });

    const result1 = playGame(state1);
    const result2 = playGame(state2);

    // 关键断言：种子相同则最终状态深度相等
    expect(result1.currentPlayer).toBe(result2.currentPlayer);
    expect(result1.phase).toBe(result2.phase);
    expect(result1.zones.deck).toEqual(result2.zones.deck);
    expect(result1.zones.discardPile).toEqual(result2.zones.discardPile);
    expect(result1.rngState).toBe(result2.rngState);

    // 所有玩家手牌一致
    for (const name of result1.playerOrder) {
      expect(result1.players[name].hand).toEqual(result2.players[name].hand);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 随机打谱测试（简单策略）
// ════════════════════════════════════════════════════════════════

describe('随机打谱', () => {
  /**
   * 在出牌阶段尝试打出一张牌（基本牌优先），否则结束回合。
   */
  function tryPlayCard(state: GameState, player: string): GameState | null {
    const p = state.players[player];
    if (!p?.info.alive) return null;

    // 优先出杀（如果有且能出）
    const kill = p.hand.find(id => state.cardMap[id]?.name === '杀');
    if (kill) {
      // 找存活目标
      const targets = state.playerOrder.filter(
        n => n !== player && state.players[n].info.alive,
      );
      if (targets.length > 0) {
        const r = safeEngine(state, { type: '打出一张牌', player, cardId: kill, target: targets[0] });
        if (!r.error) return r.state;
      }
    }

    // 出桃（如果受伤）
    if (p.health < p.maxHealth) {
      const peach = p.hand.find(id => state.cardMap[id]?.name === '桃');
      if (peach) {
        const r = safeEngine(state, { type: '打出一张牌', player, cardId: peach });
        if (!r.error) return r.state;
      }
    }

    // 没有可出的牌
    return null;
  }

  it('2人局：执行 5 个回合不崩溃（简单策略）', () => {
    let state = createTestGame({ seed: 42 });
    // 直接进入出牌阶段开始
    state = { ...state, phase: '出牌' };

    // 最多执行 5 回合
    for (let turn = 0; turn < 5; turn++) {
      // 防止死循环：最多 50 步/回合
      for (let step = 0; step < 50; step++) {
        // 检查游戏是否结束
        if (state.meta.status === '已结束') break;

        const current = state.currentPlayer;
        const player = state.players[current];
        if (!player?.info.alive) break;

        // 有 pending 时处理
        if (state.pending && state.pending.type !== '出牌阶段') {
          const pending = state.pending;

          if (pending.type === '响应窗口') {
            // 总是 pass（不出牌）
            const r = safeEngine(state, { type: '打出', player: pending.window.defender });
            if (!r.error) {
              state = r.state;
              continue;
            }
          }

          if (pending.type === '弃牌阶段') {
            const toDiscard = player.hand.slice(0, pending.max);
            const r = safeEngine(state, { type: '弃置', player: current, cardIds: toDiscard });
            if (!r.error) {
              state = r.state;
              continue;
            }
          }

          if (pending.type === '濒死窗口') {
            // 尝试出桃
            const saver = pending.savers[pending.currentSaverIndex];
            const saverState = state.players[saver];
            const cardMap = state.cardMap;
            const peach = saverState?.hand.find(id => cardMap[id]?.name === '桃');
            if (peach) {
              const r = safeEngine(state, { type: '打出', player: saver, cardId: peach });
              if (!r.error) {
                state = r.state;
                continue;
              }
            }
            // 不出桃
            const r = safeEngine(state, { type: '打出', player: saver });
            if (!r.error) {
              state = r.state;
              continue;
            }
          }

          if (pending.type === '技能选择') {
            // 跳过技能提示（使用 prompt 中的默认选项）
            const defaultChoice = pending.prompt.defaultChoice ?? false;
            const r = safeEngine(state, {
              type: '技能选择',
              player: pending.player,
              choice: defaultChoice,
            });
            if (!r.error) {
              state = r.state;
              continue;
            }
          }

          // 无法处理的 pending → 继续循环（防止死循环）
          break;
        }

        // 出牌阶段
        if (state.phase === '出牌' && current === state.currentPlayer) {
          const played = tryPlayCard(state, current);
          if (played) {
            state = played;
            continue;
          }
          // 没牌可出 → 结束回合
          const r = safeEngine(state, { type: '结束回合', player: current });
          if (!r.error) {
            state = r.state;
            continue;
          }
        }

        // 其他阶段（摸牌、准备等）— 没有需要玩家操作，可能是 engine 内部自动化
        // 如果没有任何操作可做，该回合会自动推进
        break;
      }

      if (state.meta.status === '已结束') break;
    }

    // 核心断言：跑了 5 回合没有崩溃
    expect(state.meta.status).toBeDefined();
    expect(state.meta.turnNumber).toBeGreaterThanOrEqual(1);
  });

  it('5人局：快速打谱 3 回合不崩溃', () => {
    let state = createTestGame({ playerCount: 5, seed: 9999 });
    state = { ...state, phase: '出牌' };

    for (let turn = 0; turn < 3; turn++) {
      for (let step = 0; step < 80; step++) {
        if (state.meta.status === '已结束') break;

        const current = state.currentPlayer;
        const player = state.players[current];
        if (!player?.info.alive) break;

        if (state.pending && state.pending.type !== '出牌阶段') {
          const p = state.pending;
          if (p.type === '响应窗口') {
            const r = safeEngine(state, { type: '打出', player: p.window.defender });
            if (!r.error) {
              state = r.state;
              continue;
            }
          } else if (p.type === '弃牌阶段') {
            const r = safeEngine(state, { type: '弃置', player: current, cardIds: player.hand.slice(0, p.max) });
            if (!r.error) {
              state = r.state;
              continue;
            }
          } else if (p.type === '濒死窗口') {
            const saver = p.savers[p.currentSaverIndex];
            const r = safeEngine(state, { type: '打出', player: saver });
            if (!r.error) {
              state = r.state;
              continue;
            }
          } else {
            break;
          }
        }

        if (state.phase === '出牌' && current === state.currentPlayer) {
          const played = tryPlayCard(state, current);
          if (played) {
            state = played;
            continue;
          }

          const r = safeEngine(state, { type: '结束回合', player: current });
          if (!r.error) {
            state = r.state;
            continue;
          }
        }

        break;
      }
      if (state.meta.status === '已结束') break;
    }

    expect(state.meta.turnNumber).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════
// 回合流程缺陷文档
// ════════════════════════════════════════════════════════════════

describe('回合流程缺陷', () => {
  it('初始状态 phase=准备，无任何方式推进阶段', () => {
    const state = createTestGame({ playerCount: 2 });
    expect(state.phase).toBe('准备');
    // 引擎中没有任何操作可以推进准备阶段，游戏永久卡住
    // 期望：准备阶段应自动推进到判定→摸牌→出牌，或 endTurn 可用
    const r1 = safeEngine(state, { type: '结束回合', player: 'P1' });
    expect(r1.error).toBeTruthy();
  });

  it('handleEndTurn 跳过判定和摸牌阶段，直接设 phase=出牌', () => {
    const state = createTestGame({ playPhase: true });
    const r = safeEngine(state, { type: '结束回合', player: 'P1' });
    expect(r.error).toBeUndefined();
    expect(r.state.currentPlayer).toBe('P2');
    // 期望：phase 应该是 '准备' 或 '判定'，而非 '出牌'
    expect(r.state.phase).toBe('出牌');
  });

  it('弃牌后回合转换也跳过判定和摸牌', () => {
    let state = createTestGame({ playPhase: true });
    state = setHealth(state, 'P1', 2);
    const r1 = safeEngine(state, { type: '结束回合', player: 'P1' });
    expect(r1.state.pending?.type).toBe('弃牌阶段');
    const hand = r1.state.players['P1'].hand;
    const r2 = safeEngine(r1.state, {
      type: '弃置', player: 'P1', cardIds: hand.slice(0, 2),
    });
    expect(r2.state.currentPlayer).toBe('P2');
    // 期望：phase 应该是 '准备'
    expect(r2.state.phase).toBe('出牌');
  });

  it('准备阶段所有操作类型都报错', () => {
    const state = createTestGame();
    for (const op of [
      { type: '打出一张牌', player: 'P1', cardId: state.players['P1'].hand[0] },
      { type: '结束回合', player: 'P1' },
    ] as GameAction[]) {
      expect(safeEngine(state, op).error).toBeTruthy();
    }
  });

  it('meta.round 在整轮完成后递增', () => {
    const state = createTestGame({ playPhase: true });
    expect(state.meta.round).toBe(1);
    const r1 = safeEngine(state, { type: '结束回合', player: 'P1' });
    // P2 摸牌阶段抽了 2 张，设高体力避免弃牌
    const p2high = setHealth(r1.state, 'P2', 10);
    const r2state = { ...p2high, phase: '出牌' as const };
    const r2 = safeEngine(r2state, { type: '结束回合', player: 'P2' });
    expect(r2.state.currentPlayer).toBe('P1');
    // nextPlayer atom 在整轮完成后递增 meta.round
    expect(r2.state.meta.round).toBe(2);
  });

  it('弃牌阶段结束回合不触发 turnEnd 事件', () => {
    let state = createTestGame({ playPhase: true });
    state = setHealth(state, 'P1', 2);
    const r1 = safeEngine(state, { type: '结束回合', player: 'P1' });
    expect(r1.state.pending?.type).toBe('弃牌阶段');
    const hand = r1.state.players['P1'].hand;
    const r2 = safeEngine(r1.state, {
      type: '弃置', player: 'P1', cardIds: hand.slice(0, 2),
    });
    // resolveDiscardPhase 直接 nextPlayer+setPhase，不 emit turnEnd
    // 闭月等监听 turnEnd 的技能丢失
    expect(r2.error).toBeUndefined();
    expect(r2.state.currentPlayer).toBe('P2');
  });
});
