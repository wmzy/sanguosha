/**
 * 游戏控制器 — 所有游戏逻辑集中在这里
 *
 * 职责：
 * - 验证玩家操作
 * - 执行游戏逻辑
 * - 管理状态转换
 * - 返回新状态 + 事件日志
 *
 * 不负责：
 * - UI 渲染
 * - 计时器
 * - 网络通信
 */

import type { GameState, Card } from '../shared/types';
import { GameLogger } from './logger';
import { createGame, startGame } from './state';
import { nextPhase, drawPhase, checkDiscard, executeDiscard } from './turn';
import { playKill, playPeach, playDismantle, playSteal, playDrawTwo, playArrowBarrage, playBarbarianInvasion, playPeachGarden, playAbundance } from './effect';
import { getValidTargetsForCard, isCardPlayable } from './rules';
import { getDyingOptions, applyDying, applyPeachSave } from './dying';
import { getAvailableSkills, executeSkill } from './skill';

// ============================================================
// 操作结果
// ============================================================

export interface ActionResult {
  success: boolean;
  state: GameState;
  events: GameEvent[];
  needsInput?: InputRequest;
}

export interface GameEvent {
  type: string;
  data: unknown;
  description: string;
}

export type InputRequest =
  | { type: 'select_target'; data: { validTargets: string[]; card: Card } }
  | { type: 'select_cards'; data: { count: number } }
  | { type: 'respond_kill'; data: { attacker: string; target: string; card: Card } }
  | { type: 'respond_dying'; data: { player: string; savers: string[] } }
  | { type: 'activate_skill'; data: { skillIndex: number } };

// ============================================================
// 游戏控制器
// ============================================================

export class GameController {
  private state: GameState;
  private logger: GameLogger;

  constructor(state: GameState, logger: GameLogger) {
    this.state = state;
    this.logger = logger;
  }

  getState(): GameState {
    return this.state;
  }

  // ============================================================
  // 游戏初始化
  // ============================================================

  static createGame(characters: import('../shared/types').CharacterConfig[], seed?: number, externalLogger?: GameLogger): { state: GameState; controller: GameController } {
    const rawState = createGame(characters, seed);
    const logger = externalLogger ?? new GameLogger({
      version: '1.0.0',
      createdAt: Date.now(),
      playerCount: characters.length,
      characters: characters.map(c => c.name),
      seed: seed ?? Date.now(),
    });
    const controller = new GameController(rawState, logger);
    // Start game and deal initial cards
    controller.state = startGame(controller.state, logger);
    // Advance to play phase (auto-draw for first player)
    controller.advanceToPlayPhase();
    return { state: controller.state, controller };
  }

  // ============================================================
  // 出牌
  // ============================================================

