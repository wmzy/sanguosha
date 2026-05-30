import type { GameState, Card, PublicGameState, CharacterConfig, Player, TurnPhase } from '../shared/types';
import type { Rng } from '../shared/rng';
import { createRng } from '../shared/rng';
import { createGame, startGame, getPublicState, getPlayer, getAlivePlayers, updatePlayer } from './state';
import { nextPhase, drawPhase, checkDiscard, executeDiscard, handleJudgePhase, phaseModes } from './turn';
import { executeEffect } from './effect';
import { TriggerSystem } from './trigger';
import {
  ResponseSystem,
  createKillResponseWindow,
  createAOEResponseWindow,
  createDyingResponseWindow,
  resolveKillResponse,
  resolveAOEResponse,
  resolveDyingResponse,
} from './response';
import { ValidationPipeline, getCardDef, getValidActions, getValidTargetsForCard, isCardPlayable } from './validation';
import { registerCharacterSkills } from './skill';
import { getDistance, getAttackRange } from './distance';
import { GameLogger } from './logger';
import { getConversionOptions } from './convert';
import { performJudge } from './judge';
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
    let card = player.hand[cardIndex];

    if (card._conversion) {
      card = { ...card, name: card._conversion };
    }

    if (!isCardPlayable(this.state, player, card)) {
      const conversions = getConversionOptions(player, card.name, 'play');
      const match = conversions.find(c => c.originalCard.id === cardId);
      if (!match) return this.fail('这张牌不能使用');
      card = match.convertedCard;
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
      discardPile: [...this.state.discardPile, card._original ?? card],
    };

    if (card.name === '杀') {
      state = { ...state, killsPlayedThisTurn: state.killsPlayedThisTurn + 1 };
    }

    const ctx = this.buildContext(playerName, target, card);
    if (card.name === '杀' || card.name === '决斗') {
      const p = getPlayer(state, playerName);
      ctx._裸衣Active = p.character.abilities.some(a => a.modifiers?.includes('裸衣Bonus'));
    }
    const events: GameEvent[] = [
      { type: 'cardPlayed', player: playerName, target, card },
    ];

    if (card.type === '装备牌') {
      state = this.equipCard(state, playerName, card);
      events.push({ type: 'equipChange', player: playerName, card });
      this.state = state;
      return { success: true, state, events };
    }

    if (card.trickSubtype === '延时锦囊') {
      const actualTarget = target ?? playerName;
      const trick = { name: card.name, source: playerName, card };
      const targetPlayer = getPlayer(state, actualTarget);
      state = updatePlayer(state, actualTarget, {
        pendingTricks: [...(targetPlayer.pendingTricks ?? []), trick],
      });
      this.state = state;
      return { success: true, state, events };
    }

    if (def.responseWindow === 'kill_response' && target) {
      this.state = state;
      const responseWindow = createKillResponseWindow(playerName, target, card);
      this.responses.push(responseWindow);
      return { success: true, state, events, responseWindow };
    }

    if (def.aoeResponse) {
      const targets = getAlivePlayers(state)
        .filter(p => p.name !== playerName)
        .map(p => p.name);
      this.state = state;
      const responseWindow = createAOEResponseWindow(playerName, targets, def.aoeResponse as '闪' | '杀');
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

    state = this.checkHandEmpty(state, playerName);
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

    let skipPhases = new Set<TurnPhase>();
    const ctx = this.buildContext(playerName);
    this.state = this.triggerHooks(this.state, 'turnEnd', ctx);
    if (ctx._skipFlags) {
      skipPhases = ctx._skipFlags.phases;
    }

    this.state = nextPhase(this.state, this.logger);

    if (this.state.phase === '弃牌' && skipPhases.has('弃牌')) {
      this.state = nextPhase(this.state, this.logger);
    }

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
    const window = this.responses.pop();
    if (!window) {
      return this.fail('没有等待响应的操作');
    }

    let state: GameState;
    switch (window.type) {
      case 'kill_response': {
        const target = window.validResponders[0];
        const targetPlayer = getPlayer(this.state, target);
        const armorDef = targetPlayer.equipment.armor ? getCardDef(targetPlayer.equipment.armor.name) : undefined;
        const armorEffect = armorDef?.armorEffect;
        const dodgeCard = responses.get(target);

        if (!dodgeCard && armorEffect?.type === 'blockBlackKill') {
          const sourceCard = window.sourceCard;
          if (sourceCard && (sourceCard.suit === '♠' || sourceCard.suit === '♣')) {
            state = this.state;
            break;
          }
        }

        if (!dodgeCard && armorEffect?.type === 'judgeDodge') {
          const { game: judgedState, card: judgeCard } = performJudge(this.state, this.rng);
          this.state = judgedState;
          const isRed = judgeCard.suit === '♥' || judgeCard.suit === '♦';
          if (isRed) {
            state = {
              ...this.state,
              discardPile: [...this.state.discardPile, judgeCard],
            };
            break;
          }
          state = {
            ...this.state,
            discardPile: [...this.state.discardPile, judgeCard],
          };
          const tp = getPlayer(state, target);
          state = updatePlayer(state, target, { health: tp.health - 1 });
          break;
        }

        state = resolveKillResponse(this.state, window, responses);

        const noDodge = !responses.get(target);
        if (noDodge) {
          const attacker = getPlayer(state, window.requester);
          if (attacker.character.abilities.some(a => a.modifiers?.includes('裸衣Bonus'))) {
            const tp = getPlayer(state, target);
            state = updatePlayer(state, target, { health: tp.health - 1 });
          }
        }

        const responseCard = responses.get(target);
        if (responseCard) {
          const attackerPlayer = getPlayer(state, window.requester);
          const weaponDef = attackerPlayer.equipment.weapon
            ? getCardDef(attackerPlayer.equipment.weapon.name)
            : undefined;

          if (weaponDef?.weaponEffect?.type === 'forceHit') {
            const attacker = getPlayer(state, window.requester);
            if (attacker.hand.length >= 2) {
              const forcedState = this.forceHitDiscard(state, window.requester, target);
              if (forcedState) {
                state = forcedState;
              }
            }
          }
        }
        break;
      }
      case 'aoe_response':
        state = resolveAOEResponse(this.state, window, responses);
        break;
      case 'dying':
        state = resolveDyingResponse(this.state, window, responses, this.logger);
        break;
      case 'trick_response':
        state = this.state;
        break;
      default:
        state = this.state;
    }

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

        state = this.checkKylinBow(state, window.requester, target);
      }
    }

    // 检查濒死（伤害造成后，或 dying 窗口解决后都需要再次扫描）
    if (window.type === 'kill_response' || window.type === 'aoe_response' || window.type === 'dying') {
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
      let dodgeCard: Card | undefined = targetPlayer.hand.find(c => c.name === '闪');
      if (!dodgeCard) {
        const conversions = getConversionOptions(targetPlayer, '闪', 'response');
        if (conversions.length > 0) {
          dodgeCard = conversions[0].convertedCard;
        }
      }
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
      let peachCard: Card | undefined = saverPlayer.hand.find(c => c.name === '桃');
      if (!peachCard) {
        const conversions = getConversionOptions(saverPlayer, '桃', 'response');
        if (conversions.length > 0) {
          peachCard = conversions[0].convertedCard;
        }
      }
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
      _aliveCount: getAlivePlayers(this.state).length,
    };
  }

  private triggerHooks(
    state: GameState,
    eventType: string,
    ctx: EffectExecContext,
  ): GameState {
    return this.triggers.emit(state, { type: eventType, player: ctx.player, target: ctx.target, card: ctx.card }, ctx, executeEffect);
  }

  private checkHandEmpty(state: GameState, playerName: string): GameState {
    const player = getPlayer(state, playerName);
    if (player.hand.length === 0) {
      const ctx = this.buildContext(playerName);
      return this.triggerHooks(state, 'handEmpty', ctx);
    }
    return state;
  }

  private forceHitDiscard(state: GameState, attackerName: string, targetName: string): GameState | null {
    const attacker = getPlayer(state, attackerName);
    if (attacker.hand.length < 2) return null;

    const discardIdx0 = this.rng.nextInt(attacker.hand.length);
    let discardIdx1 = this.rng.nextInt(attacker.hand.length - 1);
    if (discardIdx1 >= discardIdx0) discardIdx1++;

    const discarded = [attacker.hand[discardIdx0], attacker.hand[discardIdx1]];
    const remaining = attacker.hand.filter((_, i) => i !== discardIdx0 && i !== discardIdx1);

    const target = getPlayer(state, targetName);
    let newState: GameState = {
      ...updatePlayer(state, attackerName, { hand: remaining }),
      discardPile: [...state.discardPile, ...discarded],
    };
    newState = updatePlayer(newState, targetName, { health: target.health - 1 });
    newState = this.checkHandEmpty(newState, attackerName);
    return newState;
  }

  private checkKylinBow(state: GameState, attackerName: string, targetName: string): GameState {
    const attacker = getPlayer(state, attackerName);
    if (attacker.equipment.weapon?.name !== '麒麟弓') return state;

    const target = getPlayer(state, targetName);
    const equipment = { ...target.equipment };
    const horseToDiscard = equipment.horseMinus ?? equipment.horsePlus;
    if (!horseToDiscard) return state;

    if (equipment.horseMinus?.name === horseToDiscard.name) {
      equipment.horseMinus = undefined;
    } else if (equipment.horsePlus?.name === horseToDiscard.name) {
      equipment.horsePlus = undefined;
    }

    return {
      ...updatePlayer(state, targetName, { equipment }),
      discardPile: [...state.discardPile, horseToDiscard],
    };
  }

  private equipCard(state: GameState, playerName: string, card: Card): GameState {
    const player = getPlayer(state, playerName);
    const equipment = { ...player.equipment };
    const oldDiscardPile = [...state.discardPile];
    const oldEquipment: Card[] = [];

    if (card.subtype === '武器') {
      if (equipment.weapon) { oldEquipment.push(equipment.weapon); oldDiscardPile.push(equipment.weapon); }
      equipment.weapon = card;
    } else if (card.subtype === '防具') {
      if (equipment.armor) { oldEquipment.push(equipment.armor); oldDiscardPile.push(equipment.armor); }
      equipment.armor = card;
    } else if (card.subtype === '进攻马') {
      if (equipment.horseMinus) { oldEquipment.push(equipment.horseMinus); oldDiscardPile.push(equipment.horseMinus); }
      equipment.horseMinus = card;
    } else if (card.subtype === '防御马') {
      if (equipment.horsePlus) { oldEquipment.push(equipment.horsePlus); oldDiscardPile.push(equipment.horsePlus); }
      equipment.horsePlus = card;
    }

    let newState: GameState = {
      ...updatePlayer(state, playerName, { equipment }),
      discardPile: oldDiscardPile,
    };

    for (const old of oldEquipment) {
      const ctx = this.buildContext(playerName, undefined, old);
      newState = this.triggerHooks(newState, 'equipChange', ctx);
    }

    return newState;
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
    while (phaseModes[this.state.phase] === 'auto' && this.state.status === '进行中') {
      let skipDraw = false;
      let skipPhases = new Set<TurnPhase>();

      if (this.state.phase === '摸牌') {
        const ctx = this.buildContext(this.state.currentPlayer);
        this.state = this.triggerHooks(this.state, 'turnStart', ctx);
        if (ctx._skipFlags) {
          skipDraw = ctx._skipFlags.draw;
          skipPhases = ctx._skipFlags.phases;
        }
      }

      if (this.state.phase === '判定') {
        const result = handleJudgePhase(this.state, this.rng, this.logger);
        this.state = result.state;
        for (const p of result.skipPhases) {
          skipPhases.add(p);
        }
      }

      this.state = nextPhase(this.state, this.logger);

      if (this.state.phase === '摸牌' && skipPhases.has('摸牌')) {
        this.state = nextPhase(this.state, this.logger);
        continue;
      }

      if (this.state.phase === '摸牌' && !skipDraw) {
        const result = drawPhase(this.state, this.rng, this.logger);
        this.state = result.state;
        this.state = nextPhase(this.state, this.logger);
      }

      if (this.state.phase === '出牌' && skipPhases.has('出牌')) {
        this.state = nextPhase(this.state, this.logger);
      }
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
