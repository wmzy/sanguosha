import { useState, useCallback } from 'react';
import type { GameLog } from '../../shared/log';
import { ReplayEngine } from '../../engine/replay';
import { ReplayControls } from './ReplayControls';
import { PlayerPanel } from './PlayerPanel';
import { LogPanel } from './LogPanel';

interface ReplayBoardProps {
  log: GameLog;
  onExit: () => void;
}

export function ReplayBoard({ log, onExit }: ReplayBoardProps) {
  const [engine] = useState(() => ReplayEngine.create(log));
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState(log.meta.characters[0]);

  const state = engine.getCurrentState();
  const playerView = engine.getPlayerView(selectedPlayer);

  const handlePrev = useCallback(() => {
    engine.prev();
    setCurrentStep(engine.getCurrentStep());
  }, [engine]);

  const handleNext = useCallback(() => {
    engine.next();
    setCurrentStep(engine.getCurrentStep());
  }, [engine]);

  const handleGoTo = useCallback((step: number) => {
    engine.goTo(step);
    setCurrentStep(engine.getCurrentStep());
  }, [engine]);

  const currentOp = engine.getCurrentOp();

  return (
    <div style={{ padding: 20, backgroundColor: '#1a1a2e', minHeight: '100vh', color: '#eee' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>重播模式</h1>
        <button onClick={onExit} style={exitBtnStyle}>退出重播</button>
      </div>

      <ReplayControls
        currentStep={currentStep}
        totalSteps={engine.getTotalSteps()}
        onPrev={handlePrev}
        onNext={handleNext}
        onGoTo={handleGoTo}
        players={log.meta.characters}
        selectedPlayer={selectedPlayer}
        onSelectPlayer={setSelectedPlayer}
      />

      {currentOp && (
        <div style={{
          backgroundColor: '#2c3e50',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          fontSize: 14,
        }}
        >
          <span style={{ color: '#e74c3c' }}>当前操作:</span> {currentOp.description}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 20 }}>
        {playerView.players.map(player => (
          <PlayerPanel
            key={player.name}
            player={{ ...player, hand: player.hand ?? [] }}
            isCurrentPlayer={player.name === state.currentPlayer}
            isSelf={player.name === selectedPlayer}
          />
        ))}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        回合 {state.round} | 阶段: {state.phase} | 当前玩家: {state.currentPlayer}
      </div>

      <LogPanel operations={log.playerOps[selectedPlayer] ?? []} maxHeight={300} />
    </div>
  );
}

const exitBtnStyle: React.CSSProperties = {
  padding: '8px 20px',
  backgroundColor: '#7f8c8d',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