  playCard(playerName: string, cardIndex: number, target?: string): ActionResult {
    const player = this.state.players.find(p => p.name === playerName);
    if (!player) return this.fail('玩家不存在');

    const card = player.hand[cardIndex];
    if (!card) return this.fail('卡牌不存在');

    if (!isCardPlayable(this.state, player, card)) {
      return this.fail('这张牌不能使用');
    }

    // 需要目标的牌
    const needsTarget = ['杀', '过河拆桥', '顺手牵羊', '决斗', '乐不思蜀', '兵粮寸断', '闪电'].includes(card.name);
    if (needsTarget) {
      const validTargets = getValidTargetsForCard(this.state, player, card);
      if (!target || !validTargets.includes(target)) {
        return {
          success: false,
          state: this.state,
          events: [],
          needsInput: { type: 'select_target', data: { validTargets, card } },
        };
      }
    }

    // 执行出牌
    let result: ActionResult;
    switch (card.name) {
      case '杀':
        result = this.executeKill(playerName, card, target!);
        break;
      case '桃':
        result = this.executePeach(playerName, card);
        break;
      case '过河拆桥':
        result = this.executeDismantle(playerName, card, target!);
        break;
      case '顺手牵羊':
        result = this.executeSteal(playerName, card, target!);
        break;
      case '无中生有':
        result = this.executeDrawTwo(playerName, card);
        break;
      case '万箭齐发':
        result = this.executeArrowBarrage(playerName, card);
        break;
      case '南蛮入侵':
        result = this.executeBarbarianInvasion(playerName, card);
        break;
      case '桃园结义':
        result = this.executePeachGarden(playerName, card);
        break;
      case '五谷丰登':
        result = this.executeAbundance(playerName, card);
        break;
      case '乐不思蜀':
      case '兵粮寸断':
      case '闪电':
        result = this.executeDelayedTrick(playerName, card, target!);
        break;
      default:
        // 装备牌
        if (card.subtype === '武器' || card.subtype === '防具' || card.subtype === '进攻马' || card.subtype === '防御马') {
          result = this.executeEquip(playerName, card);
        } else {
          return this.fail('未知卡牌类型');
        }
    }

    // 杀和装备牌的移除由各自的 execute* 方法处理
    // 其他卡牌在这里移除并加入弃牌堆
    const selfManaged = card.name === '杀' || card.subtype === '武器' || card.subtype === '防具' || card.subtype === '进攻马' || card.subtype === '防御马';
    if (result.success && !selfManaged) {
      // 使用 execute* 返回的状态（包含效果结果），再移除手牌
      const baseState = result.state;
      const currentPlayerInResult = baseState.players.find(p => p.name === playerName);
      if (currentPlayerInResult) {
        const cardIdx = currentPlayerInResult.hand.findIndex(
          c => c.name === card.name && c.suit === card.suit && c.rank === card.rank,
        );
        if (cardIdx >= 0) {
          const newHand = [...currentPlayerInResult.hand];
          newHand.splice(cardIdx, 1);
          this.state = {
            ...baseState,
            players: baseState.players.map(p =>
              p.name === playerName ? { ...p, hand: newHand } : p,
            ),
            discardPile: [...baseState.discardPile, card],
          };
        } else {
          this.state = baseState;
        }
      } else {
        this.state = baseState;
      }
    } else if (result.success) {
      this.state = result.state;
    }

    return result;
  }

  // ============================================================
  // 结束回合
  // ============================================================

  endTurn(playerName: string): ActionResult {
    if (this.state.currentPlayer !== playerName) {
      return this.fail('不是你的回合');
    }

    // 如果需要弃牌，返回弃牌请求
    if (this.state.phase === '弃牌' && checkDiscard(this.state)) {
      return {
        success: false,
        state: this.state,
        events: [],
        needsInput: { type: 'select_cards', data: { count: this.state.players.find(p => p.name === playerName)!.hand.length - this.state.players.find(p => p.name === playerName)!.maxHealth } },
      };
    }

    // 推进阶段
    this.state = nextPhase(this.state, this.logger);

    // 如果进入弃牌阶段且需要弃牌
    if (this.state.phase === '弃牌' && checkDiscard(this.state)) {
      return {
        success: false,
        state: this.state,
        events: [],
        needsInput: { type: 'select_cards', data: { count: this.state.players.find(p => p.name === playerName)!.hand.length - this.state.players.find(p => p.name === playerName)!.maxHealth } },
      };
    }

    // 跳到下一个玩家的出牌阶段
    this.advanceToNextPlayer();

    return {
      success: true,
      state: this.state,
      events: [{ type: 'turnEnd', data: { player: playerName }, description: `${playerName} 结束回合` }],
    };
  }

  // ============================================================
  // 弃牌
  // ============================================================

  discard(playerName: string, cardIndices: number[]): ActionResult {
    this.state = executeDiscard(this.state, cardIndices, this.logger);

    // 弃牌后自动推进到下一个玩家
    this.advanceToNextPlayer();

    return {
      success: true,
      state: this.state,
      events: [{ type: 'discard', data: { player: playerName, count: cardIndices.length }, description: `${playerName} 弃了 ${cardIndices.length} 张牌` }],
    };
  }

