// src/components/GameBoard.tsx
import { useState, useCallback } from 'react';
import type { GameState } from '../../shared/类型';
import { 创建游戏, 开始游戏, 获取当前玩家 } from '../../engine/状态';
import { 进入下一阶段, 摸牌阶段, 弃牌阶段检查, 弃牌阶段执行 } from '../../engine/回合';
import { 使用杀, 使用桃 } from '../../engine/效果';
import { 曹操, 刘备 } from '../../shared/角色';
import { PlayerPanel } from './PlayerPanel';

export function GameBoard() {
  const [游戏, set游戏] = useState<GameState>(() => {
    const 初始 = 创建游戏([曹操, 刘备]);
    return 开始游戏(初始);
  });

  const [选中的卡牌, set选中的卡牌] = useState<number | null>(null);
  const [消息日志, set消息日志] = useState<string[]>(['游戏开始！']);

  const 添加日志 = useCallback((消息: string) => {
    set消息日志(prev => [...prev, 消息]);
  }, []);

  const 当前玩家 = 获取当前玩家(游戏);

  const 处理出牌 = useCallback(() => {
    if (选中的卡牌 === null) return;

    const 卡牌 = 当前玩家.手牌[选中的卡牌];
    if (!卡牌) return;

    if (卡牌.name === '杀') {
      const 目标 = 游戏.玩家列表.find(p => p.name !== 当前玩家.name && p.存活);
      if (目标) {
        const 结果 = 使用杀(游戏, 当前玩家.name, 目标.name);
        if (结果.成功) {
          添加日志(结果.消息);
          const 新手牌 = [...当前玩家.手牌];
          新手牌.splice(选中的卡牌, 1);
          set游戏(prev => ({
            ...结果.状态,
            玩家列表: prev.玩家列表.map(p =>
              p.name === 当前玩家.name ? { ...p, 手牌: 新手牌 } : p,
            ),
          }));
        } else {
          添加日志(结果.消息);
        }
      }
    } else if (卡牌.name === '桃') {
      const 结果 = 使用桃(游戏, 当前玩家.name);
      if (结果.成功) {
        添加日志(结果.消息);
        const 新手牌 = [...当前玩家.手牌];
        新手牌.splice(选中的卡牌, 1);
        set游戏(prev => ({
          ...结果.状态,
          玩家列表: prev.玩家列表.map(p =>
            p.name === 当前玩家.name ? { ...p, 手牌: 新手牌 } : p,
          ),
        }));
      } else {
        添加日志(结果.消息);
      }
    }

    set选中的卡牌(null);
  }, [游戏, 选中的卡牌, 当前玩家, 添加日志]);

  const 处理结束回合 = useCallback(() => {
    let 新游戏 = 游戏;
    while (新游戏.当前阶段 !== '准备' || 新游戏.当前玩家 === 当前玩家.name) {
      if (新游戏.当前阶段 === '摸牌') {
        const 结果 = 摸牌阶段(新游戏);
        新游戏 = 结果.状态;
        添加日志(结果.消息);
      }
      if (新游戏.当前阶段 === '弃牌') {
        const 需要弃牌 = 弃牌阶段检查(新游戏);
        if (需要弃牌) {
          新游戏 = 弃牌阶段执行(新游戏, [0]);
        }
      }
      新游戏 = 进入下一阶段(新游戏);
      if (新游戏.当前阶段 === '准备' && 新游戏.当前玩家 !== 当前玩家.name) break;
    }
    set游戏(新游戏);
    添加日志(`轮到 ${新游戏.当前玩家} 的回合`);
  }, [游戏, 当前玩家, 添加日志]);

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

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
        {当前玩家.手牌.map((卡牌, 索引) => (
          <div
            key={索引}
            onClick={() => set选中的卡牌(选中的卡牌 === 索引 ? null : 索引)}
            style={{
              border: 选中的卡牌 === 索引 ? '2px solid #e74c3c' : '2px solid #7f8c8d',
              borderRadius: 8,
              padding: 12,
              backgroundColor: '#2c3e50',
              cursor: 'pointer',
              minWidth: 80,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 'bold' }}>{卡牌.name}</div>
            <div style={{ fontSize: 12, color: '#95a5a6' }}>{卡牌.花色}{卡牌.点数}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
        <button
          onClick={处理出牌}
          disabled={选中的卡牌 === null}
          style={{
            padding: '8px 24px',
            backgroundColor: 选中的卡牌 !== null ? '#e74c3c' : '#7f8c8d',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 选中的卡牌 !== null ? 'pointer' : 'not-allowed',
          }}
        >
          出牌
        </button>
        <button
          onClick={处理结束回合}
          style={{
            padding: '8px 24px',
            backgroundColor: '#3498db',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          结束回合
        </button>
      </div>

      <div style={{
        maxHeight: 200,
        overflow: 'auto',
        backgroundColor: '#2c3e50',
        borderRadius: 8,
        padding: 12,
      }}>
        {消息日志.map((消息, i) => (
          <div key={i} style={{ fontSize: 13, color: '#bdc3c7', marginBottom: 2 }}>{消息}</div>
        ))}
      </div>
    </div>
  );
}
