import { it } from 'vitest';
import type { GameState, GameEvent, GameAction, PlayerEvent } from '@engine/types';
import type { Card as SharedCard } from '@shared/types';
import { allCharacters } from '@shared/characters';
import { createInitialState, getPlayer } from '@engine/state';
import { engine } from '@engine/engine';
import { emitEvent as engineEmitEvent, registerCharacterTriggers } from '@engine/skill';
import { allTricks, weapons, armors, horses } from './fixtures/cards';
import type { PlayerView, Animation, AvailableAction, CardInfo } from './frontend/types';
import { eventsToAnimations } from './frontend/eventsToAnimations';
import { getAvailableActions } from './frontend/actions';

const characterMap = Object.fromEntries(
  allCharacters.map(c => [c.name, c]),
);

interface GameSnapshot {
  health: Record<string, number>;
  handSize: Record<string, number>;
  phase: string;
  currentPlayer: string;
  deckSize: number;
  discardPileSize: number;
}

export interface StateDiff {
  healthChanges: Record<string, number>;
  handSizeChanges: Record<string, number>;
  phaseChanged: boolean;
  currentPlayerChanged: boolean;
}

function makeCardInfoFromId(cardId: string | undefined, cardMap: Record<string, SharedCard | undefined>): CardInfo | null {
  if (!cardId) return null;
  const card = cardMap[cardId];
  if (!card) return null;
  return { id: cardId, name: card.name ?? '', type: card.type ?? '基本牌', subtype: card.subtype ?? '杀', suit: card.suit ?? '♠', rank: card.rank ?? 'A', description: card.description ?? '' };
}

function buildPlayerView(state: GameState, playerId: string): PlayerView {
  const players = Object.keys(state.players);
  const self = getPlayer(state, playerId);
  return {
    self: {
      hand: self.hand.map(id => makeCardInfoFromId(id, state.cardMap)!),
      equipment: {
        weapon: makeCardInfoFromId(self.equipment.weapon, state.cardMap),
        armor: makeCardInfoFromId(self.equipment.armor, state.cardMap),
        mount: makeCardInfoFromId(self.equipment.horsePlus ?? self.equipment.horseMinus, state.cardMap),
      },
      health: self.health,
      maxHealth: self.maxHealth,
      pendingTricks: (self.pendingTricks ?? []).map(t => ({ name: t.name, source: t.source, cardId: t.card.id })),
      tags: [...(self.tags ?? [])],
      vars: { ...(self.vars ?? {}) },
      alive: self.info.alive,
    },
    others: Object.fromEntries(players.filter(p => p !== playerId).map(p => {
      const other = getPlayer(state, p);
      return [p, {
        handCount: other.hand.length,
        equipment: {
          weapon: other.equipment.weapon ?? null,
          armor: other.equipment.armor ?? null,
          mount: (other.equipment.horsePlus ?? other.equipment.horseMinus) ?? null,
        },
        health: other.health,
        maxHealth: other.maxHealth,
        pendingTrickCount: (other.pendingTricks ?? []).length,
        alive: other.info.alive,
      }];
    })),
    table: {
      discardPileCount: state.zones.discardPile.length,
      deckCount: state.zones.deck.length,
    },
    turn: {
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      killsPlayed: state.turn.killsPlayed,
    },
  };
}

export class ScenarioContext {
  state: GameState;
  private _snapshots: Map<string, GameSnapshot> = new Map();
  private _cardCounter = 0;
  lastEvents: PlayerEvent[] = [];

  constructor(state: GameState) {
    this.state = state;
  }

  selectCharacters(...names: string[]): void {
    const roles = ['主公', '反贼', '忠臣', '内奸'] as const;
    const config = {
      players: names.map((charId, i) => ({
        name: `P${i + 1}`,
        characterId: charId,
        role: roles[i % roles.length],
      })),
      seed: 42,
      characterMap,
    };
    let state = createInitialState(config);
    for (let i = 0; i < names.length; i++) {
      state = registerCharacterTriggers(state, `P${i + 1}`, { characterMap });
    }
    this.state = state;
  }

  setHealth(player: string, value: number): void {
    const p = getPlayer(this.state, player);
    this.state = {
      ...this.state,
      players: {
        ...this.state.players,
        [player]: { ...p, health: value },
      },
    };
  }

  setCurrentPlayer(player: string): void {
    this.state = { ...this.state, currentPlayer: player };
  }

  enterPlayPhase(): void {
    this.state = { ...this.state, phase: '出牌', pending: null };
  }

