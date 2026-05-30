// server/session.ts
import type { PlayerAction, Card } from '../shared/types';
import type { Room } from './room';
import { GameController } from '../engine/game';
import { allCharacters } from '../shared/characters';
import { serialize } from './protocol';
import { setRoomStatus } from './room';

export class GameSession {
  private controller: GameController | null = null;
  private room: Room;
  private playerNames = new Map<string, string>(); // playerId -> playerName

  constructor(room: Room) {
    this.room = room;
  }

  startGame(): boolean {
    if (this.room.players.size < 2) return false;

    const seed = Date.now();
    const shuffled = [...allCharacters].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, this.room.players.size);

    const playerIds = [...this.room.players.keys()];
    for (let i = 0; i < playerIds.length; i++) {
      this.playerNames.set(playerIds[i], selected[i].name);
    }

    // GameController 管理种子化 RNG、技能注册、初始摸牌、回合推进
    const { controller } = GameController.createGame(selected, seed);
    this.controller = controller;

    setRoomStatus(this.room.id, '进行中');
    this.broadcastState();
    this.notifyCurrentPlayer();
    return true;
  }

  handleAction(playerId: string, action: PlayerAction): void {
    if (!this.controller) {
      this.sendToPlayer(playerId, { type: 'error', message: '游戏未开始' });
      return;
    }

    const playerName = this.playerNames.get(playerId);
    if (!playerName) {
      this.sendToPlayer(playerId, { type: 'error', message: '玩家不在游戏中' });
      return;
    }

    const state = this.controller.getState();
    if (state.status === '已结束') {
      this.sendToPlayer(playerId, { type: 'error', message: '游戏已结束' });
      return;
    }

    const responseWindow = this.controller.getCurrentResponseWindow();
    if (responseWindow && action.type === '响应') {
      this.handleResponse(playerName, action);
      return;
    }

    if (state.currentPlayer !== playerName) {
      this.sendToPlayer(playerId, { type: 'error', message: '不是你的回合' });
      return;
    }

    switch (action.type) {
      case '出牌':
        this.handlePlayCard(playerName, action);
        break;
      case '结束回合':
        this.handleEndTurn(playerName);
        break;
      case '弃牌':
        this.handleDiscard(playerName, action);
        break;
      case '发动技能':
        this.handleActivateSkill(playerName, action);
        break;
      default:
        this.sendToPlayer(playerId, { type: 'error', message: '未知操作' });
    }
  }

  private handlePlayCard(playerName: string, action: PlayerAction): void {
    if (!this.controller || action.type !== '出牌') return;

    const result = this.controller.playCard(playerName, action.card.id, action.target);

    if (!result.success) {
      this.sendToPlayerByName(playerName, { type: 'error', message: '操作失败' });
      return;
    }

    if (result.responseWindow) {
      this.notifyResponders(result.responseWindow);
    }

    this.checkGameEnd();
    this.broadcastState();
  }

  private handleEndTurn(playerName: string): void {
    if (!this.controller) return;

    const result = this.controller.endTurn(playerName);

    if (!result.success) {
      const state = this.controller.getState();
      if (state.phase === '弃牌') {
        this.sendToPlayerByName(playerName, {
          type: 'prompt',
          promptId: 'discard',
          prompt: {
            name: '弃牌',
            description: '手牌超过体力上限，请弃牌',
            type: 'select_card',
            options: [],
          },
        });
        this.broadcastState();
        return;
      }

      this.sendToPlayerByName(playerName, { type: 'error', message: '无法结束回合' });
      return;
    }

    this.checkGameEnd();
    this.broadcastState();
    this.notifyCurrentPlayer();
  }

  private handleDiscard(playerName: string, action: PlayerAction): void {
    if (!this.controller || action.type !== '弃牌') return;

    const state = this.controller.getState();
    const player = state.players.find(p => p.name === playerName);
    if (!player) return;

    const indices: number[] = [];
    for (const card of action.cards) {
      const idx = player.hand.findIndex(c => c.id === card.id);
      if (idx >= 0) indices.push(idx);
    }

    if (indices.length === 0) return;

    const result = this.controller.discard(playerName, indices);

    this.checkGameEnd();
    this.broadcastState();
    this.notifyCurrentPlayer();
  }

  private handleActivateSkill(playerName: string, action: PlayerAction): void {
    if (!this.controller || action.type !== '发动技能') return;

    const skills = this.controller.getValidActionsForPlayer(playerName).skills;
    const skillIndex = skills.findIndex(s => s.name === action.skillName);

    if (skillIndex === -1) {
      this.sendToPlayerByName(playerName, { type: 'error', message: '技能不可用' });
      return;
    }

    const result = this.controller.activateSkill(playerName, skillIndex, action.target);

    if (!result.success) {
      this.sendToPlayerByName(playerName, { type: 'error', message: '技能发动失败' });
      return;
    }

    this.checkGameEnd();
    this.broadcastState();
  }

  private handleResponse(playerName: string, action: PlayerAction): void {
    if (!this.controller || action.type !== '响应') return;

    const responses = new Map<string, Card | null>();
    responses.set(playerName, action.card ?? null);

    const result = this.controller.respondToWindow(responses);

    if (result.responseWindow) {
      this.notifyResponders(result.responseWindow);
    }

    this.checkGameEnd();
    this.broadcastState();
  }

  private notifyResponders(window: import('../engine/types').ResponseWindow): void {
    for (const responderName of window.validResponders) {
      for (const [playerId, name] of this.playerNames) {
        if (name === responderName) {
          this.sendToPlayer(playerId, {
            type: 'prompt',
            promptId: `response_${window.type}`,
            prompt: {
              name: window.type === 'kill_response' ? '请出闪' :
                window.type === 'aoe_response' ? `请出${window.validCards[0] ?? '牌'}` :
                  window.type === 'dying' ? '请出桃' : '请响应',
              description: `${window.requester} 对你使用了牌，请选择是否响应`,
              type: 'select_card',
              options: window.validCards,
            },
          });
        }
      }
    }
  }

  private checkGameEnd(): void {
    if (!this.controller) return;

    const state = this.controller.getState();
    if (state.status === '已结束') {
      setRoomStatus(this.room.id, '已结束');
      this.broadcast({ type: 'game_over', winner: state.winner! });
    }
  }

  broadcastState(): void {
    if (!this.controller) return;

    const state = this.controller.getState();
    if (state.status !== '进行中') return;

    for (const [playerId, playerName] of this.playerNames) {
      const publicState = this.controller.getPublicState(playerName);
      this.sendToPlayer(playerId, { type: 'state_update', state: publicState });
    }
  }

  notifyCurrentPlayer(): void {
    if (!this.controller) return;

    const state = this.controller.getState();
    for (const [playerId, playerName] of this.playerNames) {
      if (playerName === state.currentPlayer) {
        this.sendToPlayer(playerId, { type: 'your_turn', phase: state.phase });
      }
    }
  }

  handleDisconnect(playerId: string): void {
    if (!this.controller) return;

    const playerName = this.playerNames.get(playerId) ?? '未知玩家';
    const state = this.controller.getState();
    if (state.status === '进行中') {
      setRoomStatus(this.room.id, '已结束');
      this.broadcast({ type: 'error', message: `${playerName} 断开连接，游戏结束` });
    }
  }

  getPlayerName(playerId: string): string | undefined {
    return this.playerNames.get(playerId);
  }

  private sendToPlayer(playerId: string, message: import('./protocol').ServerMessage): void {
    const ws = this.room.players.get(playerId);
    if (ws) {
      try {
        ws.send(serialize(message));
      } catch {
        // 忽略发送失败
      }
    }
  }

  private sendToPlayerByName(playerName: string, message: import('./protocol').ServerMessage): void {
    for (const [playerId, name] of this.playerNames) {
      if (name === playerName) {
        this.sendToPlayer(playerId, message);
        return;
      }
    }
  }

  private broadcast(message: import('./protocol').ServerMessage): void {
    const data = serialize(message);
    for (const [, ws] of this.room.players) {
      try {
        ws.send(data);
      } catch {
        // 忽略发送失败
      }
    }
  }
}
