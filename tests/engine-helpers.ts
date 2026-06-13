// tests/engine-helpers.ts
// 测试 helper —— 用新顶层 API(create / dispatch / buildView / fireTimeout / resetForTest)。
//
// 主要提供:
//   - TestEngine:state 生命周期 + dispatch 包装
//   - createTestGame(opts):建一个最小可玩 GameState(数组式 players)
//   - 卡牌查找 / 注入 / 装备 helper:操作 array-based state.players
//
// 与旧 engine-helpers 区别:
//   - 不再有 createEngine() 闭包实例,改成 TestEngine 包装 state + 顶层函数
//   - state.players 改数组;用 name 查找的 helper 改 players.find(p => p.name === name)

import type { Card, ClientMessage, GameState, PlayerState, Json } from '../src/engine/types';
import { createGameState } from '../src/engine/types';
import {
  create,
  bootstrap,
  dispatch,
  buildView,
  fireTimeout,
  resetForTest,
  type GameConfig,
} from '../src/engine/create-engine';

// ─── TestEngine 包装(轻量替代旧 EngineInstance) ───────────────

/** 测试用 engine 包装:持有 state + 转发顶层函数。 */
export class TestEngine {
  constructor(public state: GameState) {}

  static fromConfig(config: GameConfig): TestEngine {
    resetForTest();
    const state = create(config);
    return new TestEngine(state);
  }

  static fromState(state: GameState): TestEngine {
    resetForTest();
    return new TestEngine(state);
  }

  /** 异步 bootstrap(只用于 create() 出来的骨架 state) */
  async bootstrapWith(config: GameConfig): Promise<void> {
    await bootstrap(this.state, config);
  }

  async dispatch(msg: ClientMessage): Promise<{ error?: string; gameOver?: boolean; winner?: string }> {
    return dispatch(this.state, msg);
  }

  view(playerIdx: number) {
    return buildView(this.state, playerIdx);
  }

  async fireTimeout() {
    return fireTimeout(this.state);
  }

  get seq(): number {
    return this.state.seq;
  }
}

/** 旧 API 兼容 —— 返回一个 TestEngine。 */
export function createTestEngine(state?: GameState): TestEngine {
  return state ? TestEngine.fromState(state) : new TestEngine(createGameState({ players: [], cardMap: {} }));
}

// ─── 角色查找表(测试傀儡,无 trigger) ──────────────────────────

/** 测试傀儡角色 —— 不带任何技能,避免 emitEvent 误触发 */
export const DUMMY_CHARACTER = '测试傀儡';

export function isDummyCharacter(name: string): boolean {
  return name === DUMMY_CHARACTER;
}

// ─── 创建测试游戏 ─────────────────────────────────────────────

export interface TestGameOptions {
  playerCount?: number;
  /** 自定义玩家名字数组(覆盖默认 P1/P2/...) */
  playerNames?: string[];
  /** 自定义角色名(覆盖默认 测试傀儡) */
  characters?: string[];
  seed?: number;
  /** 直接设置出牌阶段 */
  playPhase?: boolean;
  /** 覆盖指定玩家的手牌(cardId 列表)。未列出的玩家清空手牌。 */
  hand?: Record<string, string[]>;
  /** 覆盖牌堆内容(cardId 列表)。cardMap 中不存在的 ID 会自动以占位 Card 注入。 */
  deck?: string[];
  /** 覆盖当前玩家索引(默认 0) */
  currentPlayerIndex?: number;
}

/**
 * 创建一个最小可玩的 GameState(数组式 players)。
 * 默认 2 人测试傀儡 vs 测试傀儡,种子 42。
 */
