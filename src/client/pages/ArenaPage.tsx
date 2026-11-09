import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ArenaManifest } from '../../arena/types';
import type { GameView } from '../../engine/types';
import type { ChatMessage } from '../headless/types';
import { useResourcePacks } from '../hooks/useResourcePacks';
import { GameViewScaler } from '../components/GameViewScaler';
import { ArenaTable } from '../components/arena/ArenaTable';
import './arena.css';

interface ArenaMatchResponse {
  manifest: ArenaManifest;
  audience: { seq: number; at: number; view: GameView } | null;
  publicChat: ChatMessage[];
}
const statusLabels = {
  preparing: '准备中',
  playing: '对局中',
  completed: '已结束',
  interrupted: '已中断',
};

export function ArenaPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const [matches, setMatches] = useState<ArenaManifest[]>([]);
  const [detail, setDetail] = useState<ArenaMatchResponse | null>(null);
  const [error, setError] = useState('');
  const [dock, setDock] = useState<'matches' | 'chat' | 'log' | null>(null);
  const [clean, setClean] = useState(false);
  const { ready } = useResourcePacks();

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/arena');
        if (!response.ok) throw new Error(`对局列表读取失败（${response.status}）`);
        const data = (await response.json()) as { matches: ArenaManifest[] };
        if (active) {
          setMatches(data.matches);
          setError('');
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '对局列表读取失败');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setDetail(null);
    if (!matchId)
      return () => {
        active = false;
      };
    const load = async () => {
      try {
        const response = await fetch(`/api/arena/${encodeURIComponent(matchId)}`);
        if (!response.ok) throw new Error(`对局读取失败（${response.status}）`);
        const data = (await response.json()) as ArenaMatchResponse;
        if (active) {
          setDetail(data);
          setError('');
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '对局读取失败');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [matchId]);

  const view = detail?.audience?.view;
  const toggleDock = (tab: typeof dock) => setDock(dock === tab ? null : tab);
  const fullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  return (
    <main className={`arena-page ${clean ? 'arena-clean' : ''}`} data-testid="arena-page">
      <GameViewScaler>
        <div className="arena-shell">
          <header className="arena-topbar">
            <Link className="arena-brand" to="/arena">
              <span className="arena-seal">杀</span>
              <span>
                演武场<small>群雄对弈</small>
              </span>
            </Link>
            <div className="arena-match-heading">
              <strong>{detail?.manifest.name ?? '三国杀 · AI 演练台'}</strong>
              <span>
                {detail ? statusLabels[detail.manifest.status] : '观战大厅'}
                {view ? ` · ${view.players.length}人身份场` : ''}
              </span>
            </div>
            <nav className="arena-tools" aria-label="观战工具">
              <button aria-expanded={dock === 'matches'} onClick={() => toggleDock('matches')}>
                对局归档
              </button>
              <button aria-expanded={dock === 'chat'} onClick={() => toggleDock('chat')}>
                公共发言
              </button>
              <button aria-expanded={dock === 'log'} onClick={() => toggleDock('log')}>
                战报
              </button>
              <button
                aria-pressed={clean}
                onClick={() => {
                  setClean(!clean);
                  setDock(null);
                }}
              >
                {clean ? '恢复界面' : '纯净观战'}
              </button>
              <button onClick={fullScreen} aria-label="切换全屏">
                全屏
              </button>
            </nav>
          </header>
          {(error || detail?.manifest.error) && (
            <div className="arena-error" role="status" data-testid="arena-error">
              {error || detail?.manifest.error}
            </div>
          )}
          <div className="arena-stage">
            {view && detail ? (
              <ArenaTable view={view} manifest={detail.manifest} assetsReady={ready} />
            ) : (
              <section
                className="arena-lobby"
                data-testid={matchId ? 'arena-waiting' : 'arena-empty-selection'}
              >
                <div className="arena-lobby-mark">三国杀</div>
                <h1>{matchId ? '静候群雄入席' : '群雄聚首，开局见真章'}</h1>
                <p>{matchId ? '正在等待公开牌桌状态…' : '选择一场对局，进入观众牌桌。'}</p>
                {!matchId && (
                  <div className="arena-lobby-matches">
                    {matches.length ? (
                      matches.slice(0, 6).map((match) => (
                        <Link key={match.id} to={`/arena/${encodeURIComponent(match.id)}`}>
                          <span>
                            {match.name}
                            <small>
                              {match.players.length}人 · {statusLabels[match.status]}
                            </small>
                          </span>
                          <b>观战 →</b>
                        </Link>
                      ))
                    ) : (
                      <p>暂无对局，启动 AI 对局后将在这里出现。</p>
                    )}
                  </div>
                )}
              </section>
            )}
            {dock && (
              <aside
                className="arena-dock"
                aria-label={dock === 'matches' ? '对局归档' : dock === 'chat' ? '公共发言' : '战报'}
              >
                <header>
                  <h2>
                    {dock === 'matches' ? '对局归档' : dock === 'chat' ? '公共发言' : '战场纪事'}
                  </h2>
                  <button onClick={() => setDock(null)} aria-label="关闭侧栏">
                    ×
                  </button>
                </header>
                <div
                  className="arena-dock-body"
                  data-testid={
                    dock === 'matches'
                      ? 'arena-match-list'
                      : dock === 'chat'
                        ? 'arena-public-chat'
                        : 'arena-log'
                  }
                >
                  {dock === 'matches' &&
                    (matches.length ? (
                      matches.map((match) => (
                        <Link
                          className={matchId === match.id ? 'is-selected' : ''}
                          key={match.id}
                          to={`/arena/${encodeURIComponent(match.id)}`}
                          onClick={() => setDock(null)}
                          data-testid={`arena-match-${match.id}`}
                        >
                          <strong>{match.name}</strong>
                          <small>
                            {statusLabels[match.status]} · {match.players.length}人
                          </small>
                          <p>{match.players.map((player) => player.name).join(' · ')}</p>
                        </Link>
                      ))
                    ) : (
                      <p>暂无对局</p>
                    ))}
                  {dock === 'chat' &&
                    (detail?.publicChat.length ? (
                      detail.publicChat.slice(-80).map((message, i) => (
                        <div className="arena-chat-line" key={`${message.timestamp}-${i}`}>
                          <small>
                            {new Date(message.timestamp).toLocaleTimeString()}{' '}
                            <b>〔{message.seatIndex + 1}号位〕</b>
                          </small>
                          <p>{message.text}</p>
                        </div>
                      ))
                    ) : (
                      <p className="arena-muted">尚无公共发言</p>
                    ))}
                  {dock === 'log' &&
                    (view?.log.length ? (
                      view.log
                        .slice(-100)
                        .reverse()
                        .map((entry, i) => (
                          <div className="arena-log-line" key={`${entry.time}-${i}`}>
                            <small>{entry.player >= 0 ? `${entry.player + 1}号位` : '战场'}</small>
                            <p>{entry.text}</p>
                          </div>
                        ))
                    ) : (
                      <p className="arena-muted">静候开局</p>
                    ))}
                </div>
              </aside>
            )}
          </div>
          <footer className="arena-footer">
            <span>
              <i />
              观众视角 · 全席手牌公开
            </span>
            <span>主公明置 · 阵亡亮身份 · 牌堆不公开</span>
            <span data-testid="arena-refresh">
              每秒同步{detail?.audience ? ` · 第 ${detail.audience.seq} 帧` : ''}
            </span>
          </footer>
        </div>
      </GameViewScaler>
    </main>
  );
}
