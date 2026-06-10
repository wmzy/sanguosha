// src/client/components/GameView.tsx
// 新 ENGINE-DESIGN 游戏视图 — 渲染 GameView + 发 ClientMessage
import { useState } from 'react';
import type { GameView as EngineGameView, Card, Json, PendingView } from '../../engine/types';
import type { ClientMessage as EngineClientMessage } from '../../engine/types';

interface Props {
  view: EngineGameView;
  playerNames: string[];
  onAction: (action: EngineClientMessage) => void;
  onDeleteRoom: () => void;
}

const S: Record<string, React.CSSProperties> = {
  root: { padding: 16, fontFamily: 'monospace', background: '#1a1a2e', color: '#e0e0e0', minHeight: '100vh' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  phase: { color: '#ffd700', fontSize: 14 },
  playerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 },
  playerCard: { border: '1px solid #444', borderRadius: 8, padding: 12, background: '#16213e' },
  playerCardActive: { border: '2px solid #ffd700', boxShadow: '0 0 8px rgba(255,215,0,0.3)' },
  playerCardDead: { opacity: 0.4 },
  hp: { color: '#e74c3c', fontWeight: 'bold' as const },
  hpFull: { color: '#2ecc71' },
  skill: { display: 'inline-block', background: '#0f3460', borderRadius: 4, padding: '2px 6px', margin: '0 2px', fontSize: 12 },
  equipment: { fontSize: 12, color: '#8899aa' },
  marks: { fontSize: 11, color: '#aaa' },
  handSection: { marginBottom: 16 },
  handTitle: { fontSize: 14, marginBottom: 8, color: '#aaa' },
  cardList: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  card: { border: '1px solid #555', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', background: '#16213e', minWidth: 80, textAlign: 'center' as const },
  cardSelected: { border: '2px solid #3498db', background: '#1a3a5c' },
  cardName: { fontWeight: 'bold' as const, fontSize: 14 },
  cardSuit: { fontSize: 12, color: '#aaa' },
  pendingBox: { border: '2px solid #e67e22', borderRadius: 8, padding: 12, background: '#2c1a0e', marginBottom: 16 },
  pendingTitle: { color: '#e67e22', fontWeight: 'bold' as const, marginBottom: 8 },
  targetList: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  targetBtn: { border: '1px solid #888', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', background: '#16213e', color: '#e0e0e0' },
  targetBtnSelected: { border: '2px solid #e74c3c', background: '#3a1a1a' },
  actionBtn: { border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', background: '#27ae60', color: '#fff', fontWeight: 'bold' as const, fontSize: 14 },
  actionBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' as const },
  backBtn: { border: '1px solid #888', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', background: 'transparent', color: '#e0e0e0' },
};

export function GameViewComponent({ view, playerNames, onAction, onDeleteRoom }: Props) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const viewerIdx = view.viewer;
  const viewerName = playerNames[viewerIdx] ?? `P${viewerIdx}`;
  const viewerHand = view.players[viewerIdx]?.hand ?? [];
  const currentPlayerName = playerNames[view.currentPlayerIndex] ?? `P${view.currentPlayerIndex}`;

  function sendAction(skillId: string, actionType: string, params: Record<string, Json>) {
    onAction({ skillId, actionType, ownerId: viewerName, params });
    setSelectedCardId(null);
    setSelectedTarget(null);
  }

  function handleUseCard(card: Card) {
    if (card.name === '杀' || card.name === '酒') {
      // 需要选目标
      if (selectedCardId === card.id && selectedTarget) {
        sendAction(card.name, 'use', { cardId: card.id, targets: [selectedTarget] });
      } else {
        setSelectedCardId(card.id);
        setSelectedTarget(null);
      }
    } else if (card.name === '桃') {
      // 桃可以对自己使用
      sendAction('桃', 'use', { cardId: card.id, target: viewerName });
    } else if (card.name === '闪') {
      // 闪是回应技能，不需要主动使用
    } else {
      // 其他牌，选目标后出
      if (selectedCardId === card.id && selectedTarget) {
        sendAction(card.name, 'use', { cardId: card.id, targets: [selectedTarget] });
      } else {
        setSelectedCardId(card.id);
        setSelectedTarget(null);
      }
    }
  }

  function handleRespond(card: Card) {
    if (!view.pending) return;
    sendAction(card.name, 'respond', { cardId: card.id });
  }

  function handleTargetClick(name: string) {
    setSelectedTarget(selectedTarget === name ? null : name);
  }

  const isAwaitingResponse = view.pending !== null && view.pending.target === viewerName;

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <button style={S.backBtn} onClick={onDeleteRoom}>← 退出</button>
          <span style={{ marginLeft: 12, ...S.phase }}>
            回合 {view.turn.round} · {view.phase} · 当前: {currentPlayerName}
          </span>
        </div>
        <span style={{ color: '#666', fontSize: 12 }}>seq: {view.turn.round}</span>
      </div>

      {/* Pending prompt */}
      {view.pending && <PendingPromptView pending={view.pending} playerNames={playerNames} />}

      {/* Players */}
      <div style={S.playerGrid}>
        {view.players.map((p, i) => {
          const name = playerNames[i] ?? `P${i}`;
          const isActive = i === view.currentPlayerIndex;
          const isViewer = i === viewerIdx;
          const hpColor = p.health >= p.maxHealth ? S.hpFull : S.hp;
          return (
            <div
              key={i}
              style={{
                ...S.playerCard,
                ...(isActive ? S.playerCardActive : {}),
                ...(!p.alive ? S.playerCardDead : {}),
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 'bold' }}>
                  {name} {isViewer && '(你)'} {!p.alive && '💀'}
                </span>
                <span style={hpColor}>{p.health}/{p.maxHealth}</span>
              </div>
              <div style={{ marginBottom: 4 }}>
                {p.skills.map(s => <span key={s} style={S.skill}>{s}</span>)}
              </div>
              <div style={S.equipment}>
                手牌: {p.handCount}
                {Object.entries(p.equipment).map(([slot, cardId]) => (
                  <span key={slot} style={{ marginLeft: 8 }}> [{slot}:{cardId}]</span>
                ))}
              </div>
              {p.marks.length > 0 && (
                <div style={S.marks}>
                  标记: {p.marks.map(m => `${m.id}${m.payload ? `(${JSON.stringify(m.payload)})` : ''}`).join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Viewer hand */}
      <div style={S.handSection}>
        <div style={S.handTitle}>你的手牌 ({viewerHand.length})</div>
        <div style={S.cardList}>
          {viewerHand.map(card => {
            const isSelected = selectedCardId === card.id;
            const canUse = view.currentPlayerIndex === viewerIdx || isAwaitingResponse;
            return (
              <div
                key={card.id}
                style={{ ...S.card, ...(isSelected ? S.cardSelected : {}), ...(!canUse ? { opacity: 0.5 } : {}) }}
                onClick={() => canUse && handleUseCard(card)}
              >
                <div style={S.cardName}>{card.name}</div>
                <div style={S.cardSuit}>{card.suit}{card.rank}</div>
                {isAwaitingResponse && (card.name === '闪' || card.name === '杀') && (
                  <button
                    style={{ marginTop: 4, fontSize: 11, cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); handleRespond(card); }}
                  >
                    回应
                  </button>
                )}
              </div>
            );
          })}
          {viewerHand.length === 0 && <span style={{ color: '#666' }}>无手牌</span>}
        </div>
      </div>

      {/* Target selection */}
      {selectedCardId && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 8, color: '#aaa' }}>选择目标:</div>
          <div style={S.targetList}>
            {view.players.map((p, i) => {
              const name = playerNames[i] ?? `P${i}`;
              if (!p.alive || i === viewerIdx) return null;
              return (
                <button
                  key={i}
                  style={{ ...S.targetBtn, ...(selectedTarget === name ? S.targetBtnSelected : {}) }}
                  onClick={() => handleTargetClick(name)}
                >
                  {name} (HP {p.health})
                </button>
              );
            })}
          </div>
          {selectedTarget && (
            <button
              style={{ ...S.actionBtn, marginTop: 8 }}
              onClick={() => {
                const card = viewerHand.find(c => c.id === selectedCardId);
                if (card) handleUseCard(card);
              }}
            >
              确认出牌
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PendingPromptView({ pending, playerNames }: { pending: PendingView; playerNames: string[] }) {
  const targetName = playerNames[0] ?? '???'; // pending.target is player name
  return (
    <div style={S.pendingBox}>
      <div style={S.pendingTitle}>等待回应: {pending.target}</div>
      <div style={{ fontSize: 13 }}>
        提示: {pending.prompt.title}
        {pending.prompt.description && <span style={{ color: '#aaa' }}> — {pending.prompt.description}</span>}
      </div>
    </div>
  );
}
