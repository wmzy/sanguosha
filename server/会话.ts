// server/会话.ts
import type { GameState, PlayerAction } from '../shared/types';
import type { Room } from './房间';
import { createGame, getPublicState, startGame } from '../engine/state';
import { nextPhase, drawPhase, checkDiscard, executeDiscard } from '../engine/turn';
import { playKill, playPeach } from '../engine/effect';
import { allCharacters } from '../shared/characters';
import { serialize } from './协议';
import { setRoomStatus } from './房间';

export class GameSession {
  private state: GameState | null = null;
  private room: Room;
  private playerNames = new Map<string, string>(); // playerId -> playerName

  constructor(room: Room) {
    this.room = room;
  }

  startGame(): boolean {
    if (this.room.players.size < 2) return false;

    // 随机分配角色
    const shuffled = [...allCharacters].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, this.room.players.size);

    // 映射 playerId -> playerName
    const playerIds = [...this.room.players.keys()];
    for (let i = 0; i < playerIds.length; i++) {
      this.playerNames.set(playerIds[i], selected[i].name);
    }

    this.state = createGame(selected);
    this.state = startGame(this.state);

    // 初始摸牌
    for (let i = 0; i < this.state.players.length; i++) {
      this.state = this.drawForCurrentPlayer();
      this.state = nextPhase(this.state);
    }

    setRoomStatus(this.room.id, '进行中');
    this.broadcastState();

