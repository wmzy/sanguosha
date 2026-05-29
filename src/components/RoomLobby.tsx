// src/components/RoomLobby.tsx
import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { RoomInfo } from '../../server/protocol';

interface RoomLobbyProps {
  onJoinRoom: (roomId: string, playerId: string) => void;
}

export function RoomLobby({ onJoinRoom }: RoomLobbyProps) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected, lastMessage, send, connect } = useWebSocket(wsUrl);

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

  // 获取房间列表
  useEffect(() => {
    if (connected) {
      send({ type: 'list_rooms' });
    }
  }, [connected, send]);

  // 处理消息
  useEffect(() => {
    if (!lastMessage) return;

    const message = lastMessage;

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
  }, [lastMessage, currentRoom, playerId, onJoinRoom, rooms]);

  const handleCreateRoom = useCallback(() => {
    if (!roomName.trim()) {
      setError('请输入房间名称');
      return;
    }
    send({ type: 'create_room', name: roomName.trim(), maxPlayers });
  }, [roomName, maxPlayers, send]);

  const handleJoinRoom = useCallback((roomId: string) => {
    send({ type: 'join_room', roomId });
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
    send({ type: 'list_rooms' });
  }, [send]);

  // 房间内等待界面
  if (currentRoom) {
    return (
      <div style={{
        padding: 40,
        backgroundColor: '#1a1a2e',
        minHeight: '100vh',
        color: '#eee',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      >
        <h1 style={{ marginBottom: 30 }}>房间: {currentRoom}</h1>

        <div style={{
          backgroundColor: '#2c3e50',
          borderRadius: 12,
          padding: 30,
          minWidth: 300,
          marginBottom: 20,
        }}
        >
          <h2 style={{ marginBottom: 20 }}>玩家列表</h2>
          <div style={{ marginBottom: 20 }}>
            <div style={{ padding: '8px 0', borderBottom: '1px solid #34495e' }}>
              {playerId} (你) {isHost ? '- 房主' : ''} {isReady ? '- 已准备' : ''}
            </div>
            {playersInRoom.map(id => (
              <div key={id} style={{ padding: '8px 0', borderBottom: '1px solid #34495e' }}>
                {id}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            {!isReady && (
              <button
                onClick={handleReady}
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#2ecc71',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                准备
              </button>
            )}

            {isHost && (
              <button
                onClick={handleStartGame}
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#e74c3c',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                开始游戏
              </button>
            )}

            <button
              onClick={handleLeaveRoom}
              style={{
                padding: '10px 24px',
                backgroundColor: '#7f8c8d',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              离开房间
            </button>
          </div>
        </div>

        {error && (
          <div style={{
            backgroundColor: '#e74c3c',
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
    <div style={{
      padding: 40,
      backgroundColor: '#1a1a2e',
      minHeight: '100vh',
      color: '#eee',
    }}
    >
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
          backgroundColor: '#2c3e50',
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
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#34495e',
                border: 'none',
                borderRadius: 6,
                color: 'white',
                fontSize: 14,
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 14 }}>最大玩家数</label>
            <select
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#34495e',
                border: 'none',
                borderRadius: 6,
                color: 'white',
                fontSize: 14,
              }}
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
              backgroundColor: connected ? '#e74c3c' : '#7f8c8d',
              color: 'white',
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

        {/* 房间列表 */}
        <div style={{
          backgroundColor: '#2c3e50',
          borderRadius: 12,
          padding: 30,
          minWidth: 300,
          maxWidth: 400,
        }}
        >
          <h2 style={{ marginBottom: 20 }}>房间列表</h2>

          <div style={{ marginBottom: 15 }}>
            <button
              onClick={() => send({ type: 'list_rooms' })}
              style={{
                padding: '8px 16px',
                backgroundColor: '#3498db',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              刷新列表
            </button>
          </div>

          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {rooms.length === 0 ? (
              <div style={{ color: '#7f8c8d', textAlign: 'center', padding: 20 }}>
                暂无房间
              </div>
            ) : (
              rooms.map(room => (
                <div
                  key={room.id}
                  style={{
                    backgroundColor: '#34495e',
                    borderRadius: 8,
                    padding: 15,
                    marginBottom: 10,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{room.name}</div>
                    <div style={{ fontSize: 12, color: '#95a5a6' }}>
                      {room.playerCount}/{room.maxPlayers} 玩家 | {room.status}
                    </div>
                  </div>
                  <button
                    onClick={() => handleJoinRoom(room.id)}
                    disabled={room.status !== '等待中' || room.playerCount >= room.maxPlayers}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: room.status === '等待中' && room.playerCount < room.maxPlayers ? '#2ecc71' : '#7f8c8d',
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      cursor: room.status === '等待中' && room.playerCount < room.maxPlayers ? 'pointer' : 'not-allowed',
                      fontSize: 13,
                    }}
                  >
                    加入
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 连接状态 */}
      <div style={{
        textAlign: 'center',
        marginTop: 30,
        color: connected ? '#2ecc71' : '#e74c3c',
      }}
      >
        {connected ? '已连接到服务器' : '未连接，请检查服务器是否启动'}
      </div>

      {error && (
        <div style={{
          position: 'fixed',
          top: 20,
          right: 20,
          backgroundColor: '#e74c3c',
          padding: '15px 25px',
          borderRadius: 8,
          zIndex: 1000,
        }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
