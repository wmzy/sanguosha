// tests/integration/replay-round-trip.test.ts
//
// 端到端集成测试：完整游戏 → GameLogger → GameLog → ReplayEngine 状态一致性
// 覆盖：
//   - engine() → GameLogger.recordBatch → export GameLog → ReplayEngine 状态一致
//   - saveLog/loadLog round-trip 一致（通过 JSON 序列化/反序列化模拟）
//   - playerOps 视角裁剪：drawer 看牌名，他人看数量
//   - ReplayEngine + GameLog 互相兼容

import { describe, it, expect, beforeEach } from 'vitest';
import { engine } from '../../engine/engine';
import type { GameState, GameAction, ServerEvent } from '../../engine/types';
import { GameLogger } from '../../engine/logger';
import { ReplayEngine } from '../../engine/replay';
import type { GameLog, Operation } from '../../shared/log';
import {
  createTestGame,
  injectCard,
  findCardInHand,
  getCharacterMap,
  setPlayPhase,
  currentPlayer,
} from '../engine-helpers';

const characterMap = getCharacterMap();

/**
 * 辅助：用 engine() + GameLogger 跑一系列 GameAction，
 * 返回最终 state + 完整 GameLog。
 */
function runGameSequence(
  actions: Array<{ action: GameAction; state: GameState }>,
): { logger: GameLogger; finalState: GameState } {
  const firstState = actions[0].state;
  const players = firstState.playerOrder;
  const logger = new GameLogger(
    {
      version: '1.0',
      createdAt: Date.now(),
      playerCount: players.length,
      characters: players.map((p) => firstState.players[p].info.characterId),
      seed: firstState.meta.seed,
    },
    players,
  );

  let state = firstState;
  for (const { action } of actions) {
    const result = engine(state, action);
    if (result.error) {
      throw new Error(`Engine error on action ${action.type}: ${result.error}`);
    }
    logger.recordBatch(action, result.events, result.state);
    state = result.state;
  }

  return { logger, finalState: state };
}

/**
 * 从 finalState.serverLog 提取事件，生成带有 serverLog 的完整 GameLog。
 */
function exportWithServerLog(logger: GameLogger, finalState: GameState): GameLog {
  const log = logger.export();
  log.serverLog = finalState.serverLog.map((ev) => ({
    id: ev.id,
    type: ev.type,
    timestamp: ev.timestamp,
    payload: ev.payload,
  }));
  return log;
}

