import { useGame } from '../hooks/useGame';
import { PlayerPanel } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';
import { LogPanel } from './LogPanel';

export function GameBoard() {
  const {
    游戏,
    我自己,
    是我的回合,
    选中的卡牌,
    set选中的卡牌,
    playerOps,
    处理出牌,
    处理结束回合,
    handleSaveLog,
  } = useGame();

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
        {!是我的回合 && <span style={{ color: '#f39c12', marginLeft: 12 }}>等待对手...</span>}
      </div>

      <div style={{ marginBottom: 20 }}>
        <HandCards
          手牌={我自己.手牌}
          选中索引={选中的卡牌}
          选择卡牌={(索引) => set选中的卡牌(索引 === -1 ? null : 索引)}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <ActionPanel
          能出牌={选中的卡牌 !== null && 是我的回合 && 游戏.当前阶段 === '出牌'}
          能结束回合={是我的回合 && 游戏.当前阶段 === '出牌'}
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