  // ============================================================
  // 响应杀
  // ============================================================

  respondToKill(targetName: string, playDodge: boolean, attackerName?: string, damageCard?: Card): ActionResult {
    return this.resolveKillResponse(targetName, playDodge, attackerName, damageCard);
  }

  // ============================================================
  // 濒死救援
  // ============================================================

  respondToDying(dyingPlayer: string, saverName: string | null): ActionResult {
    const events: GameEvent[] = [];

    if (saverName) {
      this.state = applyPeachSave(this.state, saverName, dyingPlayer);
      events.push({ type: 'rescue', data: { saver: saverName, target: dyingPlayer }, description: `${saverName} 使用桃救了 ${dyingPlayer}` });
    } else {
      this.state = applyDying(this.state, dyingPlayer);
      events.push({ type: 'death', data: { player: dyingPlayer }, description: `${dyingPlayer} 阵亡` });
    }

    return { success: true, state: this.state, events };
  }

  // ============================================================
  // 技能发动
  // ============================================================

  activateSkill(playerName: string, skillIndex: number): ActionResult {
    const available = getAvailableSkills(this.state, playerName);
    const skill = available[skillIndex];
    if (!skill?.canActivate) {
      return this.fail('技能不可用');
    }

    const result = executeSkill(this.state, playerName, skill.ability);
    if (result.success) {
      this.state = result.game;
    }

    return {
      success: result.success,
      state: this.state,
      events: [{ type: 'skill', data: { player: playerName, skill: skill.ability.name }, description: result.message }],
    };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 从当前状态推进到出牌阶段（自动摸牌）
   */
  advanceToPlayPhase(): void {
    while (this.state.phase !== '出牌') {
      if (this.state.phase === '摸牌') {
        const result = drawPhase(this.state, this.logger);
        this.state = result.state;
      }
      this.state = nextPhase(this.state, this.logger);
    }
  }

  private advanceToNextPlayer(): void {
    this.state = nextPhase(this.state, this.logger); // → 结束
    this.state = nextPhase(this.state, this.logger); // → 准备
    this.advanceToPlayPhase();
  }

  private executeKill(playerName: string, card: Card, target: string): ActionResult {
    // 杀不直接扣血，先发起响应窗口
    // 从手牌移除杀
    const player = this.state.players.find(p => p.name === playerName)!;
    const cardIndex = player.hand.findIndex(c => c.name === card.name && c.suit === card.suit && c.rank === card.rank);
    if (cardIndex === -1) return this.fail('没有这张牌');

    const newHand = [...player.hand];
    newHand.splice(cardIndex, 1);
    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.name === playerName ? { ...p, hand: newHand } : p,
      ),
      discardPile: [...this.state.discardPile, card],
    };

    // 检查装备效果
    const targetPlayer = this.state.players.find(p => p.name === target);
    if (targetPlayer) {
      // 仁王盾：黑色杀（♠♣）自动无效
      if (targetPlayer.equipment.armor?.name === '仁王盾') {
        const isBlack = card.suit === '♠' || card.suit === '♣';
        if (isBlack) {
          return {
            success: true,
            state: this.state,
            events: [{ type: 'equip_effect', data: { player: target, equipment: '仁王盾' }, description: `${target} 的仁王盾挡住了黑色杀` }],
          };
        }
      }

      // 八卦阵：判定，红色（♥♦）自动闪避
      if (targetPlayer.equipment.armor?.name === '八卦阵') {
        const judgeCard = this.state.deck[0];
        if (judgeCard) {
          const newDeck = this.state.deck.slice(1);
          const isRed = judgeCard.suit === '♥' || judgeCard.suit === '♦';
          this.state = { ...this.state, deck: newDeck, discardPile: [...this.state.discardPile, judgeCard] };
          if (isRed) {
            return {
              success: true,
              state: this.state,
              events: [{ type: 'equip_effect', data: { player: target, equipment: '八卦阵', judgeCard: judgeCard.name }, description: `${target} 的八卦阵判定${judgeCard.suit}${judgeCard.rank}（红色），自动闪避` }],
            };
          }
        }
      }
    }

