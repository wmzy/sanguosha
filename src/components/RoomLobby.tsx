// src/components/RoomLobby.tsx
import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { RoomInfo } from '../../server/protocol';
import { colors, styles } from '../theme';
import { RoomListPanel } from './RoomListPanel';

interface RoomLobbyProps {
  onJoinRoom: (roomId: string, playerId: string) => void;
}

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
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomName.trim(), maxPlayers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '创建失败');
        setTimeout(() => setError(null), 3000);
        return;
      }
      send({ type: 'join_room', roomId: data.roomId });
    } catch {
      setError('网络错误');
      setTimeout(() => setError(null), 3000);
    }
  }, [roomName, maxPlayers, send]);

  const handleJoinRoom = useCallback(async (roomId: string) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/join`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '无法加入');
        setTimeout(() => setError(null), 3000);
        return;
      }
      send({ type: 'join_room', roomId });
    } catch {
      setError('网络错误');
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
      <div style={{
        padding: 40,
        backgroundColor: colors.bg.page,
        minHeight: '100vh',
        color: colors.text.primary,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      >
        <h1 style={{ marginBottom: 30 }}>房间: {currentRoom}</h1>

        <div style={{
          backgroundColor: colors.bg.panel,
          borderRadius: 12,
          padding: 30,
          minWidth: 300,
          marginBottom: 20,
        }}
        >
          <h2 style={{ marginBottom: 20 }}>玩家列表</h2>
          <div style={{ marginBottom: 20 }}>
            <div style={{ padding: '8px 0', borderBottom: `1px solid ${colors.bg.input}` }}>
              {playerId} (你) {isHost ? '- 房主' : ''} {isReady ? '- 已准备' : ''}
            </div>
            {playersInRoom.map(id => (
              <div key={id} style={{ padding: '8px 0', borderBottom: `1px solid ${colors.bg.input}` }}>
                {id}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
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

        {error && (
          <div style={{
            backgroundColor: colors.accent.red,
            padding: '10px 20px',
            borderRadius: 6,
            marginTop: 10,
          }}
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  // 大厅界面
  return (
    <div style={styles.page(40)}>
      <h1 style={{ textAlign: 'center', marginBottom: 40 }}>三国杀 - 多人对战</h1>

      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 40,
        flexWrap: 'wrap',
      }}
      >
        {/* 创建房间 */}
        <div style={{
          backgroundColor: colors.bg.panel,
          borderRadius: 12,
          padding: 30,
          minWidth: 300,
        }}
        >
          <h2 style={{ marginBottom: 20 }}>创建房间</h2>

          <div style={{ marginBottom: 15 }}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 14 }}>房间名称</label>
            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="输入房间名称"
              style={styles.input()}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 14 }}>最大玩家数</label>
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
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: connected ? colors.accent.red : colors.text.dim,
              color: colors.white,
              border: 'none',
              borderRadius: 6,
              cursor: connected ? 'pointer' : 'not-allowed',
              fontSize: 16,
              fontWeight: 'bold',
            }}
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
      <div style={{
        textAlign: 'center',
        marginTop: 30,
        color: connected ? colors.accent.green : colors.accent.red,
      }}
      >
        {connected ? '已连接到服务器' : '未连接，请检查服务器是否启动'}
      </div>

      {error && (
        <div style={styles.errorToast()}>
          {error}
        </div>
      )}
    </div>
  );
}