export function createTestGame(opts: TestGameOptions = {}): GameState {
  const playerCount = opts.playerCount ?? 2;
  const seed = opts.seed ?? 42;
  const characters = opts.characters ?? Array(playerCount).fill(DUMMY_CHARACTER);
  const names = opts.playerNames ?? Array.from({ length: playerCount }, (_, i) => `P${i + 1}`);

  const players: PlayerState[] = names.map((name, i) => ({
    index: i,
    name,
    character: characters[i] ?? DUMMY_CHARACTER,
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  }));

  let state = createGameState({
    players,
    cardMap: {},
    currentPlayerIndex: opts.currentPlayerIndex ?? 0,
    phase: '出牌',
    rngSeed: seed,
  });
  state.turn = { round: 1, phase: '出牌', vars: {} };

  if (opts.playPhase) {
    state.phase = '出牌';
  }

  if (opts.hand) {
    state.players = state.players.map((p) => ({
      ...p,
      hand: opts.hand![p.name] ? [...opts.hand![p.name]] : [],
    }));
  }

  if (opts.deck) {
    const cardMap: Record<string, Card> = { ...state.cardMap };
    for (const id of opts.deck) {
      if (!cardMap[id]) {
        cardMap[id] = {
          id,
          name: id,
          type: '基本牌',
          subtype: '杀',
          suit: '♠',
          rank: 'A',
        };
      }
    }
    state.zones = { ...state.zones, deck: [...opts.deck] };
    state.cardMap = cardMap;
  }

  return state;
}

// ─── 玩家查询 helper ──────────────────────────────────────────

/** 按名字找玩家 */
export function findPlayer(state: GameState, name: string): PlayerState | undefined {
  return state.players.find((p) => p.name === name);
}

/** 按名字找玩家(找不到时 throw) */
export function mustPlayer(state: GameState, name: string): PlayerState {
  const p = findPlayer(state, name);
  if (!p) throw new Error(`Player ${name} not found`);
  return p;
}

// ─── 卡牌查询 / 注入 helper ───────────────────────────────────

/** 获取玩家手牌中指定名称的牌 ID */
export function findCardInHand(state: GameState, playerName: string, cardName: string): string | undefined {
  const player = findPlayer(state, playerName);
  if (!player) return undefined;
  return player.hand.find((id) => state.cardMap[id]?.name === cardName);
}

/** 获取玩家手牌中所有指定名称的牌 ID */
export function findAllCardsInHand(state: GameState, playerName: string, cardName: string): string[] {
  const player = findPlayer(state, playerName);
  if (!player) return [];
  return player.hand.filter((id) => state.cardMap[id]?.name === cardName);
}

/** 获取玩家手牌中任意一张指定类型的牌 ID */
export function findCardByType(state: GameState, playerName: string, cardType: string): string | undefined {
  const player = findPlayer(state, playerName);
  if (!player) return undefined;
  return player.hand.find((id) => state.cardMap[id]?.type === cardType);
}

// ─── state 注入 helper(返回新 state,不原地变更) ──────────────

