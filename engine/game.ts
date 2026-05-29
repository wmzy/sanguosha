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
import { playPeach, playDismantle, playSteal, playDrawTwo, playArrowBarrage, playBarbarianInvasion, playPeachGarden, playAbundance } from './effect';
import { getValidTargetsForCard, isCardPlayable } from './rules';
import { applyDying, applyPeachSave } from './dying';
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
  | { type: 'activate_skill'; data: { skillIndex: number } }
  | { type: 'weapon_guanshifu'; data: { attacker: string; target: string; killCard: Card } }
  | { type: 'weapon_qilinbow'; data: { attacker: string; target: string; killCard: Card } };

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
  // 贯石斧效果响应
  // ============================================================

  respondToGuanshifu(attackerName: string, targetName: string, discard: boolean, cardIndices?: number[]): ActionResult {
    if (!discard) {
      // 放弃发动贯石斧效果
      return {
        success: true,
        state: this.state,
        events: [{ type: 'weapon_skip', data: { player: attackerName, weapon: '贯石斧' }, description: `${attackerName} 放弃发动贯石斧效果` }],
      };
    }

    // 发动贯石斧效果：弃2张牌强制命中
    const attacker = this.state.players.find(p => p.name === attackerName);
    if (!attacker || cardIndices?.length !== 2) {
      return this.fail('需要弃2张牌');
    }

    // 验证卡牌索引
    const validIndices = cardIndices.filter(i => i >= 0 && i < attacker.hand.length);
    if (validIndices.length !== 2) {
      return this.fail('无效的卡牌选择');
    }

    // 弃牌
    const discardedCards = validIndices.map(i => attacker.hand[i]);
    const newHand = attacker.hand.filter((_, i) => !validIndices.includes(i));
    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.name === attackerName ? { ...p, hand: newHand } : p,
      ),
      discardPile: [...this.state.discardPile, ...discardedCards],
    };

    const events: GameEvent[] = [
      { type: 'weapon_effect', data: { player: attackerName, weapon: '贯石斧', discardedCards: discardedCards.map(c => c.name) }, description: `${attackerName} 发动贯石斧，弃了${discardedCards.map(c => c.name).join('、')}` },
    ];

    // 强制命中，造成伤害
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
      if (target.character.name === '曹操') {
        const killCardIdx = this.state.discardPile.findIndex(
          c => c.name === '杀',
        );
        if (killCardIdx >= 0) {
          const newDiscard = [...this.state.discardPile];
          const gainedCard = newDiscard.splice(killCardIdx, 1)[0];
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

    return { success: true, state: this.state, events };
  }

  // ============================================================
  // 麒麟弓效果响应
  // ============================================================

  respondToQilinbow(attackerName: string, targetName: string, discard: boolean, cardIndex?: number): ActionResult {
    if (!discard) {
      // 放弃发动麒麟弓效果
      return {
        success: true,
        state: this.state,
        events: [{ type: 'weapon_skip', data: { player: attackerName, weapon: '麒麟弓' }, description: `${attackerName} 放弃发动麒麟弓效果` }],
      };
    }

    // 发动麒麟弓效果：弃1张牌造成+1伤害
    const attacker = this.state.players.find(p => p.name === attackerName);
    if (!attacker || cardIndex === undefined || cardIndex < 0 || cardIndex >= attacker.hand.length) {
      return this.fail('需要弃1张牌');
    }

    // 弃牌
    const discardedCard = attacker.hand[cardIndex];
    const newHand = [...attacker.hand];
    newHand.splice(cardIndex, 1);
    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.name === attackerName ? { ...p, hand: newHand } : p,
      ),
      discardPile: [...this.state.discardPile, discardedCard],
    };

    const events: GameEvent[] = [
      { type: 'weapon_effect', data: { player: attackerName, weapon: '麒麟弓', discardedCard: discardedCard.name }, description: `${attackerName} 发动麒麟弓，弃了${discardedCard.name}` },
    ];

    // 造成+1伤害
    const target = this.state.players.find(p => p.name === targetName);
    if (target) {
      const newHealth = target.health - 1;
      this.state = {
        ...this.state,
        players: this.state.players.map(p =>
          p.name === targetName ? { ...p, health: newHealth, alive: newHealth > 0 } : p,
        ),
      };
      events.push({ type: 'damage', data: { target: targetName, amount: 1 }, description: `${targetName} 受到1点伤害（麒麟弓效果）` });

      // 被动技能：奸雄（曹操）— 受到伤害后获得造成伤害的牌
      if (target.character.name === '曹操') {
        const killCardIdx = this.state.discardPile.findIndex(
          c => c.name === '杀',
        );
        if (killCardIdx >= 0) {
          const newDiscard = [...this.state.discardPile];
          const gainedCard = newDiscard.splice(killCardIdx, 1)[0];
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

    return { success: true, state: this.state, events };
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
      // 准备阶段：甄姬 洛神
      if (this.state.phase === '准备') {
        this.handleLuoshen();
      }
      // 摸牌阶段
      if (this.state.phase === '摸牌') {
        const currentPlayer = this.state.players.find(p => p.name === this.state.currentPlayer);
        // 张辽 突袭 — 放弃摸牌，改为从其他角色各获得一张手牌
        if (currentPlayer?.character.name === '张辽') {
          this.handleTuxi();
        } else {
          const result = drawPhase(this.state, this.logger);
          this.state = result.state;
        }
      }
      this.state = nextPhase(this.state, this.logger);
    }
  }

  /**
   * 甄姬 洛神 — 准备阶段判定，黑色获得并重复，红色停止
   */
  private handleLuoshen(): void {
    while (true) {
      if (this.state.deck.length === 0) break;
      const card = this.state.deck[0];
      this.state = { ...this.state, deck: this.state.deck.slice(1) };

      const isBlack = card.suit === '♠' || card.suit === '♣';
      if (isBlack) {
        // 黑色，获得判定牌（直接加入手牌，不经过弃牌堆）
        this.state = {
          ...this.state,
          players: this.state.players.map(p =>
            p.name === this.state.currentPlayer ? { ...p, hand: [...p.hand, card] } : p,
          ),
        };
        if (this.logger) {
          this.logger.logServerOp('skillActivate',
            { player: this.state.currentPlayer, skill: '洛神', card: card.name },
            `${this.state.currentPlayer} 发动洛神，判定 ${card.suit}${card.rank}（黑色），获得 ${card.name}`,
          );
        }
      } else {
        // 红色，放入弃牌堆，停止
        this.state = { ...this.state, discardPile: [...this.state.discardPile, card] };
        if (this.logger) {
          this.logger.logServerOp('skillActivate',
            { player: this.state.currentPlayer, skill: '洛神', card: card.name },
            `${this.state.currentPlayer} 发动洛神，判定 ${card.suit}${card.rank}（红色），停止`,
          );
        }
        break;
      }
    }
  }

  /**
   * 张辽 突袭 — 放弃摸牌，从其他存活角色各获得一张手牌
   */
  private handleTuxi(): void {
    const otherPlayers = this.state.players.filter(
      p => p.name !== this.state.currentPlayer && p.alive && p.hand.length > 0,
    );

    if (otherPlayers.length === 0) return;

    const targets = otherPlayers.slice(0, 2);
    const stolenCards: Array<{ from: string; card: Card }> = [];

    for (const target of targets) {
      const randomIdx = Math.floor(Math.random() * target.hand.length);
      const card = target.hand[randomIdx];
      stolenCards.push({ from: target.name, card });
    }

    // 从目标手牌中移除
    for (const { from, card } of stolenCards) {
      this.state = {
        ...this.state,
        players: this.state.players.map(p => {
          if (p.name === from) {
            const idx = p.hand.findIndex(
              c => c.name === card.name && c.suit === card.suit && c.rank === card.rank,
            );
            if (idx >= 0) {
              const newHand = [...p.hand];
              newHand.splice(idx, 1);
              return { ...p, hand: newHand };
            }
          }
          if (p.name === this.state.currentPlayer) {
            return { ...p, hand: [...p.hand, card] };
          }
          return p;
        }),
      };
    }

    if (this.logger) {
      this.logger.logServerOp('skillActivate',
        { player: this.state.currentPlayer, skill: '突袭', targets: targets.map(t => t.name) },
        `${this.state.currentPlayer} 发动突袭，从 ${targets.map(t => t.name).join('、')} 各获得一张牌`,
      );
    }
  }

  private advanceToNextPlayer(): void {
    this.state = nextPhase(this.state, this.logger); // → 结束
    this.state = nextPhase(this.state, this.logger); // → 准备
    // 重置本回合杀的计数
    this.state = { ...this.state, killsPlayedThisTurn: 0 };
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
    // 增加本回合杀的计数
    const killsPlayed = (this.state.killsPlayedThisTurn ?? 0) + 1;
    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.name === playerName ? { ...p, hand: newHand } : p,
      ),
      discardPile: [...this.state.discardPile, card],
      killsPlayedThisTurn: killsPlayed,
    };

    // 检查攻击者是否有青釭剑（杀无视防具）
    const attackerPlayer = this.state.players.find(p => p.name === playerName);
    const hasQinggang = attackerPlayer?.equipment.weapon?.name === '青釭剑';

    // 检查装备效果（青釭剑无视防具）
    const targetPlayer = this.state.players.find(p => p.name === target);
    if (targetPlayer && !hasQinggang) {
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

    if (hasQinggang) {
      this.logger.logServerOp('equip_effect', { player: playerName, equipment: '青釭剑' }, `${playerName} 的青釭剑无视防具效果`);
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
      // 出闪，移除一张闪（或甄姬 倾国：黑色手牌当闪）
      const target = this.state.players.find(p => p.name === targetName);
      if (target) {
        const dodgeIdx = target.hand.findIndex(c => {
          if (c.name === '闪') return true;
          // 甄姬 倾国：黑色手牌可以当闪
          if (target.character.name === '甄姬' && (c.suit === '♠' || c.suit === '♣')) return true;
          return false;
        });
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
          const isConversion = dodgeCard.name !== '闪';
          events.push({
            type: 'dodge',
            data: { player: targetName, conversion: isConversion },
            description: isConversion
              ? `${targetName} 将 ${dodgeCard.suit}${dodgeCard.rank}${dodgeCard.name} 当闪使用（倾国）`
              : `${targetName} 出了闪`,
          });
        }
      }

      // 贯石斧效果：出闪后，攻击者可以弃2张牌强制命中
      if (attackerName && damageCard) {
        const attacker = this.state.players.find(p => p.name === attackerName);
        if (attacker?.equipment.weapon?.name === '贯石斧' && attacker.hand.length >= 2) {
          return {
            success: true,
            state: this.state,
            events,
            needsInput: { type: 'weapon_guanshifu', data: { attacker: attackerName, target: targetName, killCard: damageCard } },
          };
        }
      }
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

        // 被动技能：反馈（司马懿）— 受到伤害后获得伤害来源的一张牌
        if (target.character.name === '司马懿' && attackerName) {
          const attacker = this.state.players.find(p => p.name === attackerName);
          if (attacker && attacker.hand.length > 0) {
            const randomIdx = Math.floor(Math.random() * attacker.hand.length);
            const gainedCard = attacker.hand[randomIdx];
            const newAttackerHand = [...attacker.hand];
            newAttackerHand.splice(randomIdx, 1);
            this.state = {
              ...this.state,
              players: this.state.players.map(p => {
                if (p.name === attackerName) return { ...p, hand: newAttackerHand };
                if (p.name === targetName) return { ...p, hand: [...p.hand, gainedCard] };
                return p;
              }),
            };
            events.push({ type: 'skill', data: { player: targetName, skill: '反馈' }, description: `${targetName} 发动反馈，获得了 ${attackerName} 的一张牌` });
          }
        }

        // 被动技能：刚烈（夏侯惇）— 受到伤害后判定，♥♦则攻击者弃一张牌
        if (target.character.name === '夏侯惇' && attackerName) {
          const judgeCard = this.performJudgment();
          if (judgeCard) {
            const isRed = judgeCard.suit === '♥' || judgeCard.suit === '♦';
            if (isRed) {
              // 攻击者弃一张牌
              const attacker = this.state.players.find(p => p.name === attackerName);
              if (attacker && attacker.hand.length > 0) {
                const discardIdx = Math.floor(Math.random() * attacker.hand.length);
                const discarded = attacker.hand[discardIdx];
                const newAttackerHand = [...attacker.hand];
                newAttackerHand.splice(discardIdx, 1);
                this.state = {
                  ...this.state,
                  players: this.state.players.map(p =>
                    p.name === attackerName ? { ...p, hand: newAttackerHand } : p,
                  ),
                  discardPile: [...this.state.discardPile, discarded],
                };
                events.push({ type: 'skill', data: { player: targetName, skill: '刚烈' }, description: `${targetName} 发动刚烈，判定 ${judgeCard.suit}${judgeCard.rank}（红色），${attackerName} 弃了一张牌` });
              }
            } else {
              events.push({ type: 'skill', data: { player: targetName, skill: '刚烈' }, description: `${targetName} 发动刚烈，判定 ${judgeCard.suit}${judgeCard.rank}（黑色），无事发生` });
            }
          }
        }

        // 被动技能：遗计（郭嘉）— 受到伤害后摸两张牌
        if (target.character.name === '郭嘉') {
          let deck = [...this.state.deck];
          let discardPile = [...this.state.discardPile];
          if (deck.length < 2 && discardPile.length > 0) {
            deck = [...deck, ...discardPile];
            discardPile = [];
            for (let i = deck.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [deck[i], deck[j]] = [deck[j], deck[i]];
            }
          }
          const drawn = deck.slice(0, 2);
          if (drawn.length > 0) {
            this.state = {
              ...this.state,
              players: this.state.players.map(p =>
                p.name === targetName ? { ...p, hand: [...p.hand, ...drawn] } : p,
              ),
              deck: deck.slice(drawn.length),
              discardPile,
            };
            events.push({ type: 'skill', data: { player: targetName, skill: '遗计' }, description: `${targetName} 发动遗计，摸了 ${drawn.length} 张牌` });
          }
        }

        // 麒麟弓效果：命中后，攻击者可以弃1张牌造成+1伤害
        if (attackerName && damageCard) {
          const attacker = this.state.players.find(p => p.name === attackerName);
          if (attacker?.equipment.weapon?.name === '麒麟弓' && attacker.hand.length >= 1) {
            return {
              success: true,
              state: this.state,
              events,
              needsInput: { type: 'weapon_qilinbow', data: { attacker: attackerName, target: targetName, killCard: damageCard } },
            };
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

  // ============================================================
  // 判定辅助
  // ============================================================

  /**
   * 从牌堆顶翻一张判定牌，放入弃牌堆
   */
  private performJudgment(): Card | null {
    if (this.state.deck.length === 0) return null;
    const card = this.state.deck[0];
    this.state = {
      ...this.state,
      deck: this.state.deck.slice(1),
      discardPile: [...this.state.discardPile, card],
    };
    return card;
  }

  private fail(_message: string): ActionResult {
    return { success: false, state: this.state, events: [] };
  }
}