  /** 移除指定玩家手牌中的所有杀（用于决斗/南蛮入侵等测试中避免响应） */
  ensureNoKill(player: string): void {
    const p = getPlayer(this.state, player);
    const nonKill = p.hand.filter(id => this.state.cardMap[id]?.name !== '杀');
    const kills = p.hand.filter(id => this.state.cardMap[id]?.name === '杀');
    if (kills.length > 0) {
      this.state = {
        ...this.state,
        zones: { ...this.state.zones, deck: [...this.state.zones.deck, ...kills] },
        players: {
          ...this.state.players,
          [player]: { ...p, hand: nonKill },
        },
      };
    }
  }

  registerTriggers(player: string): void {
    this.state = registerCharacterTriggers(this.state, player, { characterMap });
  }

  private _getCardTemplate(name: string): SharedCard | undefined {
    const trickCard = allTricks.find(c => c.name === name);
    if (trickCard) return trickCard;
    const weaponCard = weapons.find(c => c.name === name);
    if (weaponCard) return weaponCard;
    const armorCard = armors.find(c => c.name === name);
    if (armorCard) return armorCard;
    const horseCard = horses.find(c => c.name === name);
    if (horseCard) return horseCard;
    const basicTemplates: Record<string, SharedCard> = {
      杀: { id: '', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' },
      闪: { id: '', name: '闪', type: '基本牌', subtype: '闪', suit: '♠', rank: 'A', description: '' },
      桃: { id: '', name: '桃', type: '基本牌', subtype: '桃', suit: '♠', rank: 'A', description: '' },
    };
    return basicTemplates[name];
  }

  giveCard(to: string, cardName: string, count: number = 1): void {
    const template = this._getCardTemplate(cardName);
    if (!template) throw new Error(`未知卡牌: ${cardName}`);
    for (let i = 0; i < count; i++) {
      const cardId = `test-${cardName}-${++this._cardCounter}`;
      const card: SharedCard = {
        id: cardId,
        name: template.name,
        type: template.type,
        subtype: template.subtype,
        suit: template.suit,
        rank: template.rank,
        description: template.description,
        ...(template.range !== undefined ? { range: template.range } : {}),
        ...(template.trickSubtype !== undefined ? { trickSubtype: template.trickSubtype } : {}),
      };
      const player = getPlayer(this.state, to);
      this.state = {
        ...this.state,
        cardMap: { ...this.state.cardMap, [cardId]: card },
        players: {
          ...this.state.players,
          [to]: { ...player, hand: [...player.hand, cardId] },
        },
      };
    }
  }

  playCard(player: string, cardId: string, target?: string): void {
    const result = engine(this.state, { type: 'playCard', player, cardId, target });
    if (result.error) throw new Error(`playCard error: ${result.error}`);
    this.state = result.state;
    this.lastEvents = result.playerEvents?.get(player) ?? [];
  }

  respond(player: string, cardId?: string): void {
    const result = engine(this.state, { type: 'respond', player, cardId });
    if (result.error) throw new Error(`respond error: ${result.error}`);
    this.state = result.state;
    this.lastEvents = result.playerEvents?.get(player) ?? [];
  }

  useSkill(player: string, skillId: string): void {
    const result = engine(this.state, { type: 'useSkill', player, skillId });
    if (result.error) throw new Error(`useSkill error: ${result.error}`);
    this.state = result.state;
    this.lastEvents = result.playerEvents?.get(player) ?? [];
  }

  discardCards(player: string, cardIds: string[]): void {
    const result = engine(this.state, { type: 'discard', player, cardIds });
    if (result.error) throw new Error(`discardCards error: ${result.error}`);
    this.state = result.state;
    this.lastEvents = result.playerEvents?.get(player) ?? [];
  }

  endTurn(player: string): void {
    const result = engine(this.state, { type: 'endTurn', player });
    if (result.error) throw new Error(`endTurn error: ${result.error}`);
    this.state = result.state;
    this.lastEvents = result.playerEvents?.get(player) ?? [];
  }

  /** 直接发射 GameEvent 触发技能（用于引擎路径尚未覆盖的事件场景） */
  emitEvent(event: GameEvent): void {
    const result = engineEmitEvent(this.state, event);
    this.state = result.state;
    this.lastEvents = result.playerEvents?.get(event.type) ?? [];
  }

  /** 执行任意 engine action */
  engineAction(action: GameAction): void {
    const result = engine(this.state, action);
    if (result.error) throw new Error(`action error (${action.type}): ${result.error}`);
    this.state = result.state;
    this.lastEvents = result.playerEvents?.get('') ?? [];
  }

  player(name: string) {
    return getPlayer(this.state, name);
  }

  handSize(player: string): number {
    return getPlayer(this.state, player).hand.length;
  }

  findCard(player: string, cardName: string): string | undefined {
    const p = getPlayer(this.state, player);
    return p.hand.find(id => this.state.cardMap[id]?.name === cardName);
  }

  isPending(): boolean {
    return this.state.pending !== null;
  }

  pendingType(): string | null {
    return this.state.pending?.type ?? null;
  }

  snapshot(label: string = 'default'): GameSnapshot {
    const snap: GameSnapshot = {
      health: {},
      handSize: {},
      phase: this.state.phase,
      currentPlayer: this.state.currentPlayer,
      deckSize: this.state.zones.deck.length,
      discardPileSize: this.state.zones.discardPile.length,
    };
    for (const name of Object.keys(this.state.players)) {
      snap.health[name] = getPlayer(this.state, name).health;
      snap.handSize[name] = getPlayer(this.state, name).hand.length;
    }
    this._snapshots.set(label, snap);
    return snap;
  }

  diff(fromLabel: string = 'default'): StateDiff {
    const snap = this._snapshots.get(fromLabel);
    if (!snap) throw new Error(`No snapshot: ${fromLabel}`);
    const result: StateDiff = {
      healthChanges: {},
      handSizeChanges: {},
      phaseChanged: snap.phase !== this.state.phase,
      currentPlayerChanged: snap.currentPlayer !== this.state.currentPlayer,
    };
    for (const name of Object.keys(this.state.players)) {
      const current = getPlayer(this.state, name);
      result.healthChanges[name] = current.health - (snap.health[name] ?? 0);
      result.handSizeChanges[name] = current.hand.length - (snap.handSize[name] ?? 0);
    }
    return result;
  }
}

type ViewCheck = (ctx: ScenarioContext, view: PlayerView) => void;
type AnimCheck = (ctx: ScenarioContext, anims: Animation[]) => void;
type ActionCheck = (ctx: ScenarioContext, actions: AvailableAction[]) => void;

interface Step {
  label: string;
  act?: (ctx: ScenarioContext) => void;
  check?: (ctx: ScenarioContext) => void;
  viewCheck?: { playerId: string; fn: ViewCheck };
  animCheck?: { playerId?: string; fn: AnimCheck };
  actionCheck?: { playerId: string; fn: ActionCheck };
}

export class ScenarioBuilder {
  private _description: string;
  private _steps: Step[] = [];
  private _setupFn?: (ctx: ScenarioContext) => void;

