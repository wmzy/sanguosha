// server/会话.ts
import type { GameState, PlayerAction } from '../shared/types';
import type { Room } from './房间';
import { 创建游戏, 获取公开状态, 开始游戏 } from '../engine/state';
import { 进入下一阶段, 摸牌阶段, 弃牌阶段检查, 弃牌阶段执行 } from '../engine/turn';
import { 使用杀, 使用桃 } from '../engine/effect';
import { 所有角色 } from '../shared/characters';
import { serialize } from './协议';
import { 设置房间状态 } from './房间';

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
    const shuffled = [...所有角色].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, this.room.players.size);

    // 映射 playerId -> playerName
    const playerIds = [...this.room.players.keys()];
    for (let i = 0; i < playerIds.length; i++) {
      this.playerNames.set(playerIds[i], selected[i].name);
    }

    this.state = 创建游戏(selected);
    this.state = 开始游戏(this.state);

    // 初始摸牌
    for (let i = 0; i < this.state.玩家列表.length; i++) {
      this.state = this.摸牌给当前玩家();
      this.state = 进入下一阶段(this.state);
    }

    设置房间状态(this.room.id, '进行中');
    this.broadcastState();

    // 通知当前玩家
    this.notifyCurrentPlayer();
    return true;
  }

  private 摸牌给当前玩家(): GameState {
    if (!this.state) throw new Error('游戏未开始');
    const result = 摸牌阶段(this.state);
    this.state = result.状态;
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

    if (this.state.当前玩家 !== playerName) {
      this.sendToPlayer(playerId, { type: 'error', message: '不是你的回合' });
      return;
    }

    switch (action.类型) {
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

    const card = action.卡牌;
    if (!card) {
      this.sendToPlayerByName(playerName, { type: 'error', message: '未选择卡牌' });
      return;
    }

    if (card.name === '杀') {
      const target = action.目标;
      if (!target) {
        this.sendToPlayerByName(playerName, { type: 'error', message: '未选择目标' });
        return;
      }
      const result = 使用杀(this.state, playerName, target);
      if (result.成功) {
        this.state = result.状态;
        this.removeCardFromHand(playerName, card);
        this.broadcastState();
      } else {
        this.sendToPlayerByName(playerName, { type: 'error', message: result.消息 });
      }
    } else if (card.name === '桃') {
      const result = 使用桃(this.state, playerName);
      if (result.成功) {
        this.state = result.状态;
        this.removeCardFromHand(playerName, card);
        this.broadcastState();
      } else {
        this.sendToPlayerByName(playerName, { type: 'error', message: result.消息 });
      }
    }
  }

  private handleEndTurn(playerName: string): void {
    if (!this.state) return;

    // 跳过当前出牌阶段，进入弃牌阶段
    this.state = { ...this.state, 当前阶段: '弃牌' };

    // 检查是否需要弃牌
    if (弃牌阶段检查(this.state)) {
      // 通知玩家需要弃牌
      this.sendToPlayerByName(playerName, {
        type: 'prompt',
        promptId: 'discard',
        prompt: { name: '弃牌', 描述: '手牌超过体力上限，请弃牌', 类型: 'select_card', 选项: [] },
      });
      return;
    }

    // 完成回合
    this.completeTurn();
  }

  private handleDiscard(playerName: string, action: PlayerAction): void {
    if (!this.state) return;
    // 简化：弃第一张牌
    const card = action.卡牌;
    if (card) {
      const player = this.state.玩家列表.find(p => p.name === playerName);
      if (player) {
        const index = player.手牌.findIndex(c => c.name === card.name && c.花色 === card.花色 && c.点数 === card.点数);
        if (index >= 0) {
          this.state = 弃牌阶段执行(this.state, [index]);
        }
      }
    }
    this.completeTurn();
  }

  private completeTurn(): void {
    if (!this.state) return;

    // 跳过弃牌和结束阶段，进入下一玩家的准备阶段
    this.state = 进入下一阶段(this.state); // 弃牌 -> 结束
    this.state = 进入下一阶段(this.state); // 结束 -> 准备（下一玩家）

    // 检查游戏是否结束
    const winner = this.checkGameEnd();
    if (winner) {
      this.state = { ...this.state, 状态: '已结束', 获胜身份: winner };
      设置房间状态(this.room.id, '已结束');
      this.broadcast({ type: 'game_over', winner });
      this.broadcastState();
      return;
    }

    // 新回合摸牌
    this.state = 进入下一阶段(this.state); // 准备 -> 判定
    this.state = 进入下一阶段(this.state); // 判定 -> 摸牌
    this.state = this.摸牌给当前玩家();
    this.state = 进入下一阶段(this.state); // 摸牌 -> 出牌

    this.broadcastState();
    this.notifyCurrentPlayer();
  }

  private checkGameEnd(): import('../shared/types').Role | null {
    if (!this.state) return null;

    const _存活玩家 = this.state.玩家列表.filter(p => p.存活);

    // 检查体力为0的玩家
    for (const player of this.state.玩家列表) {
      if (player.体力 <= 0 && player.存活) {
        player.存活 = false;
      }
    }

    const 仍然存活 = this.state.玩家列表.filter(p => p.存活);

    // 主公死了，反贼赢
    const 主公 = this.state.玩家列表.find(p => p.身份 === '主公');
    if (主公 && !主公.存活) return '反贼';

    // 只剩主公和内奸，主公赢
    if (仍然存活.length === 1) return 仍然存活[0].身份;

    // 反贼全死，主公赢
    const 反贼存活 = 仍然存活.filter(p => p.身份 === '反贼');
    if (反贼存活.length === 0 && 仍然存活.length > 0) return '主公';

    return null;
  }

  private removeCardFromHand(playerName: string, card: import('../shared/types').Card): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      玩家列表: this.state.玩家列表.map(p => {
        if (p.name === playerName) {
          const index = p.手牌.findIndex(c => c.name === card.name && c.花色 === card.花色 && c.点数 === card.点数);
          if (index >= 0) {
            const newHand = [...p.手牌];
            newHand.splice(index, 1);
            return { ...p, 手牌: newHand };
          }
        }
        return p;
      }),
    };
  }

  broadcastState(): void {
    if (!this.state) return;

    for (const [playerId, playerName] of this.playerNames) {
      const publicState = 获取公开状态(this.state, playerName);
      this.sendToPlayer(playerId, { type: 'state_update', state: publicState });
    }
  }

  notifyCurrentPlayer(): void {
    if (!this.state) return;

    for (const [playerId, playerName] of this.playerNames) {
      if (playerName === this.state.当前玩家) {
        this.sendToPlayer(playerId, { type: 'your_turn', phase: this.state.当前阶段 });
      }
    }
  }

  handleDisconnect(_playerId: string): void {
    // 暂停游戏，等待重连
    // 简化实现：直接结束游戏
    if (this.state?.状态 === '进行中') {
      this.state = { ...this.state, 状态: '已结束' };
      设置房间状态(this.room.id, '已结束');
      this.broadcast({ type: 'error', message: '玩家断开连接，游戏结束' });
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
