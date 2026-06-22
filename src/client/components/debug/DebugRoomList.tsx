// src/components/debug/DebugRoomList.tsx — 调试大厅的大厅视图
//
// T10 拆分：把 DebugLobby 中 state===null 时的"创建调试房间"表单 +
// 房间列表 panel 抽出来。本组件只负责展示，所有副作用回调来自父组件。

import { css, cx } from '@linaria/core';
import type { RoomInfo } from '../../../server/protocol';
import { colors, styles } from '../../theme';
import { RoomListPanel } from '../RoomListPanel';

interface DebugRoomListProps {
  /** 当前选中的玩家人数 */
  playerCount: number;
  /** 切换玩家人数下拉 */
  onPlayerCountChange: (n: number) => void;
  /** 点击"创建调试房间" */
  onCreateRoom: () => void;
  /** 来自服务端的调试房间列表 */
  rooms: RoomInfo[];
  /** 刷新列表（点击"刷新列表"或创建/删除后） */
  onRefresh: () => void;
  /** 加入指定房间 */
  onJoin: (roomId: string) => void;
  /** 删除指定房间 */
  onDelete: (roomId: string) => void;
}

const rootRow = css`
  margin-top: 40px;
  display: flex;
  justify-content: center;
  gap: 40px;
  flex-wrap: wrap;
`;

const createCard = css`
  background-color: ${colors.bg.panel};
  border-radius: 12px;
  padding: 30px;
  min-width: 320px;
  max-width: 400px;
`;

const createTitle = css`
  margin-bottom: 20px;
`;

const formGroup = css`
  margin-bottom: 20px;
`;

const formLabel = css`
  display: block;
  margin-bottom: 5px;
  font-size: 14px;
`;

const createBtnBase = css`
  width: 100%;
  padding: 12px;
  color: ${colors.white};
  border: none;
  border-radius: 6px;
  font-size: 16px;
  font-weight: bold;
`;

const createBtn = css`
  background-color: ${colors.accent.orange};
  cursor: pointer;
`;

export function DebugRoomList({
  playerCount,
  onPlayerCountChange,
  onCreateRoom,
  rooms,
  onRefresh,
  onJoin,
  onDelete,
}: DebugRoomListProps) {
  return (
    <div className={rootRow}>
      <div className={createCard}>
        <h2 className={createTitle}>创建调试房间</h2>
        <div className={formGroup}>
          <label className={formLabel}>玩家人数</label>
          <select
            value={playerCount}
            onChange={e => onPlayerCountChange(Number(e.target.value))}
            style={styles.input()}
          >
            <option value={2}>2人</option>
            <option value={3}>3人</option>
            <option value={4}>4人</option>
            <option value={5}>5人</option>
            <option value={6}>6人</option>
            <option value={7}>7人</option>
            <option value={8}>8人</option>
          </select>
        </div>
        <button
          onClick={onCreateRoom}
          className={cx(createBtnBase, createBtn)}
        >
          创建调试房间
        </button>
      </div>
      <RoomListPanel
        rooms={rooms}
        onRefresh={onRefresh}
        onJoin={onJoin}
        onDelete={onDelete}
        emptyText="暂无调试房间"
        allowJoinAlways
      />
    </div>
  );
}
