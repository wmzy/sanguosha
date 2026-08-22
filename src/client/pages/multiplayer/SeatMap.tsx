// src/client/pages/multiplayer/SeatMap.tsx
// 等待大厅座位图:座次牌(空位加入/移动、与他人交换确认)、房主踢出、
// 自己已发出交换请求的等待提示、收到的交换请求同意/拒绝卡。房间数据走 MultiplayerRoomCtx。
// 视觉对齐官方 OL 等待室:名牌条 + 暗皮革座次牌(铜徽 ⚔)+ 红色就绪条。
import { css, cx } from '@linaria/core';
import { btnStyle, colors } from '../../theme';
import { memberName } from '../../utils/memberNames';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import { sectionTitle } from './multiplayerStyles';

export function SeatMap() {
  const mp = useMultiplayerRoomCtx();
  const seats = mp.roomState?.seats ?? [];
  const mySeat = seats.indexOf(mp.playerId ?? '');
  const pendingSwaps = mp.roomState?.pendingSeatSwaps ?? {};
  const readyPlayers = mp.roomState?.readyPlayers ?? [];
  const hostId = mp.roomState?.hostId;
  // 找出谁请求与我交换
  const swapRequestForMe = mp.incomingSeatSwap;
  // 是否有自己发出的交换请求
  const hasMyRequest = Object.entries(pendingSwaps).find(
    ([reqId]) => reqId === mp.playerId,
  );
  const occupiedCount = seats.filter((s) => s !== null).length;
  return (
    <div className={seatMapWrap}>
      {/* 面板式小标题:左侧金色竖条 + 座位占用统计;操作说明作次行小字 */}
      <div className={sectionTitle}>座位安排（{occupiedCount}/{seats.length}）</div>
      <div className={seatMapHint}>
        {mp.isSpectator ? '点击空位加入游戏' : '点击空位移动，点击他人座位请求交换'}
      </div>
      <div className={seatRow}>
        {seats.map((seatPlayerId, i) => {
          const isEmpty = seatPlayerId === null;
          const isMe = seatPlayerId === mp.playerId;
          const isReady = seatPlayerId !== null && readyPlayers.includes(seatPlayerId);
          const isHostSeat = seatPlayerId !== null && seatPlayerId === hostId;
          const isPending = Object.entries(pendingSwaps).find(
            ([, v]) => v.targetSeat === i,
          );
          return (
            <div key={i} className={seatCol}>
              {/* 名牌条(有玩家时):玩家名 + 房主/我标记 */}
              {!isEmpty && (
                <div className={seatNameTag}>
                  <span className={seatNameText}>
                    {memberName(seatPlayerId, mp.roomState?.playerNames)}
                  </span>
                  {isHostSeat && <span className={seatHostMark}>（房主）</span>}
                  {isMe && <span className={seatMeMark}>（我）</span>}
                </div>
              )}
              <div className={seatPlateWrap}>
                {/* 座次牌:点击加入/移动/请求交换;自座不可点 */}
                <button
                  type="button"
                  className={cx(seatPlate, isEmpty && seatPlateEmpty, isMe && seatPlateSelf)}
                  disabled={isMe || i === mySeat}
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
                  {/* 中央圆形铜徽:占座 ⚔ / 空位 ＋ */}
                  <div className={cx(seatEmblem, isEmpty && seatEmblemEmpty)}>
                    {isEmpty ? '＋' : '⚔'}
                  </div>
                  {isEmpty && <div className={seatEmptyHint}>空位</div>}
                  <div className={seatIdxLabel}>座次 {i + 1}</div>
                  {/* 已就绪:右上角 ✓ 金绿圆章 */}
                  {isReady && <div className={seatReadyBadge}>✓</div>}
                  {/* 该座次有待确认的交换请求 */}
                  {isPending && !isMe && <div className={seatSwapMark}>⇄</div>}
                </button>
                {/* 房主踢出该座次玩家 */}
                {mp.isHost && !isEmpty && !isMe && seatPlayerId !== null && (
                  <button
                    type="button"
                    className={seatKickBtn}
                    title="踢出该玩家"
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
              {/* 红色就绪条:就绪=满条红光,未就绪=30% 暗红,空位=轨道降透明 */}
              <div className={cx(seatReadyTrack, isEmpty && seatReadyTrackDim)}>
                {!isEmpty && (
                  <div
                    className={cx(seatReadyFill, isReady ? seatReadyFillOn : seatReadyFillOff)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {hasMyRequest && (
        <div className={seatSwapWaiting}>⏳ 等待对方同意交换座位...</div>
      )}
      {/* 收到的交换请求 */}
      {swapRequestForMe && (
        <div className={seatSwapCard}>
          <div>
            <strong>{swapRequestForMe.requesterId.slice(0, 8)}</strong> 想与你交换座位
            （P{swapRequestForMe.requesterSeat + 1} ⇄ P{swapRequestForMe.targetSeat + 1}）
          </div>
          <div className={seatSwapCardBtns}>
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.green, '--btn-padding': '4px 14px', '--btn-font-size': '12px' } as React.CSSProperties}
              onClick={() => mp.respondSeatSwap(swapRequestForMe.requesterId, true)}
            >同意</button>
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.red, '--btn-padding': '4px 14px', '--btn-font-size': '12px' } as React.CSSProperties}
              onClick={() => mp.respondSeatSwap(swapRequestForMe.requesterId, false)}
            >拒绝</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles(官方 OL 等待室座次牌位风格,px 单位) ───
const seatMapWrap = css`
  margin-bottom: 12px;
`;

const seatMapHint = css`
  font-size: 13px;
  color: ${colors.text.muted};
  margin-bottom: 12px;
`;

const seatRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: 12px 10px;
`;

/* 每个座位一列:名牌条 / 座次牌 / 就绪条 自上而下 */
const seatCol = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
`;

/* 名牌条:暗条 + 铜边圆角小条 */
const seatNameTag = css`
  display: flex;
  align-items: center;
  gap: 2px;
  max-width: 118px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid #5a4a30;
  border-radius: 4px;
  padding: 3px 10px;
`;

const seatNameText = css`
  font-size: 13px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const seatHostMark = css`
  font-size: 10px;
  color: #e8c47a;
  white-space: nowrap;
`;

const seatMeMark = css`
  font-size: 10px;
  color: #9a8c72;
  white-space: nowrap;
`;

const seatPlateWrap = css`
  position: relative;
`;

/* 座次牌:118×92 暗皮革块 + 内阴影,中央铜徽 */
const seatPlate = css`
  position: relative;
  width: 118px;
  height: 92px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0;
  background: linear-gradient(#241d15, #171209);
  border: 1px solid #5a4a30;
  border-radius: 8px;
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6);
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:hover:not(:disabled) {
    border-color: #c4a254;
    box-shadow:
      inset 0 2px 8px rgba(0, 0, 0, 0.6),
      0 0 10px rgba(196, 162, 84, 0.3);
  }
`;

/* 空位:虚线边框 */
const seatPlateEmpty = css`
  border: 1px dashed #5a4a30;
`;

/* 自座:铜边加亮,不可点 */
const seatPlateSelf = css`
  cursor: default;
  border-color: #8a7448;
`;

/* 中央圆形铜徽:52px 圆 + ⚔ 金字;空位灰色 ＋ */
const seatEmblem = css`
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #e8c47a;
  background: radial-gradient(circle at 35% 30%, #4a3826, #241a10);
  border: 1px solid #8a7448;
  box-shadow:
    inset 0 1px 2px rgba(232, 196, 122, 0.15),
    0 2px 6px rgba(0, 0, 0, 0.5);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
`;

const seatEmblemEmpty = css`
  color: #5a5040;
`;

const seatEmptyHint = css`
  font-size: 10px;
  color: #6a5a3e;
  letter-spacing: 2px;
`;

/* 牌下缘内侧「座次 N」暗金字 */
const seatIdxLabel = css`
  font-size: 11px;
  color: #8a7448;
  letter-spacing: 2px;
`;

/* 已就绪:右上角 ✓ 金绿圆章(18px) */
const seatReadyBadge = css`
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: bold;
  color: #9fd66b;
  background: #2a4a20;
  border: 1px solid #7ec850;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
`;

/* 交换请求进行中:牌左上角金色 ⇄ */
const seatSwapMark = css`
  position: absolute;
  top: 4px;
  left: 5px;
  font-size: 12px;
  color: #e8c47a;
  text-shadow: 0 1px 2px #000;
`;

/* 房主踢出小圆钮:红漆底 + 金边 */
const seatKickBtn = css`
  position: absolute;
  top: -8px;
  right: -8px;
  z-index: 2;
  width: 20px;
  height: 20px;
  min-width: 0;
  padding: 0;
  line-height: 18px;
  font-size: 12px;
  color: #f5e6c8;
  background: linear-gradient(#a03028, #7a2018);
  border: 1px solid #d4a048;
  border-radius: 50%;
  cursor: pointer;
`;

/* 红色就绪条轨道 */
const seatReadyTrack = css`
  width: 100%;
  max-width: 118px;
  height: 6px;
  border-radius: 3px;
  background: #2a2119;
  overflow: hidden;
`;

/* 空位:轨道整体降透明 */
const seatReadyTrackDim = css`
  opacity: 0.4;
`;

const seatReadyFill = css`
  height: 100%;
  border-radius: 3px;
`;

/* 就绪:满条红 + 右端微光 */
const seatReadyFillOn = css`
  width: 100%;
  background: linear-gradient(#c0392b, #8a2a20);
  box-shadow: 0 0 6px 1px rgba(192, 57, 43, 0.55);
`;

/* 未就绪:30% 暗红 */
const seatReadyFillOff = css`
  width: 30%;
  background: #6a3028;
`;

const seatSwapWaiting = css`
  font-size: 12px;
  color: #e8c47a;
  margin-top: 8px;
`;

/* 收到的交换请求卡:暗皮革 + 金边 */
const seatSwapCard = css`
  margin-top: 10px;
  padding: 12px 14px;
  font-size: 13px;
  color: #e8d9a8;
  background: linear-gradient(#241d15, #171209);
  border: 1px solid #c4a254;
  border-radius: 8px;
`;

const seatSwapCardBtns = css`
  display: flex;
  gap: 8px;
  margin-top: 10px;
`;