    return {
      success: true,
      state: this.state,
      events: [{ type: 'play', data: { player: playerName, card: card.name, target }, description: `${playerName} 对 ${target} 使用杀` }],
      needsInput: { type: 'respond_kill', data: { attacker: playerName, target, card } },
    };
  }

  /**
   * 处理杀的响应（出闪或受伤害）
   */
  resolveKillResponse(targetName: string, dodge: boolean, attackerName?: string, damageCard?: Card): ActionResult {
    const events: GameEvent[] = [];

    if (dodge) {
      // 出闪，移除一张闪
      const target = this.state.players.find(p => p.name === targetName);
      if (target) {
        const dodgeIdx = target.hand.findIndex(c => c.name === '闪');
        if (dodgeIdx >= 0) {
          const newHand = [...target.hand];
          const dodgeCard = newHand.splice(dodgeIdx, 1)[0];
          this.state = {
            ...this.state,
            players: this.state.players.map(p =>
              p.name === targetName ? { ...p, hand: newHand } : p,
            ),
            discardPile: [...this.state.discardPile, dodgeCard],
          };
        }
      }
      events.push({ type: 'dodge', data: { player: targetName }, description: `${targetName} 出了闪` });
    } else {
      // 受伤害
      const target = this.state.players.find(p => p.name === targetName);
      if (target) {
        const newHealth = target.health - 1;
        this.state = {
          ...this.state,
          players: this.state.players.map(p =>
            p.name === targetName ? { ...p, health: newHealth, alive: newHealth > 0 } : p,
          ),
        };
        events.push({ type: 'damage', data: { target: targetName, amount: 1 }, description: `${targetName} 受到1点伤害` });

        // 被动技能：奸雄（曹操）— 受到伤害后获得造成伤害的牌
        if (target.character.name === '曹操' && damageCard) {
          // 从弃牌堆移除伤害牌并加入手牌
          const cardIdx = this.state.discardPile.findIndex(
            c => c.name === damageCard.name && c.suit === damageCard.suit && c.rank === damageCard.rank,
          );
          if (cardIdx >= 0) {
            const newDiscard = [...this.state.discardPile];
            const gainedCard = newDiscard.splice(cardIdx, 1)[0];
            this.state = {
              ...this.state,
              players: this.state.players.map(p =>
                p.name === targetName ? { ...p, hand: [...p.hand, gainedCard] } : p,
              ),
              discardPile: newDiscard,
            };
            events.push({ type: 'skill', data: { player: targetName, skill: '奸雄' }, description: `${targetName} 发动奸雄，获得了 ${gainedCard.name}` });
          }
        }
      }
    }

    return { success: true, state: this.state, events };
  }

  private executePeach(playerName: string, card: Card): ActionResult {
    const result = playPeach(this.state, playerName, this.logger);
    if (result.success) {
      return {
        success: true,
        state: result.state,
        events: [{ type: 'play', data: { player: playerName, card: card.name }, description: `${playerName} 使用桃` }],
      };
    }
    return this.fail(result.message);
  }

  private executeDismantle(playerName: string, card: Card, target: string): ActionResult {
    const result = playDismantle(this.state, playerName, target, this.logger);
    if (result.success) {
      return {
        success: true,
        state: result.state,
        events: [{ type: 'play', data: { player: playerName, card: card.name, target }, description: `${playerName} 对 ${target} 使用过河拆桥` }],
      };
    }
    return this.fail(result.message);
  }

  private executeSteal(playerName: string, card: Card, target: string): ActionResult {
    const result = playSteal(this.state, playerName, target, this.logger);
    if (result.success) {
      return {
        success: true,
        state: result.state,
        events: [{ type: 'play', data: { player: playerName, card: card.name, target }, description: `${playerName} 对 ${target} 使用顺手牵羊` }],
      };
    }
    return this.fail(result.message);
  }

  private executeDrawTwo(playerName: string, card: Card): ActionResult {
    const result = playDrawTwo(this.state, playerName, this.logger);
    if (result.success) {
      return {
        success: true,
        state: result.state,
        events: [{ type: 'play', data: { player: playerName, card: card.name }, description: `${playerName} 使用无中生有` }],
      };
    }
    return this.fail(result.message);
  }

  private executeArrowBarrage(playerName: string, card: Card): ActionResult {
    const result = playArrowBarrage(this.state, playerName, this.logger);
    if (result.success) {
      return {
        success: true,
        state: result.state,
        events: [{ type: 'play', data: { player: playerName, card: card.name }, description: `${playerName} 使用万箭齐发` }],
      };
    }
    return this.fail(result.message);
  }

  private executeBarbarianInvasion(playerName: string, card: Card): ActionResult {
    const result = playBarbarianInvasion(this.state, playerName, this.logger);
    if (result.success) {
      return {
        success: true,
        state: result.state,
        events: [{ type: 'play', data: { player: playerName, card: card.name }, description: `${playerName} 使用南蛮入侵` }],
      };
    }
    return this.fail(result.message);
  }

  private executePeachGarden(playerName: string, card: Card): ActionResult {
    const result = playPeachGarden(this.state, playerName, this.logger);
    if (result.success) {
      return {
        success: true,
        state: result.state,
        events: [{ type: 'play', data: { player: playerName, card: card.name }, description: `${playerName} 使用桃园结义` }],
      };
    }
    return this.fail(result.message);
  }

  private executeAbundance(playerName: string, card: Card): ActionResult {
    const result = playAbundance(this.state, playerName, this.logger);
    if (result.success) {
      return {
        success: true,
        state: result.state,
        events: [{ type: 'play', data: { player: playerName, card: card.name }, description: `${playerName} 使用五谷丰登` }],
      };
    }
    return this.fail(result.message);
  }

  private executeDelayedTrick(playerName: string, card: Card, target: string): ActionResult {
    const pendingTrick = { name: card.name, source: playerName, card };
    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.name === target
          ? { ...p, pendingTricks: [...(p.pendingTricks ?? []), pendingTrick] }
          : p,
      ),
    };
    return {
      success: true,
      state: this.state,
      events: [{ type: 'play', data: { player: playerName, card: card.name, target }, description: `${playerName} 对 ${target} 使用 ${card.name}` }],
    };
  }

  private executeEquip(playerName: string, card: Card): ActionResult {
    const player = this.state.players.find(p => p.name === playerName)!;
    const equipment = { ...player.equipment };

    if (card.subtype === '武器') equipment.weapon = card;
    else if (card.subtype === '防具') equipment.armor = card;
    else if (card.subtype === '进攻马') equipment.horseMinus = card;
    else if (card.subtype === '防御马') equipment.horsePlus = card;

    // 从手牌移除并装备
    const cardIndex = player.hand.findIndex(c => c.name === card.name && c.suit === card.suit && c.rank === card.rank);
    const newHand = [...player.hand];
    if (cardIndex >= 0) newHand.splice(cardIndex, 1);

    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.name === playerName ? { ...p, hand: newHand, equipment } : p,
      ),
    };

    return {
      success: true,
      state: this.state,
      events: [{ type: 'equip', data: { player: playerName, card: card.name }, description: `${playerName} 装备了 ${card.name}` }],
    };
  }

  private fail(_message: string): ActionResult {
    return { success: false, state: this.state, events: [] };
  }
}
