// engine/效果.ts
import type { GameState, Player } from '../shared/类型';
import { 获取当前玩家 } from './状态';

interface EffectResult {
  成功: boolean;
  状态: GameState;
  消息: string;
}

export function 使用杀(游戏: GameState, 使用者名: string, 目标名: string): EffectResult {
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

  return {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 对 ${目标名} 使用杀，造成1点伤害`,
  };
}

export function 使用桃(游戏: GameState, 使用者名: string): EffectResult {
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

  return {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 使用桃，恢复1点体力`,
  };
}

export function 解析效果(游戏: GameState, 效果: Record<string, unknown>): EffectResult {
  // 通用效果解析器，后续扩展
  return { 成功: false, 状态: 游戏, 消息: '未实现的效果类型' };
}
