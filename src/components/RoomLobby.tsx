// src/components/RoomLobby.tsx
import { useState, useEffect, useCallback } from 'react';
import { css } from '@linaria/core';
import { useWebSocket } from '../hooks/useWebSocket';
import { apiFetch, ApiError } from '../api/client';
import type { RoomInfo } from '../../server/protocol';
import { colors, styles } from '../theme';
import { RoomListPanel } from './RoomListPanel';

interface RoomLobbyProps {
  onJoinRoom: (roomId: string, playerId: string) => void;
}

const waitingPage = css`
  padding: 40px;
  background-color: ${colors.bg.page};
  min-height: 100vh;
  color: ${colors.text.primary};
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const waitingTitle = css`
  margin-bottom: 30px;
`;

const roomInfoCard = css`
  background-color: ${colors.bg.panel};
  border-radius: 12px;
  padding: 30px;
  min-width: 300px;
  margin-bottom: 20px;
`;

const roomInfoTitle = css`
  margin-bottom: 20px;
`;

const roomInfoList = css`
  margin-bottom: 20px;
`;

const roomPlayerItem = css`
  padding: 8px 0;
  border-bottom: 1px solid ${colors.bg.input};
`;

const waitingButtons = css`
  display: flex;
  gap: 12px;
  justify-content: center;
`;

const roomErrorBox = css`
  background-color: ${colors.accent.red};
  padding: 10px 20px;
  border-radius: 6px;
  margin-top: 10px;
`;

const lobbyTitle = css`
  text-align: center;
  margin-bottom: 40px;
`;

const lobbyTopRow = css`
  display: flex;
  justify-content: center;
  gap: 40px;
  flex-wrap: wrap;
`;

const createCard = css`
  background-color: ${colors.bg.panel};
  border-radius: 12px;
  padding: 30px;
  min-width: 300px;
`;

const createTitle = css`
  margin-bottom: 20px;
`;

const formGroup15 = css`
  margin-bottom: 15px;
`;

const formGroup20 = css`
  margin-bottom: 20px;
`;

const formLabel = css`
  display: block;
  margin-bottom: 5px;
  font-size: 14px;
`;

const createBtnConnected = css`
  background-color: ${colors.accent.red};
  cursor: pointer;
`;

const createBtnDisconnected = css`
  background-color: ${colors.text.dim};
  cursor: not-allowed;
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

const connectionStatus = css`
  text-align: center;
  margin-top: 30px;
`;

const connectionOk = css`
  color: ${colors.accent.green};
`;

const connectionErr = css`
  color: ${colors.accent.red};
`;

