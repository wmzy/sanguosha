// src/client/components/GameView.tsx
// 新 ENGINE-DESIGN 游戏视图 — 真实可玩
import { useState, useCallback } from 'react';
import type { GameView as EngineGameView, Card, Json } from '../../engine/types';

/** 发给 controller 的 action(不含 baseSeq,controller 自动加) */
interface ActionMsg {
  skillId: string;
  actionType: string;
  ownerId: string;
  params: Record<string, Json>;
}

interface Props {
  view: EngineGameView;
  onAction: (action: ActionMsg) => void;
  onDeleteRoom: () => void;
}


const PHASE_LABELS: Record<string, string> = {
  '准备': '准备阶段',
  '判定': '判定阶段',
  '摸牌': '摸牌阶段',
  '出牌': '出牌阶段',
  '弃牌': '弃牌阶段',
  '回合结束': '回合结束',
};

const SUIT_COLORS: Record<string, string> = { '♠': '#e0e0e0', '♣': '#e0e0e0', '♥': '#e74c3c', '♦': '#e74c3c' };

export function GameViewComponent({ view, onAction, onDeleteRoom }: Props) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const viewer = view.players[view.viewer];
  const viewerName = viewer?.name ?? `P${view.viewer}`;
  const viewerHand = viewer?.hand ?? [];
  const currentPlayer = view.players[view.currentPlayerIndex];
  const isMyTurn = view.currentPlayerIndex === view.viewer;
  const pending = view.pending;
  const isAwaitingResponse = pending !== null && pending.target === viewerName;

  const send = useCallback((skillId: string, actionType: string, params: Record<string, Json>) => {
    onAction({ skillId, actionType, ownerId: viewerName, params });
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [onAction, viewerName]);

  // 使用卡牌
  function handleCardClick(card: Card) {
    if (!isMyTurn && !isAwaitingResponse) return;

    // 回应模式: 闪/杀
    if (isAwaitingResponse) {
      if (card.name === '闪' || card.name === '杀') {
        send(card.name, 'respond', { cardId: card.id });
      }
      return;
    }

    // 出牌模式
    if (card.name === '杀' || card.name === '酒') {
      // 需要选目标
      if (selectedCardId === card.id && selectedTarget) {
        send(card.name, 'use', { cardId: card.id, targets: [selectedTarget] });
      } else {
        setSelectedCardId(card.id);
        setSelectedTarget(null);
      }
    } else if (card.name === '桃') {
      // 桃对自己使用
      send('桃', 'use', { cardId: card.id, target: viewerName });
    } else {
      // 其他牌,选目标后出
      if (selectedCardId === card.id && selectedTarget) {
        send(card.name, 'use', { cardId: card.id, targets: [selectedTarget] });
      } else {
        setSelectedCardId(card.id);
        setSelectedTarget(null);
      }
    }
  }

  function handleTargetClick(name: string) {
    setSelectedTarget(selectedTarget === name ? null : name);
    // 选完目标自动出牌
    if (selectedCardId && selectedTarget !== name) {
      const card = viewerHand.find(c => c.id === selectedCardId);
      if (card) {
        setTimeout(() => {
          send(card.name, 'use', { cardId: card.id, targets: [name] });
        }, 100);
      }
    }
  }

  function handleEndTurn() {
    send('回合结束', 'end', {});
  }

  return (
    <div style={S.root}>
      {/* 顶部信息栏 */}
      <div style={S.topBar}>
        <button style={S.backBtn} onClick={onDeleteRoom}>← 退出</button>
        <div style={S.turnInfo}>
          <span style={S.roundBadge}>第 {view.turn.round} 轮</span>
          <span style={S.phaseBadge}>{PHASE_LABELS[view.phase] ?? view.phase}</span>
          <span style={{ color: isMyTurn ? '#ffd700' : '#888' }}>
            当前: {currentPlayer?.name ?? '?'} {currentPlayer?.character ? `(${currentPlayer.character})` : ''}
          </span>
        </div>
        {isMyTurn && view.phase === '出牌' && (
          <button style={S.endTurnBtn} onClick={handleEndTurn}>结束回合</button>
        )}
      </div>

      {/* 待回应提示 */}
      {isAwaitingResponse && pending && (
        <div style={S.pendingBox}>
          <div style={S.pendingTitle}>⚡ 需要回应</div>
          <div style={S.pendingDesc}>
            {pending.prompt.title}
            {pending.prompt.description && <span style={{ color: '#aaa' }}> — {pending.prompt.description}</span>}
          </div>
          <div style={S.pendingHint}>
            选择手牌中的 <b>闪</b> 或 <b>杀</b> 来回应
          </div>
        </div>
      )}

      {/* 玩家列表 */}
      <div style={S.playerGrid}>
        {view.players.map((p, i) => {
          const isActive = i === view.currentPlayerIndex;
          const isViewer = i === view.viewer;
          const isDead = !p.alive;
          return (
            <div
              key={i}
              style={{
                ...S.playerCard,
                ...(isActive ? S.playerCardActive : {}),
                ...(isDead ? S.playerCardDead : {}),
                ...(isViewer ? S.playerCardSelf : {}),
              }}
            >
              <div style={S.playerHeader}>
                <div>
                  <span style={S.playerName}>{p.name}</span>
                  {p.character && <span style={S.charName}>({p.character})</span>}
                  {isViewer && <span style={S.youBadge}>你</span>}
                  {isActive && <span style={S.turnBadge}>回合</span>}
                  {isDead && <span style={S.deadBadge}>💀</span>}
                </div>
                <div style={p.health >= p.maxHealth ? S.hpFull : S.hpLow}>
                  ♥ {p.health}/{p.maxHealth}
                </div>
              </div>
              <div style={S.skillRow}>
                {p.skills.map(s => <span key={s} style={S.skillTag}>{s}</span>)}
              </div>
              <div style={S.infoRow}>
                <span>手牌: {p.handCount}</span>
                {Object.entries(p.equipment).map(([slot, cardId]) => {
                  const card = view.cardMap[cardId as string];
                  return <span key={slot} style={S.equipTag}>[{slot}:{card?.name ?? cardId}]</span>;
                })}
              </div>
              {p.marks.length > 0 && (
                <div style={S.markRow}>
                  {p.marks.map(m => (
                    <span key={m.id} style={S.markTag}>
                      {m.id}{m.payload ? `(${JSON.stringify(m.payload)})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 选择目标 */}
      {selectedCardId && !isAwaitingResponse && (
        <div style={S.targetSection}>
          <div style={S.sectionTitle}>
            选择目标
            <button style={S.cancelBtn} onClick={() => { setSelectedCardId(null); setSelectedTarget(null); }}>取消</button>
          </div>
          <div style={S.targetList}>
            {view.players.map((p, i) => {
              if (!p.alive || i === view.viewer) return null;
              return (
                <button
                  key={i}
                  style={{ ...S.targetBtn, ...(selectedTarget === p.name ? S.targetBtnActive : {}) }}
                  onClick={() => handleTargetClick(p.name)}
                >
                  {p.name} ({p.character}) ♥{p.health}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 手牌区 */}
      <div style={S.handSection}>
        <div style={S.sectionTitle}>
          你的手牌 ({viewerHand.length})
          {isMyTurn && <span style={{ color: '#888', fontWeight: 'normal', marginLeft: 8 }}>点击卡牌使用</span>}
          {isAwaitingResponse && <span style={{ color: '#e67e22', fontWeight: 'normal', marginLeft: 8 }}>点击闪或杀回应</span>}
        </div>
        <div style={S.handList}>
          {viewerHand.map(card => {
            const isSelected = selectedCardId === card.id;
            const canUse = isMyTurn || (isAwaitingResponse && (card.name === '闪' || card.name === '杀'));
            const suitColor = SUIT_COLORS[card.suit] ?? '#e0e0e0';
            return (
              <div
                key={card.id}
                style={{ ...S.handCard, ...(isSelected ? S.handCardSelected : {}), ...(!canUse ? S.handCardDisabled : {}) }}
                onClick={() => canUse && handleCardClick(card)}
              >
                <div style={{ ...S.cardName, color: suitColor }}>{card.name}</div>
                <div style={{ ...S.cardSuit, color: suitColor }}>{card.suit}{card.rank}</div>
              </div>
            );
          })}
          {viewerHand.length === 0 && <div style={S.emptyHand}>无手牌</div>}
        </div>
      </div>
    </div>
  );
}

// ==================== Styles ====================

const S: Record<string, React.CSSProperties> = {
  root: {
    padding: 16, fontFamily: "'Noto Sans SC', 'PingFang SC', sans-serif",
    background: 'linear-gradient(135deg, #0f0c29 0%, #1a1a2e 50%, #16213e 100%)',
    color: '#e0e0e0', minHeight: '100vh',
  },
  // Top bar
  topBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, padding: '8px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 8,
  },
  backBtn: {
    border: '1px solid #555', borderRadius: 4, padding: '4px 12px',
    cursor: 'pointer', background: 'transparent', color: '#e0e0e0', fontSize: 13,
  },
  turnInfo: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 },
  roundBadge: {
    background: '#0f3460', borderRadius: 4, padding: '2px 8px', fontSize: 12, color: '#8899aa',
  },
  phaseBadge: {
    background: '#e67e22', borderRadius: 4, padding: '2px 8px', fontSize: 12, color: '#fff', fontWeight: 'bold',
  },
  endTurnBtn: {
    border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer',
    background: '#e74c3c', color: '#fff', fontWeight: 'bold', fontSize: 13,
  },
  // Pending
  pendingBox: {
    border: '2px solid #e67e22', borderRadius: 8, padding: '12px 16px',
    background: 'rgba(230,126,34,0.15)', marginBottom: 16,
  },
  pendingTitle: { color: '#e67e22', fontWeight: 'bold', fontSize: 15, marginBottom: 4 },
  pendingDesc: { fontSize: 14, marginBottom: 4 },
  pendingHint: { fontSize: 12, color: '#aaa' },
  // Players
  playerGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 12, marginBottom: 16,
  },
  playerCard: {
    border: '1px solid #333', borderRadius: 8, padding: '10px 14px',
    background: 'rgba(22,33,62,0.8)', transition: 'all 0.2s',
  },
  playerCardActive: {
    border: '2px solid #ffd700', boxShadow: '0 0 12px rgba(255,215,0,0.2)',
  },
  playerCardSelf: {
    border: '2px solid #3498db',
  },
  playerCardDead: { opacity: 0.35 },
  playerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  playerName: { fontWeight: 'bold', fontSize: 14 },
  charName: { color: '#8899aa', fontSize: 12, marginLeft: 4 },
  youBadge: {
    background: '#3498db', borderRadius: 3, padding: '1px 5px', fontSize: 10,
    color: '#fff', marginLeft: 6, fontWeight: 'bold',
  },
  turnBadge: {
    background: '#ffd700', borderRadius: 3, padding: '1px 5px', fontSize: 10,
    color: '#000', marginLeft: 4, fontWeight: 'bold',
  },
  deadBadge: { marginLeft: 6 },
  hpFull: { color: '#2ecc71', fontWeight: 'bold', fontSize: 13 },
  hpLow: { color: '#e74c3c', fontWeight: 'bold', fontSize: 13 },
  skillRow: { marginBottom: 4 },
  skillTag: {
    display: 'inline-block', background: '#0f3460', borderRadius: 4,
    padding: '1px 6px', marginRight: 4, fontSize: 11, color: '#8899aa',
  },
  infoRow: { fontSize: 12, color: '#888', display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  equipTag: { color: '#f39c12' },
  markRow: { fontSize: 11, color: '#666', marginTop: 2 },
  markTag: { marginRight: 6 },
  // Target selection
  targetSection: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 13, color: '#aaa', marginBottom: 8, fontWeight: 'bold',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  cancelBtn: {
    border: '1px solid #555', borderRadius: 4, padding: '2px 8px',
    cursor: 'pointer', background: 'transparent', color: '#aaa', fontSize: 11,
  },
  targetList: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  targetBtn: {
    border: '1px solid #444', borderRadius: 6, padding: '6px 14px',
    cursor: 'pointer', background: 'rgba(22,33,62,0.8)', color: '#e0e0e0', fontSize: 13,
  },
  targetBtnActive: {
    border: '2px solid #e74c3c', background: 'rgba(231,76,60,0.2)',
  },
  // Hand cards
  handSection: { marginBottom: 16 },
  handList: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  handCard: {
    border: '2px solid #444', borderRadius: 8, padding: '10px 14px',
    cursor: 'pointer', background: 'rgba(22,33,62,0.9)', minWidth: 70,
    textAlign: 'center' as const, transition: 'all 0.15s',
  },
  handCardSelected: {
    border: '2px solid #3498db', background: 'rgba(52,152,219,0.2)',
    transform: 'translateY(-4px)', boxShadow: '0 4px 12px rgba(52,152,219,0.3)',
  },
  handCardDisabled: { opacity: 0.4, cursor: 'default' },
  cardName: { fontWeight: 'bold', fontSize: 15, marginBottom: 2 },
  cardSuit: { fontSize: 12 },
  emptyHand: { color: '#555', fontSize: 13, padding: 12 },
};
