import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/Loading';
import { NarrowScreenHint } from './components/NarrowScreenHint';
import { RequirePlayerId } from './components/RequirePlayerId';
import { globalReset } from './theme';
import { useAudioUnlock } from './hooks/useAudioUnlock';
import { useResourcePacks } from './hooks/useResourcePacks';

// 路由级代码分割：仅顶层页面组件做 lazy 加载，共享组件由页面 chunk 内部静态导入。
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const DebugPage = lazy(() => import('./pages/DebugPage').then((m) => ({ default: m.DebugPage })));
const MultiplayerPage = lazy(() =>
  import('./pages/MultiplayerPage').then((m) => ({ default: m.MultiplayerPage })),
);
const ReplayPage = lazy(() => import('./pages/ReplayPage').then((m) => ({ default: m.ReplayPage })));

export function App() {
  // 首次用户交互后解锁 AudioContext(浏览器自动播放策略要求)
  useAudioUnlock();
  // 初始化 ResourceManager，触发 fetch /packs/index.json
  useResourcePacks();
  return (
    <div className={globalReset}>
      {/* 窄屏提示条:全局常驻(fixed 覆盖层),关闭状态随会话存活,宽屏不渲染 */}
      <NarrowScreenHint />
      <ErrorBoundary context="root">
        <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/play" element={<RequirePlayerId><MultiplayerPage /></RequirePlayerId>} />
              <Route path="/play/:roomId" element={<RequirePlayerId><MultiplayerPage /></RequirePlayerId>} />
              <Route path="/debug" element={<RequirePlayerId><DebugPage /></RequirePlayerId>} />
              <Route path="/debug/:roomId" element={<RequirePlayerId><DebugPage /></RequirePlayerId>} />
              <Route path="/replay" element={<ReplayPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    </div>
  );
}