export function RoomLobby({ onJoinRoom }: RoomLobbyProps) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected, onMessage, send, connect } = useWebSocket(wsUrl);

  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomName, setRoomName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playersInRoom, setPlayersInRoom] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 连接WebSocket
  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (connected) {
      send({ type: 'list_rooms', filter: 'multiplayer' });
    }
  }, [connected, send]);

  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'room_list':
          setRooms(message.rooms);
          break;

        case 'room_joined':
          setCurrentRoom(message.roomId);
          setPlayerId(message.playerId);
          setIsHost(rooms.length === 0 || rooms.find(r => r.id === message.roomId)?.playerCount === 1);
          break;

        case 'player_joined':
          setPlayersInRoom(prev => [...prev, message.playerId]);
          break;

        case 'player_left':
          setPlayersInRoom(prev => prev.filter(id => id !== message.playerId));
          break;

        case 'game_started':
          if (currentRoom && playerId) {
            onJoinRoom(currentRoom, playerId);
          }
          break;

        case 'error':
          setError(message.message);
          setTimeout(() => setError(null), 3000);
          break;
      }
    });
    return unsubscribe;
  }, [onMessage, currentRoom, playerId, onJoinRoom, rooms]);

  const handleCreateRoom = useCallback(async () => {
    if (!roomName.trim()) {
      setError('请输入房间名称');
      return;
    }
    try {
      const data = await apiFetch<{ roomId: string }>('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomName.trim(), maxPlayers }),
      });
      send({ type: 'join_room', roomId: data.roomId });
    } catch (err) {
      if (err instanceof ApiError) {
        setError((err.body as { error?: string }).error ?? '创建失败');
      } else {
        setError('网络错误');
      }
      setTimeout(() => setError(null), 3000);
    }
  }, [roomName, maxPlayers, send]);

  const handleJoinRoom = useCallback(async (roomId: string) => {
    try {
      await apiFetch(`/api/rooms/${roomId}/join`, { method: 'POST' });
      send({ type: 'join_room', roomId });
    } catch (err) {
      if (err instanceof ApiError) {
        setError((err.body as { error?: string }).error ?? '无法加入');
      } else {
        setError('网络错误');
      }
      setTimeout(() => setError(null), 3000);
    }
  }, [send]);

  const handleReady = useCallback(() => {
    send({ type: 'ready' });
    setIsReady(true);
  }, [send]);

  const handleStartGame = useCallback(() => {
    send({ type: 'start_game' });
  }, [send]);

  const handleLeaveRoom = useCallback(() => {
    send({ type: 'leave_room' });
    setCurrentRoom(null);
    setPlayerId(null);
    setPlayersInRoom([]);
    setIsReady(false);
    setIsHost(false);
    send({ type: 'list_rooms', filter: 'multiplayer' });
  }, [send]);

  // 房间内等待界面
  if (currentRoom) {
    return (
      <div className={waitingPage}>
        <h1 className={waitingTitle}>房间: {currentRoom}</h1>

        <div className={roomInfoCard}>
          <h2 className={roomInfoTitle}>玩家列表</h2>
          <div className={roomInfoList}>
            <div className={roomPlayerItem}>
              {playerId} (你) {isHost ? '- 房主' : ''} {isReady ? '- 已准备' : ''}
            </div>
            {playersInRoom.map(id => (
              <div key={id} className={roomPlayerItem}>
                {id}
              </div>
            ))}
          </div>

          <div className={waitingButtons}>
            {!isReady && (
              <button
                onClick={handleReady}
                style={styles.btn(colors.accent.green, { padding: '10px 24px' })}
              >
                准备
              </button>
            )}

            {isHost && (
              <button
                onClick={handleStartGame}
                style={styles.btn(colors.accent.red, { padding: '10px 24px' })}
              >
                开始游戏
              </button>
            )}

            <button
              onClick={handleLeaveRoom}
              style={styles.btn(colors.text.dim, { padding: '10px 24px' })}
            >
              离开房间
            </button>
          </div>
        </div>

        {error && <div className={roomErrorBox}>{error}</div>}
      </div>
    );
  }

  // 大厅界面
  return (
    <div style={styles.page(40)}>
      <h1 className={lobbyTitle}>三国杀 - 多人对战</h1>

      <div className={lobbyTopRow}>
        {/* 创建房间 */}
        <div className={createCard}>
          <h2 className={createTitle}>创建房间</h2>

          <div className={formGroup15}>
            <label className={formLabel}>房间名称</label>
            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="输入房间名称"
              style={styles.input()}
            />
          </div>

          <div className={formGroup20}>
            <label className={formLabel}>最大玩家数</label>
            <select
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              style={styles.input()}
            >
              <option value={2}>2人</option>
              <option value={3}>3人</option>
              <option value={4}>4人</option>
              <option value={5}>5人</option>
            </select>
          </div>

          <button
            onClick={handleCreateRoom}
            disabled={!connected}
            className={`${createBtnBase} ${connected ? createBtnConnected : createBtnDisconnected}`}
          >
            创建房间
          </button>
        </div>

        <RoomListPanel
          rooms={rooms}
          onRefresh={() => send({ type: 'list_rooms', filter: 'multiplayer' })}
          onJoin={handleJoinRoom}
        />
      </div>

      {/* 连接状态 */}
      <div
        className={`${connectionStatus} ${connected ? connectionOk : connectionErr}`}
      >
        {connected ? '已连接到服务器' : '未连接，请检查服务器是否启动'}
      </div>

      {error && <div style={styles.errorToast()}>{error}</div>}
    </div>
  );
}
