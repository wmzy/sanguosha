// tests/unit/协议.test.ts
import { describe, it, expect } from 'vitest';
import { serialize, deserialize, isValidClientMessage } from '../../server/协议';
import type { ServerMessage, ClientMessage } from '../../server/协议';

describe('消息协议', () => {
  describe('序列化', () => {
    it('应该序列化 state_update 消息', () => {
      const message: ServerMessage = {
        type: 'state_update',
        state: {
          玩家列表: [],
          弃牌堆: [],
          当前玩家: '曹操',
          当前阶段: '出牌',
          回合数: 1,
          状态: '进行中',
        },
      };

      const result = serialize(message);
      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe('state_update');
    });

    it('应该序列化 error 消息', () => {
      const message: ServerMessage = {
        type: 'error',
        message: '测试错误',
      };

      const result = serialize(message);
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe('error');
      expect(parsed.message).toBe('测试错误');
    });

    it('应该序列化 room_joined 消息', () => {
      const message: ServerMessage = {
        type: 'room_joined',
        roomId: 'ABC123',
        playerId: 'player1',
      };

      const result = serialize(message);
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe('room_joined');
      expect(parsed.roomId).toBe('ABC123');
    });

    it('应该序列化 game_over 消息', () => {
      const message: ServerMessage = {
        type: 'game_over',
        winner: '主公',
      };

      const result = serialize(message);
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe('game_over');
      expect(parsed.winner).toBe('主公');
    });
  });

  describe('反序列化', () => {
    it('应该反序列化 action 消息', () => {
      const message: ClientMessage = {
        type: 'action',
        action: { 类型: '出牌', 卡牌: { name: '杀', 类型: '基本牌', 子类型: '杀', 花色: '♠', 点数: '3', 描述: '' } },
      };

      const data = JSON.stringify(message);
      const result = deserialize(data);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('action');
    });

    it('应该反序列化 create_room 消息', () => {
      const message: ClientMessage = {
        type: 'create_room',
        name: '测试房间',
        maxPlayers: 4,
      };

      const data = JSON.stringify(message);
      const result = deserialize(data);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('create_room');
      if (result!.type === 'create_room') {
        expect(result!.name).toBe('测试房间');
        expect(result!.maxPlayers).toBe(4);
      }
    });

    it('应该反序列化 join_room 消息', () => {
      const message: ClientMessage = {
        type: 'join_room',
        roomId: 'ABC123',
      };

      const data = JSON.stringify(message);
      const result = deserialize(data);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('join_room');
    });

    it('应该反序列化 ready 消息', () => {
      const message: ClientMessage = { type: 'ready' };
      const data = JSON.stringify(message);
      const result = deserialize(data);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('ready');
    });

    it('应该处理无效的JSON', () => {
      const result = deserialize('invalid json');
      expect(result).toBeNull();
    });

    it('应该处理无效的消息格式', () => {
      const result = deserialize('{"invalid": true}');
      expect(result).toBeNull();
    });
  });

  describe('消息验证', () => {
    it('应该验证有效的 action 消息', () => {
      const message = {
        type: 'action',
        action: { 类型: '出牌' },
      };
      expect(isValidClientMessage(message)).toBe(true);
    });

    it('应该验证有效的 create_room 消息', () => {
      const message = {
        type: 'create_room',
        name: '测试',
        maxPlayers: 4,
      };
      expect(isValidClientMessage(message)).toBe(true);
    });

    it('应该拒绝无效的消息类型', () => {
      const message = { type: 'invalid_type' };
      expect(isValidClientMessage(message)).toBe(false);
    });

    it('应该拒绝缺少必要字段的消息', () => {
      const message = { type: 'create_room' }; // 缺少 name 和 maxPlayers
      expect(isValidClientMessage(message)).toBe(false);
    });

    it('应该拒绝非对象', () => {
      expect(isValidClientMessage('string')).toBe(false);
      expect(isValidClientMessage(null)).toBe(false);
      expect(isValidClientMessage(123)).toBe(false);
    });
  });
});
