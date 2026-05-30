import { describe, it, expect } from 'vitest';
import { GameController } from '@engine/game';
import { 曹操, 刘备 } from '@shared/characters';
import type { Card } from '@shared/types';

describe('双人对战', () => {
  it('应该能完成一局完整的2人游戏流程', () => {
    const { state: game, controller } = GameController.createGame([曹操, 刘备], 12345);

    expect(game.status).toBe('进行中');
    expect(game.players.length).toBe(2);
    expect(game.phase).toBe('出牌');

    const currentPlayerName = game.currentPlayer;
    const otherPlayerName = game.players.find(p => p.name !== currentPlayerName)!.name;

    const killCard = game.players.find(p => p.name === currentPlayerName)!.hand.find(c => c.name === '杀');
    if (killCard) {
      const result = controller.playCard(currentPlayerName, killCard.id, otherPlayerName);
      if (result.responseWindow) {
        const responses = new Map<string, import('@shared/types').Card | null>();
        responses.set(otherPlayerName, null);
        const resolveResult = controller.respondToWindow(responses);
        if (resolveResult.responseWindow?.type === 'dying') {
          controller.respondToWindow(new Map());
        }
      }
    }

    const endResult = controller.endTurn(currentPlayerName);
    expect(endResult.success || endResult.state.phase === '弃牌').toBe(true);

    if (endResult.state.phase === '弃牌') {
      const state = controller.getState();
      const me = state.players.find(p => p.name === currentPlayerName)!;
      if (me.hand.length > me.maxHealth) {
        const excess = me.hand.length - me.maxHealth;
        const indices = Array.from({ length: excess }, (_, i) => i);
        controller.discard(currentPlayerName, indices);
      }
      controller.endTurn(currentPlayerName);
    }

    const state = controller.getState();
    expect(state.currentPlayer).toBe(otherPlayerName);
  });

  it('应该正确处理伤害', () => {
    const { state: game, controller } = GameController.createGame([曹操, 刘备], 12345);

    const currentPlayerName = game.currentPlayer;
    const otherPlayerName = game.players.find(p => p.name !== currentPlayerName)!.name;

    const killCard = game.players.find(p => p.name === currentPlayerName)!.hand.find(c => c.name === '杀');
    if (killCard) {
      controller.playCard(currentPlayerName, killCard.id, otherPlayerName);
      const responses = new Map<string, import('@shared/types').Card | null>();
      responses.set(otherPlayerName, null);
      const resolveResult = controller.respondToWindow(responses);
      if (resolveResult.responseWindow?.type === 'dying') {
        controller.respondToWindow(new Map());
      }
    }

    const otherPlayer = controller.getState().players.find(p => p.name === otherPlayerName)!;
    expect(otherPlayer.health).toBeLessThan(otherPlayer.maxHealth);
  });
});
