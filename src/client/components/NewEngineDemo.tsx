// src/client/components/NewEngineDemo.tsx
// 新 ENGINE-DESIGN 引擎试用(DebugLobby 复刻的 client-side 演示)
import { useState, useEffect, useRef } from 'react';
import { createEngine, type EngineInstance } from '../../engine/create-engine';
import '../../engine/atoms';
import '../../engine/skills';
import type { Card, GameState, Json, Mark } from '../../engine/types';
import { buildView } from '../../engine/view/buildView';

function buildInitialState(playerCount: number): GameState {
  const cards: Card[] = [
    { id: 'c1', name: '杀', suit: '♠', rank: 1, type: '基本牌' },
    { id: 'c2', name: '杀', suit: '♠', rank: 2, type: '基本牌' },
    { id: 'c3', name: '闪', suit: '♥', rank: 1, type: '基本牌' },
    { id: 'c4', name: '桃', suit: '♥', rank: 1, type: '基本牌' },
  ];
  const characterSkills: Array<[string, string, string[]]> = [
    ['P1', '主公', ['杀']],
    ['P2', '刘备', ['杀', '仁德']],
    ['P3', '曹操', ['杀', '护甲']],
    ['P4', '孙权', ['杀', '制衡']],
    ['P5', '关羽', ['杀', '武圣']],
    ['P6', '郭嘉', ['杀', '遗计']],
  ];
  const players = Array.from({ length: playerCount }, (_, i) => {
    const slot = characterSkills[i] ?? [`P${i + 1}`, '通用', []];
    return {
      index: i,
      name: slot[0],
      character: slot[1],
      health: 4,
      maxHealth: 4,
      alive: true,
      hand: [cards[i % cards.length].id, cards[(i + 1) % cards.length].id],
      equipment: {} as Record<string, string>,
      skills: slot[2],
      vars: {} as Record<string, Json>,
      marks: [] as Mark[],
      pendingTricks: [],
    };
  });
  return {
    players,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    zones: { deck: [], discardPile: [], processing: [] },
    settlementStack: [],
    cardMap: Object.fromEntries(cards.map(c => [c.id, c])),
    rngSeed: 1,
    marks: [],
    localVars: {},
    meta: { gameId: 'demo', createdAt: 0 },
    seq: 0,
    startedAt: 0,
    actionLog: [],
  };
}

export function NewEngineDemo() {
  const [playerCount, setPlayerCount] = useState(4);
  const [state, setState] = useState<GameState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const engineRef = useRef<EngineInstance | null>(null);

  useEffect(() => {
    const engine = createEngine();
    engine.resetForTest();
    const initial = buildInitialState(playerCount);
    const bootstrapped = engine.bootstrap(initial);
    engineRef.current = engine;
    setState(bootstrapped);
    setLog([`已启动 ${playerCount} 人新引擎(CLIENT-SIDE)`]);
  }, [playerCount]);

  async function dispatch(skillId: string, actionType: string, ownerId: string, params: Record<string, unknown>) {
    if (!engineRef.current || !state) return;
    const next = await engineRef.current.dispatch(state, {
      skillId,
      actionType,
      ownerId,
      params: params as Record<string, never>,
      baseSeq: state.seq,
    });
    setState(next);
    setLog(prev => [...prev, `dispatch: ${skillId}/${actionType} by ${ownerId}`]);
  }

  if (!state) return <div>加载中...</div>;

  const view = buildView(state, 0);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const currentView = view.players[0];
  const otherTarget = state.players.find(p => p.index !== currentPlayer.index);

  return (
    <div style={{ padding: 16, fontFamily: 'monospace' }}>
      <h2>新 ENGINE-DESIGN 引擎试用(CLIENT-SIDE)</h2>
      <p>不连 server,浏览器直接调 createEngine().dispatch()</p>

      <section style={{ marginBottom: 16 }}>
        <label>
          玩家数:
          <select value={playerCount} onChange={e => setPlayerCount(Number(e.target.value))} style={{ marginLeft: 8 }}>
            {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </section>

      <section style={{ marginBottom: 16 }}>
        <h3>当前玩家: {currentPlayer.name} ({currentPlayer.character}) HP {currentView.health}/{currentView.maxHealth}</h3>
        <p>手牌:
          {currentView.hand?.map(c => (
            <span key={c.id} style={{ margin: '0 4px', padding: '2px 6px', border: '1px solid #888' }}>
              {c.name}({c.suit}{c.rank})
              {c.name === '杀' && otherTarget && (
                <button
                  onClick={() => dispatch('杀', 'use', currentPlayer.name, { cardId: c.id, targets: [otherTarget.name] })}
                  style={{ marginLeft: 4, fontSize: 12 }}
                >出杀→{otherTarget.name}</button>
              )}
            </span>
          ))}
        </p>
      </section>

      <section style={{ marginBottom: 16 }}>
        <h3>演示:任意 player 手动 dispatch</h3>
        <p>任意玩家可手动触发 action(测试新 engine API 端到端跑通)</p>
        <button
          onClick={() => {
            const target = state.players[1];
            if (target) dispatch('闪', 'respond', target.name, { cardId: 'c3' });
          }}
          style={{ fontSize: 12 }}
        >P2 出闪(模拟回应)</button>
        <button
          onClick={() => {
            const p2 = state.players[1];
            if (p2) dispatch('桃', 'use', p2.name, { cardId: 'c4', target: p2.name });
          }}
          style={{ fontSize: 12, marginLeft: 8 }}
        >P2 出桃(回复 1 血)</button>
      </section>

      <section style={{ marginBottom: 16 }}>
        <h3>所有玩家</h3>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #888', padding: 4 }}>#</th>
              <th style={{ border: '1px solid #888', padding: 4 }}>名</th>
              <th style={{ border: '1px solid #888', padding: 4 }}>角色</th>
              <th style={{ border: '1px solid #888', padding: 4 }}>HP</th>
              <th style={{ border: '1px solid #888', padding: 4 }}>技能</th>
            </tr>
          </thead>
          <tbody>
            {state.players.map((p, i) => (
              <tr key={p.name}>
                <td style={{ border: '1px solid #888', padding: 4 }}>{i}</td>
                <td style={{ border: '1px solid #888', padding: 4 }}>{p.name}</td>
                <td style={{ border: '1px solid #888', padding: 4 }}>{p.character}</td>
                <td style={{ border: '1px solid #888', padding: 4 }}>{p.health}/{p.maxHealth}</td>
                <td style={{ border: '1px solid #888', padding: 4 }}>{p.skills.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Dispatch 日志</h3>
        <ul style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #888', padding: 8 }}>
          {log.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      </section>
    </div>
  );
}
