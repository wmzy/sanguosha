// src/components/GameBoard.tsx
import { useState, useCallback } from 'react';
import type { GameState } from '../../shared/类型';
import { 创建游戏, 开始游戏, 获取当前玩家 } from '../../engine/状态';
import { 进入下一阶段, 摸牌阶段, 弃牌阶段检查, 弃牌阶段执行 } from '../../engine/回合';
import { 使用杀, 使用桃 } from '../../engine/效果';
import { GameLogger } from '../../engine/logger';
import { 曹操, 刘备 } from '../../shared/角色';
import type { Operation } from '../../shared/log';
import { PlayerPanel } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';
import { LogPanel } from './LogPanel';
import { saveLog } from '../utils/logFile';

export function GameBoard() {
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
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
    return 开始游戏(初始);
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
    while (新游戏.当前阶段 !== '准备' || 新游戏.当前玩家 === 当前玩家.name) {
      if (新游戏.当前阶段 === '摸牌') {
        const 结果 = 摸牌阶段(新游戏, logger);
        新游戏 = 结果.状态;
      }
      if (新游戏.当前阶段 === '弃牌') {
        const 需要弃牌 = 弃牌阶段检查(新游戏);
        if (需要弃牌) {
          新游戏 = 弃牌阶段执行(新游戏, [0], logger);
        }
      }
      新游戏 = 进入下一阶段(新游戏, logger);
      if (新游戏.当前阶段 === '准备' && 新游戏.当前玩家 !== 当前玩家.name) break;
    }
    set游戏(新游戏);
    更新操作记录();
  }, [游戏, 当前玩家, logger, 更新操作记录]);

  return (
    <div style={{ padding: 20, backgroundColor: '#1a1a2e', minHeight: '100vh', color: '#eee' }}>
      <h1 style={{ textAlign: 'center', marginBottom: 20 }}>三国杀</h1>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 30 }}>
        {游戏.玩家列表.map(玩家 => (
          <PlayerPanel
            key={玩家.name}
            玩家={玩家}
            是当前玩家={玩家.name === 游戏.当前玩家}
            是自己={玩家.name === '曹操'}
          />
        ))}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <span>回合 {游戏.回合数} | 阶段: {游戏.当前阶段} | 当前玩家: {游戏.当前玩家}</span>
      </div>

      <div style={{ marginBottom: 20 }}>
        <HandCards
          手牌={当前玩家.手牌}
          选中索引={选中的卡牌}
          选择卡牌={(索引) => set选中的卡牌(索引 === -1 ? null : 索引)}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <ActionPanel
          能出牌={选中的卡牌 !== null && 游戏.当前阶段 === '出牌'}
          能结束回合={游戏.当前玩家 === '曹操' && 游戏.当前阶段 === '出牌'}
          出牌={处理出牌}
          结束回合={处理结束回合}
        />
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <button onClick={handleSaveLog} style={{ padding: '8px 20px', backgroundColor: '#9b59b6', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          保存日志
        </button>
      </div>

      <LogPanel operations={playerOps} />
    </div>
  );
}
