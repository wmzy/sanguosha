import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/Loading';

// 路由级代码分割：仅顶层页面组件做 lazy 加载，共享组件由页面 chunk 内部静态导入。
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const DebugPage = lazy(() => import('./pages/DebugPage').then((m) => ({ default: m.DebugPage })));
const LobbyPage = lazy(() => import('./pages/LobbyPage').then((m) => ({ default: m.LobbyPage })));
const MultiplayerPage = lazy(() =>
  import('./pages/MultiplayerPage').then((m) => ({ default: m.MultiplayerPage })),
);

export function App() {
  return (
    <ErrorBoundary context="root">
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/debug" element={<DebugPage />} />
            <Route path="/debug/:roomId" element={<DebugPage />} />
            <Route path="/lobby" element={<LobbyPage />} />
            <Route path="/game/:roomId" element={<MultiplayerPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
