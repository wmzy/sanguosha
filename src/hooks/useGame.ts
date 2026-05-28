import { useState, useCallback } from 'react';
import type { GameState } from '../../shared/types';
import { 创建游戏, 开始游戏, 获取当前玩家 } from '../../engine/state';
import { 进入下一阶段, 摸牌阶段, 弃牌阶段检查, 弃牌阶段执行 } from '../../engine/turn';
import { 使用杀, 使用桃 } from '../../engine/effect';
import { GameLogger } from '../../engine/logger';
import { 曹操, 刘备 } from '../../shared/characters';
import type { Operation } from '../../shared/log';
import { saveLog } from '../utils/logFile';

function advanceToPlayPhase(游戏: GameState, logger: InstanceType<typeof GameLogger>): GameState {
  let state = 游戏;
  // 自动跳过准备和判定阶段，摸牌阶段自动摸牌
  while (state.当前阶段 !== '出牌') {
    if (state.当前阶段 === '摸牌') {
      const result = 摸牌阶段(state, logger);
      state = result.状态;
    }
    state = 进入下一阶段(state, logger);
  }
  return state;
}

export function useGame() {
  const [logger] = useState(() => new GameLogger({
    version: '1.0.0',
    createdAt: Date.now(),
    playerCount: 2,
    characters: ['曹操', '刘备'],
    seed: Date.now(),
  }));
  const [playerOps, setPlayerOps] = useState<Operation[]>([]);

  const [游戏, set游戏] = useState<GameState>(() => {
    const 初始 = 创建游戏([曹操, 刘备], undefined, logger);
    const started = 开始游戏(初始);
    const advanced = advanceToPlayPhase(started, logger);
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
    return advanced;
  });

  const [选中的卡牌, set选中的卡牌] = useState<number | null>(null);

  const 更新操作记录 = useCallback(() => {
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
  }, [logger]);

  const 当前玩家 = 获取当前玩家(游戏);

  const handleSaveLog = useCallback(() => {
    saveLog(logger.export());
  }, [logger]);

  const 处理出牌 = useCallback(() => {
    if (选中的卡牌 === null) return;

    const 卡牌 = 当前玩家.手牌[选中的卡牌];
    if (!卡牌) return;

    if (卡牌.name === '杀') {
      const 目标 = 游戏.玩家列表.find(p => p.name !== 当前玩家.name && p.存活);
      if (目标) {
        const 结果 = 使用杀(游戏, 当前玩家.name, 目标.name, logger);
        if (结果.成功) {
          const 新手牌 = [...当前玩家.手牌];
          新手牌.splice(选中的卡牌, 1);
          set游戏(prev => ({
            ...结果.状态,
            玩家列表: prev.玩家列表.map(p =>
              p.name === 当前玩家.name ? { ...p, 手牌: 新手牌 } : p,
            ),
          }));
          更新操作记录();
        }
      }
    } else if (卡牌.name === '桃') {
      const 结果 = 使用桃(游戏, 当前玩家.name, logger);
      if (结果.成功) {
        const 新手牌 = [...当前玩家.手牌];
        新手牌.splice(选中的卡牌, 1);
        set游戏(prev => ({
          ...结果.状态,
          玩家列表: prev.玩家列表.map(p =>
            p.name === 当前玩家.name ? { ...p, 手牌: 新手牌 } : p,
          ),
        }));
        更新操作记录();
      }
    }

    set选中的卡牌(null);
  }, [游戏, 选中的卡牌, 当前玩家, logger, 更新操作记录]);

  const 处理结束回合 = useCallback(() => {
    let 新游戏 = 游戏;
    // 弃牌阶段检查
    if (新游戏.当前阶段 === '弃牌') {
      const 需要弃牌 = 弃牌阶段检查(新游戏);
      if (需要弃牌) {
        新游戏 = 弃牌阶段执行(新游戏, [0], logger);
      }
    }
    // 推进到下一个玩家的出牌阶段
    新游戏 = 进入下一阶段(新游戏, logger); // 出牌 → 弃牌
    新游戏 = 进入下一阶段(新游戏, logger); // 弃牌 → 结束
    新游戏 = 进入下一阶段(新游戏, logger); // 结束 → 准备
    // 自动跳过下一个玩家的准备和判定阶段，摸牌
    新游戏 = advanceToPlayPhase(新游戏, logger);
    set游戏(新游戏);
    更新操作记录();
  }, [游戏, 当前玩家, logger, 更新操作记录]);

  return {
    游戏,
    当前玩家,
    选中的卡牌,
    set选中的卡牌,
    playerOps,
    处理出牌,
    处理结束回合,
    handleSaveLog,
  };
}
