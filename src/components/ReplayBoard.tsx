import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GameLog, Operation } from '../../shared/log';
import { ReplayEngine } from '../../engine/replay';
import { loadLog } from '../utils/logFile';
import { LogPanel } from './LogPanel';
import { ReplayControls } from './ReplayControls';
import { colors } from '../theme';

interface ReplayBoardProps {
  log: GameLog;
  onClose: () => void;
}

export function ReplayBoard({ log, onClose }: ReplayBoardProps) {
  const [currentLog, setCurrentLog] = useState<GameLog>(log);
  const [currentStep, setCurrentStep] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedPerspective, setSelectedPerspective] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Track the log identity to know when to rebuild the engine
  const logRef = useRef<GameLog>(currentLog);
  const engineRef = useRef<ReplayEngine>(new ReplayEngine(currentLog));

  if (logRef.current !== currentLog) {
    logRef.current = currentLog;
    engineRef.current = new ReplayEngine(currentLog);
  }
  const engine = engineRef.current;

  const totalSteps = engine.getTotalSteps();
  const perspectives = currentLog.meta.characters;

  // Initialize selectedPerspective from log meta
  useEffect(() => {
    if (perspectives.length > 0 && !perspectives.includes(selectedPerspective)) {
      setSelectedPerspective(perspectives[0]);
    }
  }, [perspectives, selectedPerspective]);

  // Sync step index when engine rebuilds
  useEffect(() => {
    setCurrentStep((prev) => Math.min(prev, totalSteps - 1));
  }, [totalSteps]);

  const handleNext = useCallback(() => {
    engine.next();
    setCurrentStep(engine.getCurrentIndex());
  }, [engine]);

  const handlePrev = useCallback(() => {
    engine.prev();
    setCurrentStep(engine.getCurrentIndex());
  }, [engine]);

  const handleGoTo = useCallback(
    (step: number) => {
      engine.goTo(step);
      setCurrentStep(engine.getCurrentIndex());
    },
    [engine],
  );

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  // Auto-play interval
  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = 1000 / speed;
    const id = setInterval(() => {
      const eng = engineRef.current;
      const idx = eng.getCurrentIndex();
      if (idx >= eng.getTotalSteps() - 1) {
        setIsPlaying(false);
        return;
      }
      eng.next();
      setCurrentStep(eng.getCurrentIndex());
    }, intervalMs);
    return () => clearInterval(id);
  }, [isPlaying, speed]);

  // File upload handler
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        setError(null);
        const newLog = await loadLog(file);
        setCurrentLog(newLog);
        setCurrentStep(0);
        setIsPlaying(false);
        setSelectedPerspective('');
        // Engine will be rebuilt on next render via logRef check
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    },
    [],
  );

  // Get current state — goTo is idempotent if already at step
  const replayStep = engine.goTo(currentStep);
  const gameState = replayStep.state;

  // Build player summaries from GameState
  const playerSummaries = useMemo(() => {
    return gameState.playerOrder.map((name) => {
      const p = gameState.players[name];
      const isAlive = p?.info.alive ?? false;
      return {
        name,
        character: p?.info.characterId ?? name,
        health: p?.health ?? 0,
        maxHealth: p?.maxHealth ?? 0,
        handSize: p?.hand.length ?? 0,
        alive: isAlive,
      };
    });
  }, [gameState]);

  // Get log operations up to current step
  const logOps: Operation[] = useMemo(() => {
    if (selectedPerspective) {
      return engine.getPlayerOps(selectedPerspective, currentStep + 1);
    }
    return currentLog.serverOps.slice(0, currentStep + 1);
  }, [engine, selectedPerspective, currentStep, currentLog.serverOps]);

  return (
    <div style={pageStyle}>
      <ReplayControls
        currentStep={currentStep}
        totalSteps={totalSteps}
        speed={speed}
        isPlaying={isPlaying}
        perspectives={perspectives}
        selectedPerspective={selectedPerspective || perspectives[0] || ''}
        onPrev={handlePrev}
        onNext={handleNext}
        onGoTo={handleGoTo}
        onTogglePlay={handleTogglePlay}
        onSpeedChange={setSpeed}
        onPerspectiveChange={setSelectedPerspective}
        onClose={onClose}
      />

      <div style={mainAreaStyle}>
        <div style={boardStyle}>
          <div style={boardHeaderStyle}>回放状态（第 {currentStep + 1} 步 / 共 {totalSteps} 步）</div>
          <div style={playersGridStyle}>
            {playerSummaries.map((p) => (
              <div
                key={p.name}
                style={{
                  ...playerCardStyle,
                  opacity: p.alive ? 1 : 0.5,
                  border:
                    p.name === selectedPerspective
                      ? `2px solid ${colors.accent.blue}`
                      : '2px solid transparent',
                }}
              >
                <div style={playerNameStyle}>
                  {p.name}
                  {p.name === selectedPerspective && ' 👁'}
                </div>
                <div style={charStyle}>{p.character}</div>
                <div style={healthStyle}>
                  ❤ {p.health}/{p.maxHealth}
                </div>
                <div style={handStyle}>手牌: {p.handSize}</div>
                <div style={statusStyle}>{p.alive ? '存活' : '阵亡'}</div>
              </div>
            ))}
          </div>
          <div style={infoRowStyle}>
            <span>回合: {gameState.meta.round}</span>
            <span style={{ marginLeft: 16 }}>当前阶段: {gameState.phase}</span>
            <span style={{ marginLeft: 16 }}>当前玩家: {gameState.currentPlayer}</span>
          </div>
        </div>

        <div style={logAreaStyle}>
          <LogPanel operations={logOps} maxHeight={320} />
        </div>
      </div>

      <div style={footerStyle}>
        <label style={uploadLabelStyle}>
          📂 加载其他录像文件
          <input
            type="file"
            accept=".json"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </label>
        {error && <div style={errorStyle}>{error}</div>}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 16,
  minHeight: '100vh',
  backgroundColor: colors.bg.page,
  color: colors.text.primary,
};

const mainAreaStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  flex: 1,
};

const boardStyle: React.CSSProperties = {
  flex: 1,
  backgroundColor: colors.bg.panel,
  borderRadius: 8,
  padding: 12,
};

const boardHeaderStyle: React.CSSProperties = {
  fontSize: 14,
  color: colors.text.secondary,
  marginBottom: 10,
  fontWeight: 'bold',
};

const playersGridStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const playerCardStyle: React.CSSProperties = {
  backgroundColor: colors.bg.input,
  borderRadius: 6,
  padding: '8px 12px',
  minWidth: 120,
};

const playerNameStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 'bold',
  color: colors.text.primary,
};

const charStyle: React.CSSProperties = {
  fontSize: 12,
  color: colors.text.dim,
  marginTop: 2,
};

const healthStyle: React.CSSProperties = {
  fontSize: 13,
  color: colors.accent.red,
  marginTop: 4,
};

const handStyle: React.CSSProperties = {
  fontSize: 12,
  color: colors.text.secondary,
  marginTop: 2,
};

const statusStyle: React.CSSProperties = {
  fontSize: 11,
  marginTop: 4,
  color: colors.accent.green,
};

const infoRowStyle: React.CSSProperties = {
  marginTop: 12,
  fontSize: 13,
  color: colors.text.secondary,
  borderTop: `1px solid ${colors.bg.input}`,
  paddingTop: 8,
};

const logAreaStyle: React.CSSProperties = {
  width: 320,
  flexShrink: 0,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0',
};

const uploadLabelStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 14px',
  backgroundColor: colors.accent.blue,
  color: colors.white,
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const errorStyle: React.CSSProperties = {
  color: colors.accent.red,
  fontSize: 13,
};