  constructor(description: string) {
    this._description = description;
  }

  setup(fn: (ctx: ScenarioContext) => void): this {
    this._setupFn = fn;
    return this;
  }

  act(label: string, fn: (ctx: ScenarioContext) => void): this {
    this._steps.push({ label, act: fn });
    return this;
  }

  check(label: string, fn: (ctx: ScenarioContext) => void): this {
    this._steps.push({ label, check: fn });
    return this;
  }

  checkView(playerId: string, fn: ViewCheck): this {
    this._steps.push({ label: `checkView(${playerId})`, viewCheck: { playerId, fn } });
    return this;
  }

  /** 验证指定玩家视角的动画序列 */
  checkAnimations(label: string, playerId: string, fn: AnimCheck): this {
    this._steps.push({ label, animCheck: { playerId, fn } });
    return this;
  }

  /** 验证当前操作产生的动画（不限定玩家） */
  checkAnimationsAll(label: string, fn: AnimCheck): this {
    this._steps.push({ label, animCheck: { playerId: '', fn } });
    return this;
  }

  /** 验证指定玩家视角的可用操作 */
  checkAvailable(label: string, playerId: string, fn: ActionCheck): this {
    this._steps.push({ label, actionCheck: { playerId, fn } });
    return this;
  }

  run(): void {
    it(this._description, () => {
      const ctx = new ScenarioContext({} as GameState);
      if (this._setupFn) {
        this._setupFn(ctx);
      }
      for (const step of this._steps) {
        if (step.act) {
          step.act(ctx);
        }
        if (step.check) {
          step.check(ctx);
        }
        if (step.viewCheck) {
          const view = buildPlayerView(ctx.state, step.viewCheck.playerId);
          step.viewCheck.fn(ctx, view);
        }
        if (step.animCheck) {
          const pid = step.animCheck.playerId ?? '';
          const anims = eventsToAnimations(pid, ctx.lastEvents);
          step.animCheck.fn(ctx, anims);
        }
        if (step.actionCheck) {
          const view = buildPlayerView(ctx.state, step.actionCheck.playerId);
          const actions = getAvailableActions(view, ctx.state.pending);
          step.actionCheck.fn(ctx, actions);
        }
      }
    });
  }
}

export function scenario(description: string): ScenarioBuilder {
  return new ScenarioBuilder(description);
}
