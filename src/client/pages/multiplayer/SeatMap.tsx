// src/client/pages/multiplayer/SeatMap.tsx
// 等待大厅座位图:座次按钮(空位加入/移动、与他人交换确认)、房主踢出、
// 自己已发出交换请求的等待提示、收到的交换请求同意/拒绝卡。房间数据走 MultiplayerRoomCtx。
import { btnStyle, colors } from '../../theme';
import { memberName } from '../../utils/memberNames';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';

export function SeatMap() {
  const mp = useMultiplayerRoomCtx();
  const seats = mp.roomState?.seats ?? [];
  const mySeat = seats.indexOf(mp.playerId ?? '');
  const pendingSwaps = mp.roomState?.pendingSeatSwaps ?? {};
  // 找出谁请求与我交换
  const swapRequestForMe = mp.incomingSeatSwap;
  // 是否有自己发出的交换请求
  const hasMyRequest = Object.entries(pendingSwaps).find(
    ([reqId]) => reqId === mp.playerId,
  );
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '14px', color: colors.text.muted, marginBottom: '8px' }}>座位安排（{mp.isSpectator ? '点击空位加入游戏' : '点击空位移动，点击他人座位请求交换'}）</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {seats.map((seatPlayerId, i) => {
          const isEmpty = seatPlayerId === null;
          const isMe = seatPlayerId === mp.playerId;
          const isPending = Object.entries(pendingSwaps).find(
            ([, v]) => v.targetSeat === i,
          );
          return (
            <div key={i} style={{ position: 'relative' }}>
              <button
                className={btnStyle}
                disabled={isMe || i === mySeat}
                style={{
                  '--btn-bg': isMe ? colors.accent.gold : isEmpty ? colors.bg.input : colors.accent.darkRed,
                  '--btn-padding': '8px 14px',
                  '--btn-font-size': '13px',
                  cursor: isMe ? 'default' : 'pointer',
                  opacity: isMe ? 0.8 : 1,
                  border: isEmpty ? `1px dashed ${colors.text.muted}` : '1px solid #555',
                  borderRadius: '8px',
                  minWidth: '90px',
                  textAlign: 'center',
                } as React.CSSProperties}
                onClick={() => {
                  // 旁观者点空位 → 占据该座位加入游戏；点他人座位无效
                  if (mp.isSpectator) {
                    if (isEmpty) mp.switchRole('player', i);
                    return;
                  }
                  if (isEmpty) {
                    mp.moveSeat(i);
                  } else if (!isMe) {
                    // 请求交换座位
                    if (window.confirm(`要与  交换座位吗？`)) {
                      mp.requestSeatSwap(i);
                    }
                  }
                }}
                title={mp.isSpectator ? (isEmpty ? '加入游戏' : '旁观中') : isEmpty ? '移动到此座位' : isMe ? '你的座位' : `请求交换座位`}
              >
                <div style={{ fontWeight: 'bold' }}>P{i + 1}</div>
                <div style={{ fontSize: '11px', opacity: 0.8 }}>
                  {isMe ? '我' : isEmpty ? '空位' : memberName(seatPlayerId, mp.roomState?.playerNames)}
                </div>
                {isPending && !isMe && (
                  <div style={{ fontSize: '10px', marginTop: '2px', color: colors.accent.gold }}>
                    交换中...
                  </div>
                )}
              </button>
              {/* 房主踢出该座次玩家 */}
              {mp.isHost && !isEmpty && !isMe && seatPlayerId !== null && (
                <button
                  className={btnStyle}
                  title="踢出该玩家"
                  style={{
                    position: 'absolute',
                    top: '-8px',
                    right: '-8px',
                    '--btn-bg': colors.accent.red,
                    '--btn-padding': '0',
                    '--btn-font-size': '12px',
                    width: '20px',
                    height: '20px',
                    minWidth: 0,
                    lineHeight: '20px',
                    borderRadius: '50%',
                    border: `1px solid ${colors.bg.panel}`,
                    cursor: 'pointer',
                    padding: 0,
                    zIndex: 2,
                  } as React.CSSProperties}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`确定将  踢出房间吗？`)) {
                      mp.kickPlayer(seatPlayerId);
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
      {hasMyRequest && (
        <div style={{ fontSize: '12px', color: colors.accent.gold, marginTop: '6px' }}>
          ⏳ 等待对方同意交换座位...
        </div>
      )}
      {/* 收到的交换请求 */}
      {swapRequestForMe && (
        <div style={{
          background: colors.bg.input,
          borderRadius: '8px',
          padding: '12px',
          marginTop: '8px',
          fontSize: '13px',
          border: `1px solid ${colors.accent.orange}`,
        }}>
          <div style={{ marginBottom: '8px' }}>
            <strong>{swapRequestForMe.requesterId.slice(0, 8)}</strong> 想与你交换座位
            （P{swapRequestForMe.requesterSeat + 1} ⇄ P{swapRequestForMe.targetSeat + 1}）
          </div>
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.accent.green, '--btn-padding': '4px 14px', '--btn-font-size': '12px' } as React.CSSProperties}
            onClick={() => mp.respondSeatSwap(swapRequestForMe.requesterId, true)}
          >同意</button>
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.accent.red, '--btn-padding': '4px 14px', '--btn-font-size': '12px', marginLeft: '6px' } as React.CSSProperties}
            onClick={() => mp.respondSeatSwap(swapRequestForMe.requesterId, false)}
          >拒绝</button>
        </div>
      )}
    </div>
  );
}
