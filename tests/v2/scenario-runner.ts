import { describe, it, expect } from 'vitest';
import type { GameState, GameEvent, GameAction } from '@engine/v2/types';
import type { CharacterConfig, Card as SharedCard } from '@shared/types';
import { allCharacters } from '@shared/characters';
import { createInitialState, getPlayer } from '@engine/v2/state';
import { engine } from '@engine/v2/engine';
import { emitEvent as engineEmitEvent, registerCharacterTriggers } from '@engine/v2/skill';
import { allTricks, weapons, armors, horses } from '@shared/cards';

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

export class ScenarioContext {
  state: GameState;
  private _snapshots: Map<string, GameSnapshot> = new Map();
  private _cardCounter = 0;

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
      '杀': { id: '', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' },
      '闪': { id: '', name: '闪', type: '基本牌', subtype: '闪', suit: '♠', rank: 'A', description: '' },
      '桃': { id: '', name: '桃', type: '基本牌', subtype: '桃', suit: '♠', rank: 'A', description: '' },
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
  }

  respond(player: string, cardId?: string): void {
    const result = engine(this.state, { type: 'respond', player, cardId });
    if (result.error) throw new Error(`respond error: ${result.error}`);
    this.state = result.state;
  }

  useSkill(player: string, skillId: string): void {
    const result = engine(this.state, { type: 'useSkill', player, skillId });
    if (result.error) throw new Error(`useSkill error: ${result.error}`);
    this.state = result.state;
  }

  discardCards(player: string, cardIds: string[]): void {
    const result = engine(this.state, { type: 'discard', player, cardIds });
    if (result.error) throw new Error(`discardCards error: ${result.error}`);
    this.state = result.state;
  }

  endTurn(player: string): void {
    const result = engine(this.state, { type: 'endTurn', player });
    if (result.error) throw new Error(`endTurn error: ${result.error}`);
    this.state = result.state;
  }

  /** 直接发射 GameEvent 触发技能（用于引擎路径尚未覆盖的事件场景） */
  emitEvent(event: GameEvent): void {
    const result = engineEmitEvent(this.state, event);
    this.state = result.state;
  }

  /** 执行任意 engine action */
  engineAction(action: GameAction): void {
    const result = engine(this.state, action);
    if (result.error) throw new Error(`action error (${action.type}): ${result.error}`);
    this.state = result.state;
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

interface Step {
  label: string;
  act?: (ctx: ScenarioContext) => void;
  check?: (ctx: ScenarioContext) => void;
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
      }
    });
  }
}

export function scenario(description: string): ScenarioBuilder {
  return new ScenarioBuilder(description);
}
