import type { GameState, Card, PublicGameState, CharacterConfig } from '../shared/types';
import type { Rng } from '../shared/rng';
import { createRng } from '../shared/rng';
import { createGame, startGame, getPublicState, getPlayer, getAlivePlayers, updatePlayer } from './state';
import { nextPhase, drawPhase, checkDiscard, executeDiscard, handleJudgePhase } from './turn';
import { executeEffect } from './effect';
import { TriggerSystem } from './trigger';
import { ResponseSystem, createKillResponseWindow, createAOEResponseWindow, createDyingResponseWindow } from './response';
import { ValidationPipeline, getCardDef, getValidActions, getValidTargetsForCard, isCardPlayable } from './validation';
import { registerCharacterSkills } from './skill';
import { getDistance, getAttackRange } from './distance';
import { GameLogger } from './logger';
import type { ActionResult, EffectExecContext, ResponseWindow, ValidActions, GameEvent } from './types';

export type { ActionResult, ResponseWindow, ValidActions, GameEvent };
export { ValidationPipeline, getCardDef, getValidActions, getValidTargetsForCard, isCardPlayable };
export { TriggerSystem, ResponseSystem };
export { registerCharacterSkills };
export { getDistance, getAttackRange };
export { executeEffect };

export class GameController {
  private state: GameState;
  private rng: Rng;
  private triggers: TriggerSystem;
  private responses: ResponseSystem;
  private logger: GameLogger;

  private constructor(
    state: GameState,
    rng: Rng,
    triggers: TriggerSystem,
    responses: ResponseSystem,
    logger: GameLogger,
  ) {
    this.state = state;
    this.rng = rng;
    this.triggers = triggers;
    this.responses = responses;
    this.logger = logger;
  }

  static createForTesting(
    state: GameState,
    logger?: GameLogger,
  ): GameController {
    const actualLogger = logger ?? new GameLogger({
      version: '1.0.0',
      createdAt: Date.now(),
      playerCount: state.players.length,
      characters: state.players.map(p => p.name),
      seed: state.seed,
    });
    const rng = createRng(state.seed);
    const triggers = new TriggerSystem();
    registerCharacterSkills(triggers, state.players.map(p => p.character));
    const responses = new ResponseSystem();
    return new GameController(state, rng, triggers, responses, actualLogger);
  }

  static createGame(
    characters: CharacterConfig[],
    seed?: number,
    externalLogger?: GameLogger,
  ): { state: GameState; controller: GameController } {
    const actualSeed = seed ?? Date.now();
    const rng = createRng(actualSeed);
    const logger = externalLogger ?? new GameLogger({
      version: '1.0.0',
      createdAt: Date.now(),
      playerCount: characters.length,
      characters: characters.map(c => c.name),
      seed: actualSeed,
    });

    const rawState = createGame(characters, actualSeed, logger);
    const triggers = new TriggerSystem();
    registerCharacterSkills(triggers, characters);
    const responses = new ResponseSystem();

    const controller = new GameController(rawState, rng, triggers, responses, logger);
    controller.state = startGame(controller.state, logger);
    controller.advanceToPlayPhase();

    return { state: controller.state, controller };
  }

  playCard(playerName: string, cardId: string, target?: string): ActionResult {
    if (this.state.currentPlayer !== playerName) {
      return this.fail('不是你的回合');
    }
    if (this.state.phase !== '出牌') {
      return this.fail('当前阶段不能出牌');
    }

    const player = getPlayer(this.state, playerName);
    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      return this.fail('没有这张牌');
    }
    const card = player.hand[cardIndex];

    if (!isCardPlayable(this.state, player, card)) {
      return this.fail('这张牌不能使用');
    }

    const def = getCardDef(card.name);
    if (!def) return this.fail('未知卡牌');

    const validTargets = getValidTargetsForCard(this.state, player, card);
    if (def.targetFilter?.type !== 'none' && def.targetFilter?.type !== 'self') {
      if (!target || !validTargets.includes(target)) {
        return {
          success: false,
          state: this.state,
          events: [],
          responseWindow: undefined,
        };
      }
    }

    const newHand = [...player.hand];
    newHand.splice(cardIndex, 1);
    let state: GameState = {
      ...updatePlayer(this.state, playerName, { hand: newHand }),
      discardPile: [...this.state.discardPile, card],
    };

    if (card.name === '杀') {
      state = { ...state, killsPlayedThisTurn: state.killsPlayedThisTurn + 1 };
    }

    const ctx = this.buildContext(playerName, target, card);
    const events: GameEvent[] = [
      { type: 'cardPlayed', player: playerName, target, card },
    ];

