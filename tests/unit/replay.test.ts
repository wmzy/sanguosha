import { describe, it, expect } from 'vitest';
import type { GameLog, Operation } from '../../shared/log';
import type { CharacterConfig } from '../../shared/types';
import { ReplayEngine } from '../../engine/replay';

const characterMap: Record<string, CharacterConfig> = {
  曹操: { name: '曹操', maxHealth: 4, gender: '男', faction: '魏', abilities: [] },
  刘备: { name: '刘备', maxHealth: 5, gender: '男', faction: '蜀', abilities: [] },
};

function makeOp(seq: number, type: string, desc: string): Operation {
  return { seq, timestamp: Date.now(), type: type as Operation['type'], data: {}, description: desc };
}

function baseLog(): GameLog {
  return {
    meta: { version: '1.0', createdAt: Date.now(), playerCount: 2, characters: ['曹操', '刘备'], seed: 42 },
    serverOps: [],
    playerOps: { 曹操: [], 刘备: [] },
    serverLog: [],
  };
}

describe('ReplayEngine', () => {
  describe('构造：buildSteps', () => {
    it('serverLog 为空时只有初始步', () => {
      const engine = new ReplayEngine(baseLog(), { characterMap });
      expect(engine.getTotalSteps()).toBe(1);
      expect(engine.getCurrentIndex()).toBe(0);
    });

    it('步骤数 = serverLog.length + 1', () => {
      const log = baseLog();
      log.serverLog = [
        { id: 'e1', type: '设阶段', timestamp: 1, payload: { phase: '判定' } },
        { id: 'e2', type: '设阶段', timestamp: 2, payload: { phase: '摸牌' } },
        { id: 'e3', type: '设阶段', timestamp: 3, payload: { phase: '出牌' } },
      ];
      const engine = new ReplayEngine(log, { characterMap });
      expect(engine.getTotalSteps()).toBe(4);
    });

    it('serverLog 不存在时只有初始步', () => {
      const log = baseLog();
      delete (log as unknown as Record<string, unknown>).serverLog;
      const engine = new ReplayEngine(log, { characterMap });
      expect(engine.getTotalSteps()).toBe(1);
    });
  });

  describe('导航：next / prev / goTo', () => {
    function threeStepEngine() {
      const log = baseLog();
      log.serverLog = [
        { id: 'e1', type: '设阶段', timestamp: 1, payload: { phase: '判定' } },
        { id: 'e2', type: '设阶段', timestamp: 2, payload: { phase: '摸牌' } },
        { id: 'e3', type: '设阶段', timestamp: 3, payload: { phase: '出牌' } },
      ];
      return new ReplayEngine(log, { characterMap });
    }

    it('next 前进到下一步', () => {
      const engine = threeStepEngine();
      expect(engine.getCurrentIndex()).toBe(0);
      const step = engine.next();
      expect(step.seq).toBe(1);
      expect(engine.getCurrentIndex()).toBe(1);
    });

    it('prev 退回上一步', () => {
      const engine = threeStepEngine();
      engine.next();
      engine.next();
      const step = engine.prev();
      expect(step.seq).toBe(1);
      expect(engine.getCurrentIndex()).toBe(1);
    });

    it('next 越界不报错，停在最后步', () => {
      const engine = threeStepEngine();
      engine.goTo(3);
      const before = engine.getCurrentIndex();
      engine.next();
      expect(engine.getCurrentIndex()).toBe(before);
    });

    it('prev 越界不报错，停在初始步', () => {
      const engine = threeStepEngine();
      engine.prev();
      expect(engine.getCurrentIndex()).toBe(0);
    });

    it('goTo(0) 回到初始', () => {
      const engine = threeStepEngine();
      engine.goTo(3);
      engine.goTo(0);
      expect(engine.getCurrentIndex()).toBe(0);
      expect(engine.getCurrent().seq).toBe(0);
    });

    it('goTo(totalSteps-1) 到最终步', () => {
      const engine = threeStepEngine();
      engine.goTo(3);
      expect(engine.getCurrentIndex()).toBe(3);
      expect(engine.getCurrent().seq).toBe(3);
    });

    it('goTo 负数 clamp 到 0', () => {
      const engine = threeStepEngine();
      engine.goTo(-5);
      expect(engine.getCurrentIndex()).toBe(0);
    });

    it('goTo 超出上限 clamp 到最后步', () => {
      const engine = threeStepEngine();
      engine.goTo(999);
      expect(engine.getCurrentIndex()).toBe(3);
    });
  });

  describe('状态重建', () => {
    it('初始步 phase = 准备', () => {
      const engine = new ReplayEngine(baseLog(), { characterMap });
      expect(engine.getCurrent().state.phase).toBe('准备');
    });

    it('setPhase 事件重建 phase 切换', () => {
      const log = baseLog();
      log.serverLog = [
        { id: 'e1', type: '设阶段', timestamp: 1, payload: { phase: '判定' } },
      ];
      const engine = new ReplayEngine(log, { characterMap });
      engine.next();
      expect(engine.getCurrent().state.phase).toBe('判定');
    });

    it('damage 事件重建：player.health 减少', () => {
      const log = baseLog();
      log.serverLog = [
        { id: 'e1', type: '造成伤害', timestamp: 1, payload: { target: '曹操', amount: 1 } },
      ];
      const engine = new ReplayEngine(log, { characterMap });
      const initHealth = engine.getCurrent().state.players['曹操'].health;
      engine.next();
      expect(engine.getCurrent().state.players['曹操'].health).toBe(initHealth - 1);
    });

    it('nextPlayer 事件重建：currentPlayer 切换', () => {
      const log = baseLog();
      log.serverLog = [
        { id: 'e1', type: '下一玩家', timestamp: 1, payload: { to: '刘备' } },
      ];
      const engine = new ReplayEngine(log, { characterMap });
      expect(engine.getCurrent().state.currentPlayer).toBe('曹操');
      engine.next();
      expect(engine.getCurrent().state.currentPlayer).toBe('刘备');
    });
  });

  describe('getPlayerOps', () => {
    it('截止当前步返回 playerOps', () => {
      const log = baseLog();
      log.playerOps['曹操'] = [
        makeOp(0, '摸牌', '摸牌'),
        makeOp(1, '出牌', '出牌'),
        makeOp(2, '弃置', '弃牌'),
      ];
      log.serverLog = [
        { id: 'e1', type: '设阶段', timestamp: 1, payload: { phase: '摸牌' } },
        { id: 'e2', type: '设阶段', timestamp: 2, payload: { phase: '出牌' } },
        { id: 'e3', type: '设阶段', timestamp: 3, payload: { phase: '弃牌' } },
      ];
      const engine = new ReplayEngine(log, { characterMap });

      // Step 0: currentIdx=0 → slice(0,1)
      expect(engine.getPlayerOps('曹操')).toHaveLength(1);
      expect(engine.getPlayerOps('曹操')[0].description).toBe('摸牌');

      // Step 2: currentIdx=2 → slice(0,3)
      engine.goTo(2);
      expect(engine.getPlayerOps('曹操')).toHaveLength(3);
    });

    it('显式 upto 参数', () => {
      const log = baseLog();
      log.playerOps['刘备'] = [makeOp(0, '摸牌', 'A'), makeOp(1, '出牌', 'B')];
      const engine = new ReplayEngine(log, { characterMap });
      expect(engine.getPlayerOps('刘备', 1)).toHaveLength(1);
      expect(engine.getPlayerOps('刘备', 0)).toHaveLength(0);
    });

    it('不存在的玩家返回空', () => {
      const engine = new ReplayEngine(baseLog(), { characterMap });
      expect(engine.getPlayerOps('未知')).toEqual([]);
    });
  });

  describe('集成：逐条 next 与 goTo 一致', () => {
    it('next×N 状态 == goTo(N) 状态', () => {
      const log = baseLog();
      log.serverLog = [
        { id: 'e1', type: '设阶段', timestamp: 1, payload: { phase: '判定' } },
        { id: 'e2', type: '造成伤害', timestamp: 2, payload: { target: '刘备', amount: 2 } },
        { id: 'e3', type: '设阶段', timestamp: 3, payload: { phase: '出牌' } },
      ];

      const engineA = new ReplayEngine(log, { characterMap });
      for (let i = 0; i < 3; i++) engineA.next();

      const engineB = new ReplayEngine(log, { characterMap });
      engineB.goTo(3);

      expect(engineA.getCurrent().state.phase).toBe(engineB.getCurrent().state.phase);
      expect(engineA.getCurrent().state.players['刘备'].health).toBe(
        engineB.getCurrent().state.players['刘备'].health,
      );
      expect(engineA.getCurrentIndex()).toBe(engineB.getCurrentIndex());
    });
  });
});
