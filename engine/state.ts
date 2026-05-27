// engine/状态.ts
import type { GameState, Player, PublicGameState, CharacterConfig, Role } from '../shared/types';
import type { GameLogger } from './logger';
import { 创建标准牌堆 } from '../shared/cards';
import { 洗牌 } from '../shared/deck';
import { createRng } from '../shared/rng';

export function 创建游戏(角色列表: CharacterConfig[], seed?: number, logger?: GameLogger): GameState {
  const rng = createRng(seed ?? Date.now());
  const 牌堆 = 洗牌(创建标准牌堆(), rng);

  const 身份列表 = 分配身份(角色列表.length);

  const 玩家列表: Player[] = 角色列表.map((角色, i) => ({
    name: 角色.name,
    角色,
    身份: 身份列表[i],
    体力: 角色.maxHealth,
    体力上限: 角色.maxHealth,
    手牌: [],
    装备: {},
    存活: true,
  }));

  const gameState: GameState = {
    玩家列表,
    牌堆,
    弃牌堆: [],
    当前玩家: 玩家列表[0].name,
    当前阶段: '准备',
    回合数: 1,
    状态: '等待中',
  };

  if (logger) {
    logger.logServerOp('gameStart', {
      players: 玩家列表.map(p => ({ name: p.name, character: p.角色.name, role: p.身份 })),
    }, `游戏开始: ${玩家列表.map(p => p.name).join(', ')}`);
    for (const 玩家 of 玩家列表) {
      logger.logPlayerOp(玩家.name, 'gameStart', {
        player: 玩家.name,
        character: 玩家.角色.name,
        role: 玩家.身份,
      }, `游戏开始，你是 ${玩家.角色.name}（${玩家.身份}）`);
    }
  }

  return gameState;
}

function 分配身份(玩家数: number): Role[] {
  if (玩家数 === 2) {
    return ['主公', '反贼'];
  }
  // 4人: 主公, 忠臣, 反贼, 内奸
  // 5人: 主公, 忠臣, 反贼, 反贼, 内奸
  const 身份: Role[] = ['主公'];
  if (玩家数 >= 4) 身份.push('忠臣');
  const 反贼数 = 玩家数 >= 5 ? 2 : 1;
  for (let i = 0; i < 反贼数; i++) 身份.push('反贼');
  if (玩家数 >= 4) 身份.push('内奸');
  return 身份.slice(0, 玩家数);
}

export function 获取公开状态(游戏: GameState, 观察者名: string): PublicGameState {
  return {
    玩家列表: 游戏.玩家列表.map(玩家 => {
      const { 手牌, ...其余 } = 玩家;
      if (玩家.name === 观察者名) {
        return { ...其余, 手牌, 手牌数量: 手牌.length };
      }
      return { ...其余, 手牌数量: 手牌.length };
    }),
    弃牌堆: 游戏.弃牌堆,
    当前玩家: 游戏.当前玩家,
    当前阶段: 游戏.当前阶段,
    回合数: 游戏.回合数,
    状态: 游戏.状态,
    获胜身份: 游戏.获胜身份,
  };
}

export function 开始游戏(游戏: GameState): GameState {
  return { ...游戏, 状态: '进行中' };
}

export function 获取当前玩家(游戏: GameState): Player {
  const 玩家 = 游戏.玩家列表.find(p => p.name === 游戏.当前玩家);
  if (!玩家) throw new Error(`找不到玩家: ${游戏.当前玩家}`);
  return 玩家;
}

export function 获取存活玩家(游戏: GameState): Player[] {
  return 游戏.玩家列表.filter(p => p.存活);
}

// ============================================================
// 胜利条件检查
// ============================================================

/**
 * 检查游戏是否结束，返回获胜身份或undefined
 *
 * 主公获胜条件: 所有反贼和内奸死亡
 * 忠臣获胜条件: 同主公
 * 反贼获胜条件: 主公死亡
 * 内奸获胜条件: 成为最后存活者（与主公一起）
 */
export function 检查胜利(游戏: GameState, logger?: GameLogger): GameState {
  const 存活 = 获取存活玩家(游戏);
  const 主公 = 游戏.玩家列表.find(p => p.身份 === '主公');

  const 存活身份 = 存活.map(p => p.身份);
  const 有反贼 = 存活身份.includes('反贼');
  const 有内奸 = 存活身份.includes('内奸');

  function logGameEnd(获胜身份: Role): void {
    if (logger) {
      const 获胜原因 = `${获胜身份}获胜`;
      logger.logServerOp('gameEnd', {
        winner: 获胜身份,
        reason: 获胜原因,
      }, `游戏结束: ${获胜原因}`);
      for (const 玩家 of 游戏.玩家列表) {
        logger.logPlayerOp(玩家.name, 'gameEnd', {
          winner: 获胜身份,
          reason: 获胜原因,
        }, `游戏结束: ${获胜原因}`);
      }
    }
  }

  // 主公死亡
  if (主公 && !主公.存活) {
    // 如果反贼还活着 → 反贼获胜
    if (有反贼) {
      logGameEnd('反贼');
      return { ...游戏, 状态: '已结束', 获胜身份: '反贼' };
    }
    // 如果只剩内奸 → 内奸获胜（内奸杀死了主公）
    if (有内奸 && 存活.length === 1) {
      logGameEnd('内奸');
      return { ...游戏, 状态: '已结束', 获胜身份: '内奸' };
    }
    // 其他情况（主公被忠臣误杀等）→ 反贼获胜
    logGameEnd('反贼');
    return { ...游戏, 状态: '已结束', 获胜身份: '反贼' };
  }

  // 主公存活，所有反贼和内奸死亡 → 主公/忠臣获胜
  if (主公?.存活 && !有反贼 && !有内奸) {
    logGameEnd('主公');
    return { ...游戏, 状态: '已结束', 获胜身份: '主公' };
  }

  // 只剩主公和内奸时，进入最终对决
  // 主公+内奸的情况下游戏继续，直到一方死亡

  // 只剩一人（没有主公的极端情况）→ 该玩家获胜
  if (存活.length === 1) {
    logGameEnd(存活[0].身份);
    return { ...游戏, 状态: '已结束', 获胜身份: 存活[0].身份 };
  }

  return 游戏;
}

/**
 * 标记玩家死亡并检查胜利
 */
export function 玩家死亡(游戏: GameState, 玩家名: string, logger?: GameLogger): GameState {
  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 玩家名) {
      return { ...p, 存活: false };
    }
    return p;
  });

  const 新游戏 = { ...游戏, 玩家列表: 新玩家列表 };

  if (logger) {
    logger.logServerOp('gameEnd', {
      player: 玩家名,
    }, `${玩家名} 已死亡`);
    for (const 玩家 of 新游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'gameEnd', {
        player: 玩家名,
      }, `${玩家名} 已死亡`);
    }
  }

  return 检查胜利(新游戏, logger);
}
