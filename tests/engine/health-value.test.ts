// 回归测试:体力/体力值数值模型(glossary/value.md)。
// 核心:体力(health)可负;体力值=Math.max(0,health) 封底为0。
// 文档示例:庞统-甘夫人 体力1 受3点伤害 → 体力-2,涅槃回复至3需5点(淑慎触发5次)。
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms';
import { createGameState, getHealthValue } from '../../src/engine/types';
import type { GameState, PlayerState } from '../../src/engine/types';
import { runDecreaseLifeFlow, runRecoverLifeFlow, runLoseLifeFlow } from '../../src/engine/flows/life';

function mkPlayer(hp: number, max: number): PlayerState {
  return {
    index: 0, name: 'P0', character: 'P0', health: hp, maxHealth: max,
    alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [],
    pendingTricks: [], tags: [], judgeZone: [],
  };
}
function mkState(p: PlayerState): GameState {
  return createGameState({ players: [p], cardMap: {}, currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} } });
}

describe('体力/体力值数值模型', () => {
  describe('getHealthValue', () => {
    it('正体力时 = 体力', () => {
      expect(getHealthValue({ health: 3 })).toBe(3);
      expect(getHealthValue({ health: 0 })).toBe(0);
    });
    it('负体力时封底为 0', () => {
      expect(getHealthValue({ health: -2 })).toBe(0);
      expect(getHealthValue({ health: -5 })).toBe(0);
    });
    it('null/undefined 安全', () => {
      expect(getHealthValue(undefined)).toBe(0);
      expect(getHealthValue(null)).toBe(0);
    });
  });

  describe('扣减体力可低于0', () => {
    it('4体力扣10 → 体力-6,体力值0', async () => {
      const s = mkState(mkPlayer(4, 4));
      await runDecreaseLifeFlow(s, 0, 10);
      expect(s.players[0].health).toBe(-6);
      expect(getHealthValue(s.players[0])).toBe(0);
    });
    it('1体力扣3 → 体力-2(文档闪电示例)', async () => {
      const s = mkState(mkPlayer(1, 3));
      await runDecreaseLifeFlow(s, 0, 3);
      expect(s.players[0].health).toBe(-2);
      expect(getHealthValue(s.players[0])).toBe(0);
    });
  });

  describe('失去体力可低于0', () => {
    it('1体力失去3 → 体力-2', async () => {
      const s = mkState(mkPlayer(1, 3));
      await runLoseLifeFlow(s, 0, 3);
      expect(s.players[0].health).toBe(-2);
    });
  });

  describe('从负值回复正确计算点数', () => {
    it('体力-2回复5 → 体力3(需5点,非3点)', async () => {
      const s = mkState(mkPlayer(-2, 3));
      await runRecoverLifeFlow(s, 0, 5);
      expect(s.players[0].health).toBe(3);
    });
    it('回复体力后 amount=5(淑慎类按点触发5次的基础)', async () => {
      const s = mkState(mkPlayer(-2, 3));
      await runRecoverLifeFlow(s, 0, 5);
      const recover = s.atomHistory
        .filter((e) => e.kind === 'atom')
        .map((e) => (e as { atom: { type: string; amount?: number } }).atom)
        .find((a) => a.type === '回复体力后');
      expect(recover?.amount).toBe(5);
    });
    it('体力0回复1 → 体力1(濒死求桃1张救活)', async () => {
      const s = mkState(mkPlayer(0, 3));
      await runRecoverLifeFlow(s, 0, 1);
      expect(s.players[0].health).toBe(1);
    });
  });

  describe('濒死求桃数量(体力负值需多点回复)', () => {
    it('体力-2时回复1 → 体力-1(仍濒死,需3张桃才到1)', async () => {
      // -2 + 1 = -1,仍 ≤0 即濒死。文档:health<=0 仍濒死。
      const s = mkState(mkPlayer(-2, 3));
      await runRecoverLifeFlow(s, 0, 1);
      expect(s.players[0].health).toBe(-1);
      expect(s.players[0].health <= 0).toBe(true); // 仍濒死
    });
    it('体力-2需回复3才到1(脱离濒死)', async () => {
      const s = mkState(mkPlayer(-2, 3));
      await runRecoverLifeFlow(s, 0, 3);
      expect(s.players[0].health).toBe(1);
      expect(s.players[0].health > 0).toBe(true); // 脱离濒死
    });
  });

  describe('已损失体力值 = maxHealth - getHealthValue(health)', () => {
    it('体力-2上限3 → 已损失体力值3(非5)', () => {
      const p = mkPlayer(-2, 3);
      expect(p.maxHealth - getHealthValue(p)).toBe(3);
    });
    it('体力2上限3 → 已损失体力值1', () => {
      const p = mkPlayer(2, 3);
      expect(p.maxHealth - getHealthValue(p)).toBe(1);
    });
  });
});