/** 给玩家手牌中注入一张指定名称的牌 */
export function injectCard(state: GameState, playerName: string, cardName: string): GameState {
  const cardId = `test-${cardName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const card: Card = {
    id: cardId,
    name: cardName,
    type: '基本牌',
    subtype: cardName as '杀' | '闪' | '桃',
    suit: '♠',
    rank: 'A',
  };
  const cardMap = { ...state.cardMap, [cardId]: card };
  return {
    ...state,
    cardMap,
    players: state.players.map((p) => (p.name === playerName ? { ...p, hand: [...p.hand, cardId] } : p)),
  };
}

/** 给玩家手牌中注入一张指定类型的装备牌 */
export function injectEquipCard(
  state: GameState,
  playerName: string,
  cardName: string,
  subtype: '武器' | '防具' | '进攻马' | '防御马',
  range?: number,
): GameState {
  const cardId = `test-${cardName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const card: Card = {
    id: cardId,
    name: cardName,
    type: '装备牌',
    subtype,
    suit: '♠',
    rank: 'A',
    ...(range != null ? { range } : {}),
  };
  const cardMap = { ...state.cardMap, [cardId]: card };
  return {
    ...state,
    cardMap,
    players: state.players.map((p) => (p.name === playerName ? { ...p, hand: [...p.hand, cardId] } : p)),
  };
}

/** 给玩家手牌中注入一张锦囊牌 */
export function injectTrickCard(state: GameState, playerName: string, cardName: string): GameState {
  const cardId = `test-${cardName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const card: Card = {
    id: cardId,
    name: cardName,
    type: '锦囊牌',
    subtype: '锦囊',
    suit: '♠',
    rank: 'A',
  };
  const cardMap = { ...state.cardMap, [cardId]: card };
  return {
    ...state,
    cardMap,
    players: state.players.map((p) => (p.name === playerName ? { ...p, hand: [...p.hand, cardId] } : p)),
  };
}

/** 设置玩家体力值(返回新 state) */
export function setHealth(state: GameState, playerName: string, health: number): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.name === playerName ? { ...p, health } : p)),
  };
}

/** 让所有状态设为出牌阶段 */
export function setPlayPhase(state: GameState): GameState {
  return { ...state, phase: '出牌' };
}

// ─── 装备 helper(返回新 state) ─────────────────────────────────

export function withArmor(state: GameState, playerName: string, armorId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.name === playerName ? { ...p, equipment: { ...p.equipment, 防具: armorId } } : p,
    ),
  };
}

export function withWeapon(state: GameState, playerName: string, weaponId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.name === playerName ? { ...p, equipment: { ...p.equipment, 武器: weaponId } } : p,
    ),
  };
}

export function withHand(state: GameState, playerName: string, cardIds: string[]): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.name === playerName ? { ...p, hand: [...cardIds] } : p)),
  };
}

export function withEquipment(
  state: GameState,
  playerName: string,
  equipment: { 武器?: string; 防具?: string; 防御马?: string; 进攻马?: string },
): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.name === playerName ? { ...p, equipment: { ...p.equipment, ...equipment } } : p,
    ),
  };
}

// ─── 旧 API 兼容 wrapper(已删除/重构的函数 stub) ───────────────

/** 旧 API:已重构为 findPlayer(state, name) —— 这里提供 Record 版本以兼容旧 import */
export function getCharacterMap(): Record<string, { name: string; maxHealth: number }> {
  return { [DUMMY_CHARACTER]: { name: DUMMY_CHARACTER, maxHealth: 4 } };
}

/** 旧 API:旧 trickResponse 窗口已被新 engine 删 —— 这里 stub 返回输入 state */
export async function passAllTrickResponders(state: GameState): Promise<GameState> {
  return state;
}

/** 旧 API:act(state, action) —— 现在 action 改用 ClientMessage */
export async function act(
  state: GameState,
  action: { skillId: string; actionType: string; params?: Record<string, Json>; ownerId?: string },
): Promise<GameState> {
  const before = state;
  const result = await dispatch(state, {
    skillId: action.skillId,
    actionType: action.actionType,
    ownerId: action.ownerId ?? state.players[state.currentPlayerIndex]?.name ?? '',
    params: action.params ?? {},
    baseSeq: state.seq,
  });
  if (result.error) {
    throw new Error(`Engine error: ${result.error}`);
  }
  return state === before ? state : state;
}

/** 旧 API:expectError(state, action) —— 返回 error string(空 = 无错) */
export async function expectError(
  state: GameState,
  action: { skillId: string; actionType: string; params?: Record<string, Json>; ownerId?: string },
): Promise<string> {
  const result = await dispatch(state, {
    skillId: action.skillId,
    actionType: action.actionType,
    ownerId: action.ownerId ?? state.players[state.currentPlayerIndex]?.name ?? '',
    params: action.params ?? {},
    baseSeq: state.seq,
  });
  return result.error ?? '';
}

/** 获取当前玩家的名字(数组式:currentPlayerIndex → name) */
export function currentPlayer(state: GameState): string {
  return state.players[state.currentPlayerIndex]?.name ?? '';
}