    // 装备牌特殊处理
    if (card.subtype === '武器' || card.subtype === '防具' || card.subtype === '进攻马' || card.subtype === '防御马') {
      state = this.equipCard(state, playerName, card);
      events.push({ type: 'equipChange', player: playerName, card });
      this.state = state;
      return { success: true, state, events };
    }

    // 延时锦囊
    if (card.name === '乐不思蜀' || card.name === '兵粮寸断' || card.name === '闪电') {
      const actualTarget = target ?? playerName;
      const trick = { name: card.name, source: playerName, card };
      const targetPlayer = getPlayer(state, actualTarget);
      state = updatePlayer(state, actualTarget, {
        pendingTricks: [...(targetPlayer.pendingTricks ?? []), trick],
      });
      this.state = state;
      return { success: true, state, events };
    }

    // 需要响应窗口的牌
    if (def.responseWindow === 'kill_response' && target) {
      this.state = state;
      const responseWindow = createKillResponseWindow(playerName, target, card);
      this.responses.push(responseWindow);
      return { success: true, state, events, responseWindow };
    }

    if (card.name === '万箭齐发') {
      const targets = getAlivePlayers(state)
        .filter(p => p.name !== playerName)
        .map(p => p.name);
      this.state = state;
      const responseWindow = createAOEResponseWindow(playerName, targets, '闪');
      this.responses.push(responseWindow);
      return { success: true, state, events, responseWindow };
    }

    if (card.name === '南蛮入侵') {
      const targets = getAlivePlayers(state)
        .filter(p => p.name !== playerName)
        .map(p => p.name);
      this.state = state;
      const responseWindow = createAOEResponseWindow(playerName, targets, '杀');
      this.responses.push(responseWindow);
      return { success: true, state, events, responseWindow };
    }

    // 直接执行效果
    state = executeEffect(state, def.effect, ctx);
    state = this.triggerHooks(state, 'cardPlayed', ctx);

    // 检查濒死
    const dyingCheck = this.checkDying(state);
    if (dyingCheck) {
      this.state = dyingCheck.state;
      return { success: true, state: dyingCheck.state, events, responseWindow: dyingCheck.window };
    }

