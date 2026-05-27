import type { GameState, TurnPhase } from '../shared/types';
import type { GameLogger } from './logger';
import { 获取当前玩家, 获取存活玩家 } from './state';
import { 摸牌 } from '../shared/deck';

const 阶段顺序: TurnPhase[] = ['准备', '判定', '摸牌', '出牌', '弃牌', '结束'];

export function 进入下一阶段(游戏: GameState, logger?: GameLogger): GameState {
  const 当前索引 = 阶段顺序.indexOf(游戏.当前阶段);
  const 下一索引 = (当前索引 + 1) % 阶段顺序.length;
  const 下一阶段 = 阶段顺序[下一索引];

  // 如果回到准备阶段，说明一个回合结束
  if (下一阶段 === '准备' && 当前索引 === 阶段顺序.length - 1) {
    const 存活玩家 = 获取存活玩家(游戏);
    const 当前玩家索引 = 存活玩家.findIndex(p => p.name === 游戏.当前玩家);
    const 下一玩家索引 = (当前玩家索引 + 1) % 存活玩家.length;
    const 下一玩家 = 存活玩家[下一玩家索引];

    const newState = {
      ...游戏,
      当前阶段: 下一阶段,
      当前玩家: 下一玩家.name,
      回合数: 游戏.回合数 + 1,
    };

    if (logger) {
      logger.logServerOp('phaseChange', { phase: 下一阶段, player: 下一玩家.name }, `进入${下一阶段}阶段`);
      logger.logServerOp('turnChange', { from: 游戏.当前玩家, to: 下一玩家.name, round: newState.回合数 }, `轮到 ${下一玩家.name} 的回合`);
    }

    return newState;
  }

  const newState = {
    ...游戏,
    当前阶段: 下一阶段,
  };

  if (logger) {
    logger.logServerOp('phaseChange', { phase: 下一阶段, player: 游戏.当前玩家 }, `进入${下一阶段}阶段`);
  }

  return newState;
}

export function 摸牌阶段(游戏: GameState, logger?: GameLogger): { 状态: GameState; 消息: string } {
  const 当前玩家 = 获取当前玩家(游戏);
  const { 摸到的牌, 剩余牌堆 } = 摸牌(游戏.牌堆, 2);

  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 当前玩家.name) {
      return { ...p, 手牌: [...p.手牌, ...摸到的牌] };
    }
    return p;
  });

  const 状态 = { ...游戏, 玩家列表: 新玩家列表, 牌堆: 剩余牌堆 };

  if (logger) {
    logger.logServerOp('draw', {
      player: 当前玩家.name,
      cards: 摸到的牌.map(c => ({ name: c.name, 花色: c.花色, 点数: c.点数 })),
    }, `${当前玩家.name} 摸了 ${摸到的牌.length} 张牌`);
    logger.logPlayerOp(当前玩家.name, 'draw', {
      player: 当前玩家.name,
      cards: 摸到的牌.map(c => ({ name: c.name, 花色: c.花色, 点数: c.点数 })),
    }, `你摸了 ${摸到的牌.map(c => c.name).join('、')}`);
  }

  return {
    状态,
    消息: `${当前玩家.name} 摸了 ${摸到的牌.length} 张牌`,
  };
}

export function 弃牌阶段检查(游戏: GameState): boolean {
  const 当前玩家 = 获取当前玩家(游戏);
  return 当前玩家.手牌.length > 当前玩家.体力上限;
}

export function 弃牌阶段执行(游戏: GameState, 弃的牌索引: number[], logger?: GameLogger): GameState {
  const 当前玩家 = 获取当前玩家(游戏);
  const 弃的牌 = 弃的牌索引.map(i => 当前玩家.手牌[i]).filter(Boolean);
  const 剩余手牌 = 当前玩家.手牌.filter((_, i) => !弃的牌索引.includes(i));

  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 当前玩家.name) {
      return { ...p, 手牌: 剩余手牌 };
    }
    return p;
  });

  const newState = {
    ...游戏,
    玩家列表: 新玩家列表,
    弃牌堆: [...游戏.弃牌堆, ...弃的牌],
  };

  if (logger) {
    logger.logServerOp('discard', {
      player: 当前玩家.name,
      cards: 弃的牌.map(c => ({ name: c.name, 花色: c.花色, 点数: c.点数 })),
    }, `${当前玩家.name} 弃了 ${弃的牌.length} 张牌`);
    logger.logPlayerOp(当前玩家.name, 'discard', {
      player: 当前玩家.name,
      cards: 弃的牌.map(c => ({ name: c.name, 花色: c.花色, 点数: c.点数 })),
    }, `你弃了 ${弃的牌.map(c => c.name).join('、')}`);
  }

  return newState;
}
