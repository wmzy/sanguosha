// engine/效果.ts
import type { GameState } from '../shared/types';
import type { GameLogger } from './logger';

interface EffectResult {
  成功: boolean;
  状态: GameState;
  消息: string;
}

export function 使用杀(游戏: GameState, 使用者名: string, 目标名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);
  const 目标 = 游戏.玩家列表.find(p => p.name === 目标名);

  if (!使用者 || !目标) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  if (使用者名 === 目标名) {
    return { 成功: false, 状态: 游戏, 消息: '不能对自己使用杀' };
  }

  if (!目标.存活) {
    return { 成功: false, 状态: 游戏, 消息: '目标已死亡' };
  }

  // 造成1点伤害
  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 目标名) {
      return { ...p, 体力: p.体力 - 1 };
    }
    return p;
  });

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 对 ${目标名} 使用杀，造成1点伤害`,
  };

  if (logger) {
    logger.logServerOp('damage', {
      source: 使用者名,
      target: 目标名,
      amount: 1,
      cardName: '杀',
    }, `${使用者名} 对 ${目标名} 使用杀，造成1点伤害`);
    for (const 玩家 of 游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'damage', {
        source: 使用者名,
        target: 目标名,
        amount: 1,
      }, `${使用者名} 对 ${目标名} 使用杀，造成1点伤害`);
    }
  }

  return result;
}

export function 使用桃(游戏: GameState, 使用者名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);

  if (!使用者) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  if (使用者.体力 >= 使用者.体力上限) {
    return { 成功: false, 状态: 游戏, 消息: '体力已满，不能使用桃' };
  }

  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 使用者名) {
      return { ...p, 体力: Math.min(p.体力 + 1, p.体力上限) };
    }
    return p;
  });

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 使用桃，恢复1点体力`,
  };

  if (logger) {
    logger.logServerOp('heal', {
      player: 使用者名,
      amount: 1,
      newHealth: 使用者.体力 + 1,
    }, `${使用者名} 使用桃，恢复1点体力`);
    for (const 玩家 of 游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'heal', {
        player: 使用者名,
        amount: 1,
      }, `${使用者名} 使用桃，恢复1点体力`);
    }
  }

  return result;
}

export function 解析效果(游戏: GameState, _效果: Record<string, unknown>): EffectResult {
  // 通用效果解析器，后续扩展
  return { 成功: false, 状态: 游戏, 消息: '未实现的效果类型' };
}
