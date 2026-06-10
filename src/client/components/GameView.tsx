// src/client/components/GameView.tsx
// 新 ENGINE-DESIGN 完整游戏界面 — 参照老 GameBoard + DebugPlayerList 设计
//
// 布局: GameHeader → 提示区 → 座位布局(5人) → 手牌区 → 操作面板 → 调试面板
// 特性: 视角切换、倒计时、装备区、座位布局、操作提示、弃牌选择
import { useState, useMemo, useCallback, useEffect } from 'react';
import { css, cx } from '@linaria/core';
import type { GameView as EngineGameView, Card, Json, PendingView, EquipSlot } from '../../engine/types';


// ─── ActionMsg: 发给 controller(不含 baseSeq) ───
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

// ─── 阶段中文名 ───
const PHASE_LABELS: Record<string, string> = {
  '准备': '准备阶段', '判定': '判定阶段', '摸牌': '摸牌阶段',
  '出牌': '出牌阶段', '弃牌': '弃牌阶段', '回合结束': '回合结束',
};

// ─── 花色颜色 ───
const SUIT_COLOR: Record<string, string> = {
  '♠': '#ccc', '♣': '#ccc', '♥': '#e74c3c', '♦': '#e74c3c',
};

// ─── 倒计时 hook ───
function useCountdownSeconds(deadline: number | null): number | null {
  const [sec, setSec] = useState<number | null>(null);
  useEffect(() => {
    if (deadline == null) { setSec(null); return; }
    const tick = () => setSec(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline]);
  return sec;
}

// ─── 主组件 ───
export function GameViewComponent({ view, onAction, onDeleteRoom }: Props) {
  // 视角: 默认看自己,可切换
  const [perspectiveIdx, setPerspectiveIdx] = useState(view.viewer);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());

  // 同步 viewer(服务器可能重连后变化)
  useEffect(() => { setPerspectiveIdx(view.viewer); }, [view.viewer]);

  const perspective = view.players[perspectiveIdx];
  const perspectiveName = perspective?.name ?? `P${perspectiveIdx}`;
  const isMyTurn = view.currentPlayerIndex === view.viewer;
  const currentPlayer = view.players[view.currentPlayerIndex];
  const currentPlayerName = currentPlayer?.name ?? '';

  // 视角玩家的手牌(debug 模式所有人可见)
  const perspectiveHand: Card[] = perspective?.hand ?? [];
  const viewerHand: Card[] = view.players[view.viewer]?.hand ?? [];

  // 待回应
  const pending = view.pending;
  const isAwaitingResponse = pending !== null && pending.target === view.players[view.viewer]?.name;

  // 倒计时
  const deadline = pending?.deadline ?? null;
  const remainingSeconds = useCountdownSeconds(deadline);

  // 切换视角
  const switchPerspective = useCallback(() => {
    const next = (perspectiveIdx + 1) % view.players.length;
    setPerspectiveIdx(next);
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [perspectiveIdx, view.players.length]);

  const goToCurrentPlayer = useCallback(() => {
    setPerspectiveIdx(view.currentPlayerIndex);
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [view.currentPlayerIndex]);

  // 发送 action
  const send = useCallback((skillId: string, actionType: string, params: Record<string, Json>) => {
    onAction({ skillId, actionType, ownerId: view.players[view.viewer].name, params });
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [onAction, view]);

  // 出牌
  function handlePlayCard() {
    if (!selectedCardId || !isMyTurn) return;
    const card = viewerHand.find(c => c.id === selectedCardId);
    if (!card) return;
    if (selectedTarget) {
      send(card.name, 'use', { cardId: card.id, targets: [selectedTarget] });
    } else {
      send(card.name, 'use', { cardId: card.id });
    }
  }

  // 回应
  function handleRespond(cardId?: string) {
    if (!pending) return;
    if (cardId) {
      const card = viewerHand.find(c => c.id === cardId);
      if (card) send(card.name, 'respond', { cardId });
    } else {
      send('不出', 'respond', {});
    }
  }

  // 结束回合
  function handleEndTurn() {
    if (!isMyTurn) return;
    send('回合管理', 'end', {});
  }

  // 弃牌(暂未实现UI)
  // function handleDiscard() { ... }

  // 选牌
  function handleCardClick(card: Card) {
    // 回应模式
    if (isAwaitingResponse) {
      if (card.name === '闪' || card.name === '杀') {
        handleRespond(card.id);
      }
      return;
    }
    // 出牌模式
    if (!isMyTurn) return;
    if (selectedCardId === card.id) {
      setSelectedCardId(null);
      setSelectedTarget(null);
    } else {
      setSelectedCardId(card.id);
      setSelectedTarget(null);
    }
  }

  // 选目标
  function handleTargetClick(name: string) {
    setSelectedTarget(selectedTarget === name ? null : name);
  }

  // 选弃牌(暂未实现UI)
  // function toggleDiscard(cardId: string) { ... }

  // 装备名
  function equipName(_slot: EquipSlot, cardId: string): string {
    const card = view.cardMap[cardId];
    return card?.name ?? cardId;
  }

  // 座位排列: [自己, 右下, 右上, 左上, 左下]
  const orderedPlayers = useMemo(() => {
    const result: typeof view.players = [];
    for (let i = 0; i < view.players.length; i++) {
      result.push(view.players[(perspectiveIdx + i) % view.players.length]);
    }
    return result;
  }, [view.players, perspectiveIdx]);


  return (
    <div className={pageRoot}>
      {/* ─── 头部 ─── */}
      <div className={headerBar}>
        <button className={backBtn} onClick={onDeleteRoom}>← 退出</button>
        <div className={headerCenter}>
          <span className={roundBadge}>第 {view.turn.round} 轮</span>
          <span className={phaseBadge}>{PHASE_LABELS[view.phase] ?? view.phase}</span>
          <span className={currentPlayerText}>
            当前: {currentPlayerName} {currentPlayer?.character ? `(${currentPlayer.character})` : ''}
          </span>
        </div>
        <div className={headerRight}>
          <button className={perspectiveBtn} onClick={switchPerspective}>
            视角: {perspectiveName}
          </button>
          <button className={goToBtn} onClick={goToCurrentPlayer}>查看当前玩家</button>
        </div>
      </div>

      {/* ─── 操作提示 ─── */}
      {isAwaitingResponse && pending && (
        <div className={promptBox}>
          <div className={promptTitle}>⚡ 需要回应</div>
          <div className={promptDesc}>
            {pending.prompt.title}
            {pending.prompt.description && <span> — {pending.prompt.description}</span>}
          </div>
          <div className={promptActions}>
            <button className={promptBtn} onClick={() => handleRespond()}>不出</button>
            {viewerHand.filter(c => c.name === '闪' || c.name === '杀').map(c => (
              <button key={c.id} className={promptBtnPrimary} onClick={() => handleRespond(c.id)}>
                {c.name} {c.suit}{c.rank}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isMyTurn && !isAwaitingResponse && (
        <div className={waitingHint}>等待 {currentPlayerName} 操作...</div>
      )}

      {/* ─── 座位布局 ─── */}
      <div className={seatingArea}>
        {/* 上排: 2人 */}
        <div className={seatRowCenter}>
          {orderedPlayers[3] && <PlayerSeatView
            player={orderedPlayers[3]}
            index={(perspectiveIdx + 3) % view.players.length}
            view={view}
            isCurrentPlayer={orderedPlayers[3].name === currentPlayerName}
            isPerspective={orderedPlayers[3].name === perspectiveName}
            needsTarget={selectedCardId !== null && isMyTurn}
            selectedTarget={selectedTarget}
            remainingSeconds={orderedPlayers[3].name === currentPlayerName ? remainingSeconds : null}
            onTargetClick={handleTargetClick}
            onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
          />}
          {orderedPlayers[2] && <PlayerSeatView
            player={orderedPlayers[2]}
            index={(perspectiveIdx + 2) % view.players.length}
            view={view}
            isCurrentPlayer={orderedPlayers[2].name === currentPlayerName}
            isPerspective={orderedPlayers[2].name === perspectiveName}
            needsTarget={selectedCardId !== null && isMyTurn}
            selectedTarget={selectedTarget}
            remainingSeconds={orderedPlayers[2].name === currentPlayerName ? remainingSeconds : null}
            onTargetClick={handleTargetClick}
            onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
          />}
        </div>

        {/* 中排: 左下 | 中央信息 | 右下 */}
        <div className={seatRowSpread}>
          <div className={seatSlot160}>
            {orderedPlayers[4] && <PlayerSeatView
              player={orderedPlayers[4]}
              index={(perspectiveIdx + 4) % view.players.length}
              view={view}
              isCurrentPlayer={orderedPlayers[4].name === currentPlayerName}
              isPerspective={orderedPlayers[4].name === perspectiveName}
              needsTarget={selectedCardId !== null && isMyTurn}
              selectedTarget={selectedTarget}
              remainingSeconds={orderedPlayers[4].name === currentPlayerName ? remainingSeconds : null}
              onTargetClick={handleTargetClick}
              onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
            />}
          </div>

          <div className={centerMeta}>
            <div className={metaText}>
              牌堆: {Object.keys(view.cardMap).length} 张
            </div>
            {deadline != null && remainingSeconds !== null && (
              <div className={countdownText}>
                ⏱ {remainingSeconds}s
              </div>
            )}
          </div>

          <div className={seatSlot160}>
            {orderedPlayers[1] && <PlayerSeatView
              player={orderedPlayers[1]}
              index={(perspectiveIdx + 1) % view.players.length}
              view={view}
              isCurrentPlayer={orderedPlayers[1].name === currentPlayerName}
              isPerspective={orderedPlayers[1].name === perspectiveName}
              needsTarget={selectedCardId !== null && isMyTurn}
              selectedTarget={selectedTarget}
              remainingSeconds={orderedPlayers[1].name === currentPlayerName ? remainingSeconds : null}
              onTargetClick={handleTargetClick}
              onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
            />}
          </div>
        </div>

        {/* 下排: 自己 */}
        <div className={seatRowCenter}>
          {orderedPlayers[0] && <PlayerSeatView
            player={orderedPlayers[0]}
            index={perspectiveIdx}
            view={view}
            isCurrentPlayer={orderedPlayers[0].name === currentPlayerName}
            isPerspective={true}
            needsTarget={false}
            selectedTarget={null}
            remainingSeconds={orderedPlayers[0].name === currentPlayerName ? remainingSeconds : null}
            onTargetClick={handleTargetClick}
            onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
          />}
        </div>
      </div>

      {/* ─── 手牌区 ─── */}
      <div className={handSection}>
        <div className={handHeader}>
          <span className={handTitle}>
            {perspectiveName} 的手牌 ({perspectiveHand.length})
            {perspectiveIdx !== view.viewer && <span className={debugHint}> (调试视角)</span>}
          </span>
          {selectedCardId && (
            <button className={cancelBtn} onClick={() => { setSelectedCardId(null); setSelectedTarget(null); }}>
              取消选择
            </button>
          )}
        </div>
        <div className={handList}>
          {perspectiveHand.map((card, i) => {
            const isSelected = selectedCardId === card.id;
            const canPlay = isMyTurn && perspectiveIdx === view.viewer;
            const isAwaiting = isAwaitingResponse && (card.name === '闪' || card.name === '杀');
            const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
            return (
              <div
                key={card.id}
                className={cx(handCard, isSelected && handCardSelected, (!canPlay && !isAwaiting) && handCardDisabled)}
                onClick={() => (canPlay || isAwaiting) && handleCardClick(card)}
              >
                <div className={cardName} style={{ color: suitColor }}>{card.name}</div>
                <div className={cardSuit} style={{ color: suitColor }}>{card.suit}{card.rank}</div>
              </div>
            );
          })}
          {perspectiveHand.length === 0 && <div className={emptyHand}>无手牌</div>}
        </div>
      </div>

      {/* ─── 操作面板 ─── */}
      <div className={actionBar}>
        {isMyTurn && view.phase === '出牌' && selectedCardId && (
          <button className={playBtn} onClick={handlePlayCard}>
            出牌{selectedTarget ? ` → ${selectedTarget}` : ''}
          </button>
        )}
        {isMyTurn && (view.phase === '出牌' || view.phase === '弃牌') && (
          <button className={endTurnBtn} onClick={handleEndTurn}>结束回合</button>
        )}
        {selectedCardId && selectedTarget && isMyTurn && (
          <div className={targetHint}>已选择目标: {selectedTarget}</div>
        )}
      </div>

      {/* ─── 目标选择 ─── */}
      {selectedCardId && isMyTurn && !isAwaitingResponse && (
        <div className={targetSection}>
          <div className={targetTitle}>选择目标:</div>
          <div className={targetList}>
            {view.players.map((p, i) => {
              if (!p.alive || i === view.viewer) return null;
              return (
                <button
                  key={i}
                  className={cx(targetBtn, selectedTarget === p.name && targetBtnActive)}
                  onClick={() => handleTargetClick(p.name)}
                >
                  {p.name} ({p.character}) ♥{p.health}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── 调试面板 ─── */}
      <details className={debugPanel}>
        <summary className={debugSummary}>调试信息</summary>
        <div className={debugContent}>
          <div>phase: {view.phase} | round: {view.turn.round} | currentPlayer: {currentPlayerName}</div>
          <div>viewer: {view.players[view.viewer]?.name} | perspective: {perspectiveName}</div>
          <div>pending: {pending ? `${pending.prompt.title} → ${pending.target}` : 'none'}</div>
          <hr className={debugHr} />
          {view.players.map((p, i) => (
            <div key={i} className={debugPlayer}>
              <span className={!p.alive ? debugDead : undefined}>
                {p.name}({p.character}) HP:{p.health}/{p.maxHealth}
                {!p.alive && ' [阵亡]'}
              </span>
              <span> 手牌:{p.handCount}</span>
              {Object.entries(p.equipment).map(([slot, cardId]) => (
                <span key={slot}> [{slot}:{equipName(slot as EquipSlot, cardId as string)}]</span>
              ))}
              {p.skills.filter(s => s !== '回合管理').length > 0 && (
                <span> 技能:{p.skills.filter(s => s !== '回合管理').join(',')}</span>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ─── 玩家座位视图 ───
interface PlayerSeatProps {
  player: EngineGameView['players'][number];
  index: number;
  view: EngineGameView;
  isCurrentPlayer: boolean;
  isPerspective: boolean;
  needsTarget: boolean;
  selectedTarget: string | null;
  remainingSeconds: number | null;
  onTargetClick: (name: string) => void;
  onPerspectiveChange: (index: number) => void;
}

function PlayerSeatView({
  player, index, view, isCurrentPlayer, isPerspective,
  needsTarget, selectedTarget, remainingSeconds,
  onTargetClick, onPerspectiveChange,
}: PlayerSeatProps) {
  const isDead = !player.alive;
  const isClickable = needsTarget && !isDead && player.name !== view.players[view.viewer]?.name;

  return (
    <div
      className={cx(
        seatCard,
        isCurrentPlayer && seatCardActive,
        isPerspective && seatCardPerspective,
        isDead && seatCardDead,
        isClickable && seatCardClickable,
        selectedTarget === player.name && seatCardTargeted,
      )}
      onClick={() => isClickable && onTargetClick(player.name)}
      onDoubleClick={() => onPerspectiveChange(index)}
    >
      <div className={seatHeader}>
        <div>
          <span className={seatName}>{player.name}</span>
          {player.character && <span className={seatChar}>({player.character})</span>}
          {isPerspective && <span className={youBadge}>视角</span>}
          {isCurrentPlayer && <span className={turnBadge}>回合</span>}
          {isDead && <span> 💀</span>}
        </div>
        <div className={player.health >= player.maxHealth ? hpFull : hpLow}>
          ♥ {player.health}/{player.maxHealth}
        </div>
      </div>
      <div className={skillRow}>
        {player.skills.filter(s => s !== '回合管理').map(s => (
          <span key={s} className={skillTag}>{s}</span>
        ))}
      </div>
      <div className={infoRow}>
        <span>手牌: {player.handCount}</span>
        {Object.entries(player.equipment).map(([slot, cardId]) => {
          const card = view.cardMap[cardId as string];
          return <span key={slot} className={equipTag}>[{slot}:{card?.name ?? cardId}]</span>;
        })}
      </div>
      {player.marks.length > 0 && (
        <div className={markRow}>
          {player.marks.map(m => (
            <span key={m.id} className={markTag}>
              {m.id}{m.payload ? `(${JSON.stringify(m.payload)})` : ''}
            </span>
          ))}
        </div>
      )}
      {remainingSeconds !== null && (
        <div className={timerText}>⏱ {remainingSeconds}s</div>
      )}
    </div>
  );
}

// ==================== Styles ====================

const pageRoot = css`
  padding: 12px;
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
  background: linear-gradient(135deg, #0f0c29 0%, #1a1a2e 50%, #16213e 100%);
  color: #e0e0e0;
  min-height: 100vh;
`;

// Header
const headerBar = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(0,0,0,0.3);
  border-radius: 8px;
`;
const backBtn = css`
  border: 1px solid #555; border-radius: 4px; padding: 4px 12px;
  cursor: pointer; background: transparent; color: #e0e0e0; font-size: 13px;
`;
const headerCenter = css`display: flex; align-items: center; gap: 12px; font-size: 14px;`;
const roundBadge = css`
  background: #0f3460; border-radius: 4px; padding: 2px 8px;
  font-size: 12px; color: #8899aa;
`;
const phaseBadge = css`
  background: #e67e22; border-radius: 4px; padding: 2px 8px;
  font-size: 12px; color: #fff; font-weight: bold;
`;
const currentPlayerText = css`color: #ffd700;`;
const headerRight = css`display: flex; gap: 8px;`;
const perspectiveBtn = css`
  border: 1px solid #3498db; border-radius: 4px; padding: 4px 10px;
  cursor: pointer; background: transparent; color: #3498db; font-size: 12px;
`;
const goToBtn = css`
  border: 1px solid #555; border-radius: 4px; padding: 4px 10px;
  cursor: pointer; background: transparent; color: #aaa; font-size: 12px;
`;

// Prompt
const promptBox = css`
  border: 2px solid #e67e22; border-radius: 8px; padding: 12px 16px;
  background: rgba(230,126,34,0.15); margin-bottom: 12px;
`;
const promptTitle = css`color: #e67e22; font-weight: bold; font-size: 15px; margin-bottom: 4px;`;
const promptDesc = css`font-size: 14px; margin-bottom: 8px;`;
const promptActions = css`display: flex; gap: 8px; flex-wrap: wrap;`;
const promptBtn = css`
  border: 1px solid #888; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(0,0,0,0.3); color: #e0e0e0; font-size: 13px;
`;
const promptBtnPrimary = css`
  border: 1px solid #27ae60; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(39,174,96,0.2); color: #2ecc71; font-size: 13px; font-weight: bold;
`;

const waitingHint = css`
  text-align: center; color: #888; font-size: 13px; margin-bottom: 12px;
`;

// Seating
const seatingArea = css`margin-bottom: 16px;`;
const seatRowCenter = css`
  display: flex; justify-content: center; gap: 12px; margin-bottom: 8px;
`;
const seatRowSpread = css`
  display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;
`;
const seatSlot160 = css`width: 160px;`;
const centerMeta = css`
  text-align: center; flex: 1;
`;
const metaText = css`font-size: 12px; color: #888;`;
const countdownText = css`font-size: 18px; color: #e67e22; font-weight: bold; margin-top: 4px;`;

// Seat card
const seatCard = css`
  border: 1px solid #333; border-radius: 8px; padding: 10px 14px;
  background: rgba(22,33,62,0.8); transition: all 0.2s; min-width: 180px;
`;
const seatCardActive = css`border: 2px solid #ffd700; box-shadow: 0 0 12px rgba(255,215,0,0.2);`;
const seatCardPerspective = css`border: 2px solid #3498db;`;
const seatCardDead = css`opacity: 0.35;`;
const seatCardClickable = css`cursor: pointer; &:hover { border-color: #e74c3c; }`;
const seatCardTargeted = css`outline: 3px solid #e74c3c;`;
const seatHeader = css`
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;
`;
const seatName = css`font-weight: bold; font-size: 14px;`;
const seatChar = css`color: #8899aa; font-size: 12px; margin-left: 4px;`;
const youBadge = css`
  background: #3498db; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #fff; margin-left: 6px; font-weight: bold;
`;
const turnBadge = css`
  background: #ffd700; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #000; margin-left: 4px; font-weight: bold;
`;
const hpFull = css`color: #2ecc71; font-weight: bold; font-size: 13px;`;
const hpLow = css`color: #e74c3c; font-weight: bold; font-size: 13px;`;
const skillRow = css`margin-bottom: 4px;`;
const skillTag = css`
  display: inline-block; background: #0f3460; border-radius: 4px;
  padding: 1px 6px; margin-right: 4px; font-size: 11px; color: #8899aa;
`;
const infoRow = css`
  font-size: 12px; color: #888; display: flex; flex-wrap: wrap; gap: 8px;
`;
const equipTag = css`color: #f39c12;`;
const markRow = css`font-size: 11px; color: #666; margin-top: 2px;`;
const markTag = css`margin-right: 6px;`;
const timerText = css`font-size: 12px; color: #e67e22; margin-top: 4px; font-weight: bold;`;

// Hand cards
const handSection = css`margin-bottom: 12px;`;
const handHeader = css`
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;
`;
const handTitle = css`font-size: 14px; color: #aaa; font-weight: bold;`;
const debugHint = css`color: #666; font-weight: normal; font-size: 12px;`;
const cancelBtn = css`
  border: 1px solid #555; border-radius: 4px; padding: 2px 8px;
  cursor: pointer; background: transparent; color: #aaa; font-size: 11px;
`;
const handList = css`display: flex; flex-wrap: wrap; gap: 8px;`;
const handCard = css`
  border: 2px solid #444; border-radius: 8px; padding: 10px 14px;
  cursor: pointer; background: rgba(22,33,62,0.9); min-width: 70px;
  text-align: center; transition: all 0.15s;
`;
const handCardSelected = css`
  border: 2px solid #3498db; background: rgba(52,152,219,0.2);
  transform: translateY(-4px); box-shadow: 0 4px 12px rgba(52,152,219,0.3);
`;
const handCardDisabled = css`opacity: 0.4; cursor: default;`;
const cardName = css`font-weight: bold; font-size: 15px; margin-bottom: 2px;`;
const cardSuit = css`font-size: 12px;`;
const emptyHand = css`color: #555; font-size: 13px; padding: 12px;`;

// Action bar
const actionBar = css`
  display: flex; gap: 12px; align-items: center; margin-bottom: 12px;
`;
const playBtn = css`
  border: none; border-radius: 6px; padding: 8px 20px;
  cursor: pointer; background: #27ae60; color: #fff; font-weight: bold; font-size: 14px;
`;
const endTurnBtn = css`
  border: none; border-radius: 6px; padding: 8px 20px;
  cursor: pointer; background: #e74c3c; color: #fff; font-weight: bold; font-size: 14px;
`;
const targetHint = css`font-size: 13px; color: #ffd700;`;

// Target selection
const targetSection = css`margin-bottom: 12px;`;
const targetTitle = css`font-size: 13px; color: #aaa; margin-bottom: 8px; font-weight: bold;`;
const targetList = css`display: flex; gap: 8px; flex-wrap: wrap;`;
const targetBtn = css`
  border: 1px solid #444; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(22,33,62,0.8); color: #e0e0e0; font-size: 13px;
`;
const targetBtnActive = css`border: 2px solid #e74c3c; background: rgba(231,76,60,0.2);`;

// Debug panel
const debugPanel = css`
  margin-top: 16px; border: 1px solid #333; border-radius: 8px;
  background: rgba(0,0,0,0.2);
`;
const debugSummary = css`
  padding: 8px 12px; cursor: pointer; color: #888; font-size: 12px;
`;
const debugContent = css`padding: 8px 12px; font-size: 12px; color: #aaa; font-family: monospace;`;
const debugHr = css`border: none; border-top: 1px solid #333; margin: 8px 0;`;
const debugPlayer = css`margin-bottom: 4px;`;
const debugDead = css`text-decoration: line-through; opacity: 0.5;`;