    // 通知当前玩家
    this.notifyCurrentPlayer();
    return true;
  }

  private drawForCurrentPlayer(): GameState {
    if (!this.state) throw new Error('游戏未开始');
    const result = drawPhase(this.state);
    this.state = result.state;
    return this.state;
  }

  handleAction(playerId: string, action: PlayerAction): void {
    if (!this.state) {
      this.sendToPlayer(playerId, { type: 'error', message: '游戏未开始' });
      return;
    }

    const playerName = this.playerNames.get(playerId);
    if (!playerName) {
      this.sendToPlayer(playerId, { type: 'error', message: '玩家不在游戏中' });
      return;
    }

    if (this.state.currentPlayer !== playerName) {
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
    }
  }

  private handlePlayCard(playerName: string, action: PlayerAction): void {
    if (!this.state) return;
    if (action.type !== '出牌') return;

    const card = action.card;
    if (card.name === '杀') {
      const target = action.target;
      if (!target) {
        this.sendToPlayerByName(playerName, { type: 'error', message: '未选择目标' });
        return;
      }
      const result = playKill(this.state, playerName, target);
      if (result.success) {
        this.state = result.state;
        this.removeCardFromHand(playerName, card);
        this.broadcastState();
      } else {
        this.sendToPlayerByName(playerName, { type: 'error', message: result.message });
      }
    } else if (card.name === '桃') {
      const result = playPeach(this.state, playerName);
      if (result.success) {
        this.state = result.state;
        this.removeCardFromHand(playerName, card);
        this.broadcastState();
      } else {
        this.sendToPlayerByName(playerName, { type: 'error', message: result.message });
      }
    }
  }

  private handleEndTurn(playerName: string): void {
    if (!this.state) return;

    // 跳过当前出牌阶段，进入弃牌阶段
    this.state = { ...this.state, phase: '弃牌' };

    // 检查是否需要弃牌
    if (checkDiscard(this.state)) {
      // 通知玩家需要弃牌
      this.sendToPlayerByName(playerName, {
        type: 'prompt',
        promptId: 'discard',
        prompt: { name: '弃牌', description: '手牌超过体力上限，请弃牌', type: 'select_card', options: [] },
      });
      return;
    }

    // 完成回合
    this.completeTurn();
  }

  private handleDiscard(playerName: string, action: PlayerAction): void {
    if (!this.state) return;
    if (action.type !== '弃牌') return;
    // 简化：弃第一张牌
    const card = action.cards[0];
    if (card) {
      const player = this.state.players.find(p => p.name === playerName);
      if (player) {
        const index = player.hand.findIndex(c => c.name === card.name && c.suit === card.suit && c.rank === card.rank);
        if (index >= 0) {
          this.state = executeDiscard(this.state, [index]);
        }
      }
    }
    this.completeTurn();
  }

  private completeTurn(): void {
    if (!this.state) return;

    // 跳过弃牌和结束阶段，进入下一玩家的准备阶段
    this.state = nextPhase(this.state); // 弃牌 -> 结束
    this.state = nextPhase(this.state); // 结束 -> 准备（下一玩家）

    // 检查游戏是否结束
    const winner = this.checkGameEnd();
    if (winner) {
      this.state = { ...this.state, status: '已结束', winner };
      setRoomStatus(this.room.id, '已结束');
      this.broadcast({ type: 'game_over', winner });
      this.broadcastState();
      return;
    }

    // 新回合摸牌
    this.state = nextPhase(this.state); // 准备 -> 判定
    this.state = nextPhase(this.state); // 判定 -> 摸牌
    this.state = this.drawForCurrentPlayer();
    this.state = nextPhase(this.state); // 摸牌 -> 出牌

    this.broadcastState();
    this.notifyCurrentPlayer();
  }

  private checkGameEnd(): import('../shared/types').Role | null {
    if (!this.state) return null;

    // 检查体力为0的玩家
    for (const player of this.state.players) {
      if (player.health <= 0 && player.alive) {
        player.alive = false;
      }
    }

    const alivePlayers = this.state.players.filter(p => p.alive);

    // 主公死了，反贼赢
    const lord = this.state.players.find(p => p.role === '主公');
    if (lord && !lord.alive) return '反贼';

    // 只剩主公和内奸，主公赢
    if (alivePlayers.length === 1) return alivePlayers[0].role;

    // 反贼全死，主公赢
    const aliveRebels = alivePlayers.filter(p => p.role === '反贼');
    if (aliveRebels.length === 0 && alivePlayers.length > 0) return '主公';

    return null;
  }

  private removeCardFromHand(playerName: string, card: import('../shared/types').Card): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      players: this.state.players.map(p => {
        if (p.name === playerName) {
          const index = p.hand.findIndex(c => c.name === card.name && c.suit === card.suit && c.rank === card.rank);
          if (index >= 0) {
            const newHand = [...p.hand];
            newHand.splice(index, 1);
            return { ...p, hand: newHand };
          }
        }
        return p;
      }),
    };
  }

  broadcastState(): void {
    if (!this.state) return;

    for (const [playerId, playerName] of this.playerNames) {
      const publicState = getPublicState(this.state, playerName);
      this.sendToPlayer(playerId, { type: 'state_update', state: publicState });
    }
  }

  notifyCurrentPlayer(): void {
    if (!this.state) return;

    for (const [playerId, playerName] of this.playerNames) {
      if (playerName === this.state.currentPlayer) {
        this.sendToPlayer(playerId, { type: 'your_turn', phase: this.state.phase });
      }
    }
  }

  handleDisconnect(playerId: string): void {
    const playerName = this.playerNames.get(playerId) ?? '未知玩家';
    if (this.state?.status === '进行中') {
      this.state = { ...this.state, status: '已结束' };
      setRoomStatus(this.room.id, '已结束');
      this.broadcast({ type: 'error', message: `${playerName} 断开连接，游戏结束` });
    }
  }

  getPlayerName(playerId: string): string | undefined {
    return this.playerNames.get(playerId);
  }

  private sendToPlayer(playerId: string, message: import('./协议').ServerMessage): void {
    const ws = this.room.players.get(playerId);
    if (ws) {
      try {
        ws.send(serialize(message));
      } catch {
        // 忽略发送失败
      }
    }
  }

  private sendToPlayerByName(playerName: string, message: import('./协议').ServerMessage): void {
    for (const [playerId, name] of this.playerNames) {
      if (name === playerName) {
        this.sendToPlayer(playerId, message);
        return;
      }
    }
  }

  private broadcast(message: import('./协议').ServerMessage): void {
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