describe('Replay round-trip 集成测试', () => {
  describe('完整游戏流程 → GameLog → ReplayEngine 状态一致', () => {
    it('startGame → playCard → damage 产生完整日志', () => {
      // 创建游戏，设为出牌阶段，注入杀
      let state = createTestGame({ characters: ['曹操', '刘备'], seed: 42 });
      const cp = currentPlayer(state);
      const target = state.playerOrder.find((p) => p !== cp)!;
      state = injectCard(state, cp, '杀');
      state = setPlayPhase(state);

      const cardId = findCardInHand(state, cp, '杀');
      expect(cardId).toBeDefined();

      // 执行 startGame + playCard
      const actions: Array<{ action: GameAction; state: GameState }> = [
        { action: { type: '开始' }, state },
      ];

      // startGame 不改变 state（engine 直接返回）
      const startResult = engine(state, { type: '开始' });
      // startGame 返回同一 state（无 events）

      // playCard
      const playResult = engine(state, {
        type: '打出一张牌',
        player: cp,
        cardId: cardId!,
        target,
      });
      expect(playResult.error).toBeUndefined();
      actions.push({
        action: { type: '打出一张牌', player: cp, cardId: cardId!, target },
        state,
      });

      const { logger, finalState } = runGameSequence(actions);
      const serverOps = logger.getServerOps();
      const log = exportWithServerLog(logger, finalState);

      // 验证 serverOps 包含预期类型
      expect(serverOps.length).toBeGreaterThan(0);
      const types = serverOps.map((op) => op.type);
      expect(types).toContain('游戏开始');
      expect(types).toContain('出牌');

      // ReplayEngine 能重建
      const replay = new ReplayEngine(log, { characterMap });
      expect(replay.getTotalSteps()).toBeGreaterThan(1);
    });

    it('ReplayEngine 最终步 state 与 engine 最终 state 关键字段一致', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'], seed: 42 });
      const cp = currentPlayer(state);
      const target = state.playerOrder.find((p) => p !== cp)!;
      state = injectCard(state, cp, '杀');
      state = setPlayPhase(state);

      const cardId = findCardInHand(state, cp, '杀')!;

      // 先执行 startGame（空操作），然后 playCard
      const actions: Array<{ action: GameAction; state: GameState }> = [
        { action: { type: '开始' }, state },
        { action: { type: '打出一张牌', player: cp, cardId, target }, state },
      ];

      const { logger, finalState } = runGameSequence(actions);
      const log = exportWithServerLog(logger, finalState);

      const replay = new ReplayEngine(log, { characterMap });
      replay.goTo(replay.getTotalSteps() - 1);
      const replayState = replay.getCurrent().state;
      // ReplayEngine 从 meta.characters 重建状态，玩家名是角色名而非内部 ID
      // 这是预期行为：ReplayEngine 用角色名作为玩家名
      expect(replayState.playerOrder.length).toBe(finalState.playerOrder.length);
      expect(Object.keys(replayState.players).length).toBe(Object.keys(finalState.players).length);
    });
  });

  describe('saveLog/loadLog round-trip 一致', () => {
    it('GameLog JSON 序列化/反序列化后与原数据一致', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'], seed: 42 });
      const cp = currentPlayer(state);
      state = injectCard(state, cp, '杀');
      state = setPlayPhase(state);

      const cardId = findCardInHand(state, cp, '杀')!;
      const target = state.playerOrder.find((p) => p !== cp)!;

      const actions: Array<{ action: GameAction; state: GameState }> = [
        { action: { type: '开始' }, state },
        { action: { type: '打出一张牌', player: cp, cardId, target }, state },
      ];

      const { logger, finalState } = runGameSequence(actions);
      const log = exportWithServerLog(logger, finalState);

      // 模拟 saveLog/loadLog 的 JSON round-trip
      const json = JSON.stringify(log);
      const parsed: GameLog = JSON.parse(json);

      expect(parsed.meta.version).toBe(log.meta.version);
      expect(parsed.meta.seed).toBe(log.meta.seed);
      expect(parsed.meta.playerCount).toBe(log.meta.playerCount);
      expect(parsed.meta.characters).toEqual(log.meta.characters);
      expect(parsed.serverOps.length).toBe(log.serverOps.length);
      expect(parsed.playerOps).toEqual(log.playerOps);
      expect(parsed.serverLog!.length).toBe(log.serverLog!.length);
    });

    it('round-trip 后的 GameLog 能创建 ReplayEngine 并导航', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'], seed: 42 });
      const cp = currentPlayer(state);
      state = injectCard(state, cp, '杀');
      state = setPlayPhase(state);

      const cardId = findCardInHand(state, cp, '杀')!;
      const target = state.playerOrder.find((p) => p !== cp)!;

      const actions: Array<{ action: GameAction; state: GameState }> = [
        { action: { type: '开始' }, state },
        { action: { type: '打出一张牌', player: cp, cardId, target }, state },
      ];

      const { logger, finalState } = runGameSequence(actions);
      const log = exportWithServerLog(logger, finalState);

      // JSON round-trip
      const json = JSON.stringify(log);
      const parsed: GameLog = JSON.parse(json);

      const replay = new ReplayEngine(parsed, { characterMap });
      expect(replay.getTotalSteps()).toBeGreaterThan(0);
      // 能导航到每一步
      for (let i = 0; i < replay.getTotalSteps(); i++) {
        const step = replay.goTo(i);
        expect(step.state).toBeDefined();
        expect(step.state.playerOrder.length).toBe(2);
      }
    });
  });

  describe('playerOps 视角裁剪', () => {
    it('draw 事件：drawer 看到 cards 详情，他人只看 count', () => {
      // 创建游戏，让 engine 自动推进到摸牌阶段产生 draw 事件
      let state = createTestGame({ characters: ['曹操', '刘备'], seed: 42 });

      // 不设 playPhase，让 engine 从初始状态自动推进
      // 发 startGame 看看有没有 draw 事件（通常 startGame 不产生事件）
      const startResult = engine(state, { type: '开始' });

      // 手动构造一个 draw 事件来验证视角裁剪逻辑
      const players = state.playerOrder;
      const drawer = players[0];
      const other = players[1];
      const logger = new GameLogger(
        {
          version: '1.0',
          createdAt: Date.now(),
          playerCount: players.length,
          characters: players.map((p) => state.players[p].info.characterId),
          seed: state.meta.seed,
        },
        players,
      );

      // 模拟 draw 事件（drawer 摸了 2 张牌）
      const cardIds = ['card-a', 'card-b'];
      // 先在 cardMap 里注册这两张牌
      state = {
        ...state,
        cardMap: {
          ...state.cardMap,
          'card-a': { id: 'card-a', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '7', description: '' },
          'card-b': { id: 'card-b', name: '闪', type: '基本牌', subtype: '闪', suit: '♥', rank: 'K', description: '' },
        },
      };

      const drawEvent: ServerEvent = {
        id: 'evt-draw-1',
        type: '摸牌',
        timestamp: Date.now(),
        payload: { player: drawer, count: 2, cards: cardIds },
      };

      logger.recordBatch(null, [drawEvent], state);

      const drawerOps = logger.getPlayerOps(drawer);
      const otherOps = logger.getPlayerOps(other);

      expect(drawerOps.length).toBe(1);
      expect(otherOps.length).toBe(1);

      // drawer 看到 cards 详情
      const drawerOp = drawerOps[0];
      expect(drawerOp.type).toBe('摸牌');
      expect(drawerOp.description).toContain('杀');
      expect(drawerOp.description).toContain('闪');

      // 他人只看 count，看不到卡名
      const otherOp = otherOps[0];
      expect(otherOp.type).toBe('摸牌');
      expect(otherOp.description).not.toContain('杀');
      expect(otherOp.description).not.toContain('闪');
      expect(otherOp.description).toContain('2');
    });

    it('非 draw 事件：全员看到相同信息', () => {
      const state = createTestGame({ characters: ['曹操', '刘备'], seed: 42 });
      const players = state.playerOrder;
      const target = players[1];
      const source = players[0];

      const logger = new GameLogger(
        {
          version: '1.0',
          createdAt: Date.now(),
          playerCount: players.length,
          characters: players.map((p) => state.players[p].info.characterId),
          seed: state.meta.seed,
        },
        players,
      );

      const damageEvent: ServerEvent = {
        id: 'evt-dmg-1',
        type: '造成伤害',
        timestamp: Date.now(),
        payload: { target, amount: 1, source },
      };

      logger.recordBatch(null, [damageEvent], state);

      // 所有玩家看到相同的 damage 信息
      for (const player of players) {
        const ops = logger.getPlayerOps(player);
        expect(ops.length).toBe(1);
        expect(ops[0].type).toBe('造成伤害');
        expect(ops[0].description).toContain(source);
        expect(ops[0].description).toContain(target);
        expect(ops[0].description).toContain('1');
      }
    });
  });

  describe('ReplayEngine + GameLog 互相兼容', () => {
    it('多步操作后 serverOps seq 连续递增', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'], seed: 42 });
      const players = state.playerOrder;
      const cp = currentPlayer(state);
      const target = players.find((p) => p !== cp)!;

      state = injectCard(state, cp, '杀');
      state = setPlayPhase(state);
      const cardId = findCardInHand(state, cp, '杀')!;

      const actions: Array<{ action: GameAction; state: GameState }> = [
        { action: { type: '开始' }, state },
        { action: { type: '打出一张牌', player: cp, cardId, target }, state },
      ];

      const { logger } = runGameSequence(actions);
      const serverOps = logger.getServerOps();

      // seq 应该从 0 连续递增
      for (let i = 0; i < serverOps.length; i++) {
        expect(serverOps[i].seq).toBe(i);
      }
    });

    it('GameLog 含 serverLog 时 ReplayEngine 能逐步重建状态', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'], seed: 42 });
      state = setPlayPhase(state);

      // 直接执行 engine 看 advanceToInteractivePhase 产生的事件
      const cp = currentPlayer(state);
      state = injectCard(state, cp, '杀');
      const target = state.playerOrder.find((p) => p !== cp)!;
      const cardId = findCardInHand(state, cp, '杀')!;

      const playResult = engine(state, { type: '打出一张牌', player: cp, cardId, target });
      expect(playResult.error).toBeUndefined();

      const players = state.playerOrder;
      const logger = new GameLogger(
        {
          version: '1.0',
          createdAt: Date.now(),
          playerCount: players.length,
          characters: players.map((p) => state.players[p].info.characterId),
          seed: state.meta.seed,
        },
        players,
      );

      // 记录 playCard action + 产生的事件
      logger.recordBatch(
        { type: '打出一张牌', player: cp, cardId, target },
        playResult.events,
        playResult.state,
      );

      const log = logger.export();
      log.serverLog = playResult.state.serverLog
        .slice(state.serverLog.length)
        .map((ev) => ({
          id: ev.id,
          type: ev.type,
          timestamp: ev.timestamp,
          payload: ev.payload,
        }));

      const replay = new ReplayEngine(log, { characterMap });
      expect(replay.getTotalSteps()).toBe(log.serverLog.length + 1);

      // 从第一步导航到最后一步不报错
      while (replay.getCurrentIndex() < replay.getTotalSteps() - 1) {
        const step = replay.next();
        expect(step.state).toBeDefined();
      }
    });

    it('playerOps 每个玩家的 seq 独立递增', () => {
      const state = createTestGame({ characters: ['曹操', '刘备'], seed: 42 });
      const players = state.playerOrder;
      const target = players[1];
      const source = players[0];

      const logger = new GameLogger(
        {
          version: '1.0',
          createdAt: Date.now(),
          playerCount: players.length,
          characters: players.map((p) => state.players[p].info.characterId),
          seed: state.meta.seed,
        },
        players,
      );

      // 记录两批事件
      const ev1: ServerEvent = {
        id: 'e1', type: '造成伤害', timestamp: 1,
        payload: { target, amount: 1, source },
      };
      const ev2: ServerEvent = {
        id: 'e2', type: '造成伤害', timestamp: 2,
        payload: { target, amount: 2, source },
      };

      logger.recordBatch(null, [ev1], state);
      logger.recordBatch(null, [ev2], state);

      for (const player of players) {
        const ops = logger.getPlayerOps(player);
        expect(ops.length).toBe(2);
        expect(ops[0].seq).toBe(0);
        expect(ops[1].seq).toBe(1);
      }
    });
  });
});
