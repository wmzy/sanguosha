/**
 * tests/v2/setup.ts — V2 引擎集成测试共享工具
 */
import { createInitialState } from '@engine/v2/state';
import { engine as rawEngine } from '@engine/v2/engine';
import { computeValidActions } from '@engine/v2/validate';
import { serialize, deserialize } from '@engine/v2/serializer';
import { allCharacters } from '@shared/characters';
import { safeEngine } from './invariants';
import type { GameState, GameAction } from '@engine/v2/types';
import type { CharacterConfig } from '@shared/types';

// ─── 角色查找表 ─────────────────────────────────────────────────

const characterMap = Object.fromEntries(
  allCharacters.map((c) => [c.name, c]),
);

export function getCharacterMap(): Record<string, CharacterConfig> {
  return characterMap;
}

export function getCharacter(name: string): CharacterConfig {
  const char = characterMap[name];
  if (!char) throw new Error(`Unknown character: ${name}`);
  return char;
}

// ─── 创建测试游戏 ───────────────────────────────────────────────

export interface TestGameOptions {
  playerCount?: number;
  characters?: string[];
  seed?: number;
  /** 直接设置出牌阶段 */
  playPhase?: boolean;
}

/**
 * 创建测试用 GameState。
 * 默认 2 人游戏（曹操 vs 刘备），种子 42。
 */
export function createTestGame(opts: TestGameOptions = {}): GameState {
  const playerCount = opts.playerCount ?? 2;
  const seed = opts.seed ?? 42;
  const defaultChars = ['曹操', '刘备', '孙权', '华佗', '诸葛亮', '司马懿'];
  const characters = opts.characters ?? defaultChars.slice(0, playerCount);

  const roles = ['主公', '反贼', '忠臣', '内奸'] as const;

  const config = {
    players: characters.map((charId, i) => ({
      name: `P${i + 1}`,
      characterId: charId,
      role: roles[i % roles.length] as '主公' | '反贼' | '忠臣' | '内奸',
    })),
    seed,
    characterMap,
  };

  let state = createInitialState(config);

  // 如果需要出牌阶段
  if (opts.playPhase) {
    state = { ...state, phase: '出牌' };
  }

  return state;
}

/**
 * 获取玩家手牌中指定名称的牌 ID。
 */
export function findCardInHand(state: GameState, playerName: string, cardName: string): string | undefined {
  const player = state.players[playerName];
  if (!player) return undefined;
  return player.hand.find((id) => state.cardMap[id]?.name === cardName);
}

/**
 * 获取玩家手牌中所有指定名称的牌 ID。
 */
export function findAllCardsInHand(state: GameState, playerName: string, cardName: string): string[] {
  const player = state.players[playerName];
  if (!player) return [];
  return player.hand.filter((id) => state.cardMap[id]?.name === cardName);
}

/**
 * 获取玩家手牌中任意一张指定类型的牌 ID。
 */
export function findCardByType(state: GameState, playerName: string, cardType: string): string | undefined {
  const player = state.players[playerName];
  if (!player) return undefined;
  return player.hand.find((id) => state.cardMap[id]?.type === cardType);
}

/**
 * 将游戏状态设置为出牌阶段。
 */
export function setPlayPhase(state: GameState): GameState {
  return {
    ...state,
    phase: '出牌',
    pending: null,
  };
}

/**
 * 给玩家手牌中注入一张指定名称的牌（用于测试）。
 * 返回新 GameState。
 */
export function injectCard(state: GameState, playerName: string, cardName: string): GameState {
  const cardId = `test-${cardName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const card = {
    id: cardId,
    name: cardName,
    type: '基本牌' as const,
    subtype: cardName as '杀' | '闪' | '桃',
    suit: '♠' as const,
    rank: 'A' as const,
    description: '',
  };

  const cardMap = { ...state.cardMap, [cardId]: card };
  const player = state.players[playerName];
  const players = {
    ...state.players,
    [playerName]: { ...player, hand: [...player.hand, cardId] },
  };

  return { ...state, cardMap, players };
}

/**
 * 给玩家手牌中注入一张指定类型的装备牌。
 */
export function injectEquipCard(
  state: GameState,
  playerName: string,
  cardName: string,
  subtype: '武器' | '防具' | '进攻马' | '防御马',
  range?: number,
): GameState {
  const cardId = `test-${cardName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const card = {
    id: cardId,
    name: cardName,
    type: '装备牌' as const,
    subtype,
    suit: '♠' as const,
    rank: 'A' as const,
    description: '',
    ...(range != null ? { range } : {}),
  };

  const cardMap = { ...state.cardMap, [cardId]: card };
  const player = state.players[playerName];
  const players = {
    ...state.players,
    [playerName]: { ...player, hand: [...player.hand, cardId] },
  };

  return { ...state, cardMap, players };
}

/**
 * 给玩家手牌中注入一张锦囊牌。
 */
export function injectTrickCard(
  state: GameState,
  playerName: string,
  cardName: string,
): GameState {
  const cardId = `test-${cardName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const card = {
    id: cardId,
    name: cardName,
    type: '锦囊牌' as const,
    subtype: '锦囊' as const,
    suit: '♠' as const,
    rank: 'A' as const,
    description: '',
  };

  const cardMap = { ...state.cardMap, [cardId]: card };
  const player = state.players[playerName];
  const players = {
    ...state.players,
    [playerName]: { ...player, hand: [...player.hand, cardId] },
  };

  return { ...state, cardMap, players };
}

/**
 * 设置玩家体力值（直接修改，用于测试）。
 */
export function setHealth(state: GameState, playerName: string, health: number): GameState {
  const player = state.players[playerName];
  return {
    ...state,
    players: {
      ...state.players,
      [playerName]: { ...player, health },
    },
  };
}

/**
 * 执行一个动作，断言没有错误，返回新状态。
 */
export function act(state: GameState, action: GameAction): GameState {
  const result = safeEngine(state, action);
  if (result.error) {
    throw new Error(`Engine error: ${result.error}`);
  }
  return result.state;
}

/**
 * 执行一个动作，期望返回错误。
 */
export function expectError(state: GameState, action: GameAction): string {
  const result = safeEngine(state, action);
  return result.error ?? '';
}

/**
 * 获取当前玩家的名字。
 */
export function currentPlayer(state: GameState): string {
  return state.currentPlayer;
}

/**
 * 获取下一个存活玩家名字（按 playerOrder）。
 */
export function nextAlivePlayer(state: GameState, afterPlayer: string): string {
  const alive = state.playerOrder.filter((n) => state.players[n].info.alive);
  const idx = alive.indexOf(afterPlayer);
  return alive[(idx + 1) % alive.length];
}
