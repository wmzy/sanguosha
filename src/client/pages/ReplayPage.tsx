// src/client/pages/ReplayPage.tsx
// 回放页:加载录像文件,用 useReplay 驱动,复用 GameViewComponent 只读渲染。
// 进入方式:首页"加载录像回放" → 选文件 → 跳转 /replay(state 传 ReplayFile)。

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useReplay } from '../hooks/useReplay';
import { ReplayControls } from '../components/ReplayControls';
import { GameViewComponent } from '../components/GameView';
import { Loading } from '../components/Loading';
import { pageStyle } from '../theme';
import type { ActionMsg } from '../types';
import type { ReplayFile } from '../replay/types';
import type { GameView as EngineGameView } from '../../engine/types';

/** 从 router state 取 ReplayFile */
function useReplayFileFromLocation(): ReplayFile | null {
  const loc = useLocation();
  const state = loc.state as { file?: ReplayFile } | null;
  return state?.file ?? null;
}

const noop = (_action: ActionMsg) => {
  /* 回放模式只读,不接受操作 */
};

export function ReplayPage() {
  const navigate = useNavigate();
  const file = useReplayFileFromLocation();

  const handleExit = useCallback(() => {
    navigate('/');
  }, [navigate]);

  if (!file) {
    return (
      <div className={pageStyle}>
        <p>未加载录像文件。</p>
        <button onClick={handleExit}>返回首页</button>
      </div>
    );
  }

  return <ReplayView file={file} onExit={handleExit} />;
}

function ReplayView({ file, onExit }: { file: ReplayFile; onExit: () => void }) {
  const r = useReplay(file);

  if (!r.view) {
    return <Loading />;
  }

  // 回放模式:传入只读 view,禁用交互
  return (
    <div className={pageStyle} style={{ padding: 0 }}>
      <ReplayControls
        step={r.step}
        total={r.total}
        seat={r.seat}
        seats={r.seats}
        playing={r.playing}
        speed={r.speed}
        onPrev={r.prev}
        onNext={r.next}
        onGoTo={r.goTo}
        onTogglePlay={r.togglePlay}
        onSetSpeed={r.setSpeed}
        onSetSeat={r.setSeat}
        onExit={onExit}
      />
      <GameViewComponent view={r.view as EngineGameView} onAction={noop} />
    </div>
  );
}