    this.state = state;
    return { success: true, state, events };
  }

  endTurn(playerName: string): ActionResult {
    if (this.state.currentPlayer !== playerName) {
      return this.fail('不是你的回合');
    }

    if (this.state.phase === '弃牌' && checkDiscard(this.state)) {
      return {
        success: false,
        state: this.state,
        events: [],
      };
    }

    this.state = nextPhase(this.state, this.logger);

    if (this.state.phase === '弃牌' && checkDiscard(this.state)) {
      return {
        success: false,
        state: this.state,
        events: [],
      };
    }

    this.advanceToNextPlayer();

    return {
      success: true,
      state: this.state,
      events: [{ type: 'turnEnd', player: playerName }],
    };
  }

  discard(playerName: string, cardIndices: number[]): ActionResult {
    this.state = executeDiscard(this.state, cardIndices, this.logger);
    this.advanceToNextPlayer();

    return {
      success: true,
      state: this.state,
      events: [{ type: 'discard', player: playerName, amount: cardIndices.length }],
    };
  }

  respondToWindow(responses: Map<string, Card | null>): ActionResult {
    const window = this.responses.current();
    if (!window) {
      return this.fail('没有等待响应的操作');
    }

    let state = this.responses.resolve(this.state, responses);
    const events: GameEvent[] = [];

    // 杀响应后触发伤害事件
    if (window.type === 'kill_response') {
      const target = window.validResponders[0];
      const targetPlayer = getPlayer(state, target);
      const originalTarget = getPlayer(this.state, target);

      // 检查是否受到伤害
      if (targetPlayer.health < originalTarget.health) {
        const damageAmount = originalTarget.health - targetPlayer.health;
        const ctx = this.buildContext(window.requester, target, window.sourceCard);
        ctx.amount = damageAmount;

        // 触发伤害相关事件
        state = this.triggerHooks(state, 'damageDealt', ctx);
        state = this.triggerHooks(state, 'damageReceived', {
          ...ctx,
          player: target,
          target,
          attacker: window.requester,
          amount: damageAmount,
        });
      }
    }

    // 检查濒死
    if (window.type === 'kill_response' || window.type === 'aoe_response') {
      const dyingCheck = this.checkDying(state);
      if (dyingCheck) {
        state = dyingCheck.state;
        this.state = state;
        return { success: true, state, events, responseWindow: dyingCheck.window };
      }
    }

    this.state = state;
    return { success: true, state, events };
  }

  activateSkill(playerName: string, skillIndex: number, target?: string): ActionResult {
    const skills = getValidActions(this.state, playerName).skills;
    const skill = skills[skillIndex];
    if (!skill?.canUse) {
      return this.fail('技能不可用');
    }

    const ctx = this.buildContext(playerName, target);
    let state = executeEffect(this.state, skill.effect, ctx);
    state = {
      ...state,
      skillsUsedThisTurn: [...state.skillsUsedThisTurn, skill.name],
    };

    this.state = state;
    return {
      success: true,
      state,
      events: [{ type: 'skillActivate', player: playerName, card: undefined }],
    };
  }

  getState(): GameState {
    return this.state;
  }

  getPublicState(observerName: string): PublicGameState {
    return getPublicState(this.state, observerName);
  }

  getValidActionsForPlayer(playerName: string): ValidActions {
    return getValidActions(this.state, playerName);
  }

  getCurrentResponseWindow(): ResponseWindow | null {
    return this.responses.current() ?? null;
  }

  respondToKill(target: string, playDodge: boolean, _attacker: string, _card: Card): ActionResult {
    const responses = new Map<string, Card | null>();
    if (playDodge) {
      const targetPlayer = getPlayer(this.state, target);
      const dodgeCard = targetPlayer.hand.find(c => c.name === '闪');
      responses.set(target, dodgeCard ?? null);
    } else {
      responses.set(target, null);
    }
    return this.respondToWindow(responses);
  }

  respondToDying(player: string, saverName: string | null): ActionResult {
    const responses = new Map<string, Card | null>();
    if (saverName) {
      const saverPlayer = getPlayer(this.state, saverName);
      const peachCard = saverPlayer.hand.find(c => c.name === '桃');
      responses.set(saverName, peachCard ?? null);
    }
    return this.respondToWindow(responses);
  }

  private buildContext(
    playerName: string,
    target?: string,
    card?: Card,
  ): EffectExecContext {
    return {
      player: playerName,
      target,
      card,
      rng: this.rng,
      _skipFlags: { draw: false, phases: new Set() },
    };
  }

  private triggerHooks(
    state: GameState,
    eventType: string,
    ctx: EffectExecContext,
  ): GameState {
    return this.triggers.emit(state, { type: eventType, player: ctx.player, target: ctx.target, card: ctx.card }, ctx, executeEffect);
  }

  private equipCard(state: GameState, playerName: string, card: Card): GameState {
    const player = getPlayer(state, playerName);
    const equipment = { ...player.equipment };

    if (card.subtype === '武器') equipment.weapon = card;
    else if (card.subtype === '防具') equipment.armor = card;
    else if (card.subtype === '进攻马') equipment.horseMinus = card;
    else if (card.subtype === '防御马') equipment.horsePlus = card;

    return updatePlayer(state, playerName, { equipment });
  }

  private checkDying(state: GameState): { state: GameState; window: ResponseWindow } | null {
    for (const player of state.players) {
      if (player.alive && player.health <= 0) {
        const allPlayerNames = getAlivePlayers(state).map(p => p.name);
        const window = createDyingResponseWindow(player.name, allPlayerNames);
        return { state, window };
      }
    }
    return null;
  }

  private advanceToPlayPhase(): void {
    while (this.state.phase !== '出牌' && this.state.status === '进行中') {
      // 触发回合开始事件（在摸牌阶段触发，以支持突袭等技能）
      if (this.state.phase === '摸牌') {
        const ctx = this.buildContext(this.state.currentPlayer);
        this.state = this.triggerHooks(this.state, 'turnStart', ctx);
      }

      if (this.state.phase === '判定') {
        const result = handleJudgePhase(this.state, this.rng, this.logger);
        this.state = result.state;
      }

      if (this.state.phase === '摸牌') {
        const result = drawPhase(this.state, this.rng, this.logger);
        this.state = result.state;
      }

      if (this.state.phase === '弃牌') {
        break;
      }

      if (this.state.phase === '结束') {
        break;
      }

      this.state = nextPhase(this.state, this.logger);
    }
  }

  private advanceToNextPlayer(): void {
    this.state = nextPhase(this.state, this.logger);
    this.state = { ...this.state, killsPlayedThisTurn: 0, skillsUsedThisTurn: [] };
    this.advanceToPlayPhase();
  }

  private fail(_reason: string): ActionResult {
    return { success: false, state: this.state, events: [] };
  }
}
