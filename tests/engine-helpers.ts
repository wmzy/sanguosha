import { createInitialState } from '@engine/state';
import type { GameState, GameAction } from '@engine/types';
import type { CharacterConfig } from '@shared/types';
import { allCharacters } from '@shared/characters';
import { safeEngine } from './invariants';
import { createEngine } from '@engine/create-engine';
import type { EngineInstance } from '@engine/create-engine';
import { allSkills } from '@engine/skills';

/** 创建测试用引擎实例（加载所有技能） */
export function createTestEngine(): EngineInstance {
  return createEngine({ skills: allSkills });
}

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
  /** 覆盖指定玩家的手牌（cardId 列表）。未列出的玩家清空手牌。 */
  hand?: Record<string, string[]>;
  /** 覆盖牌堆内容（cardId 列表）。cardMap 中不存在的 ID 会自动以占位 Card 注入。 */
  deck?: string[];
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
      role: roles[i % roles.length],
    })),
    seed,
    characterMap,
  };

  let state = createInitialState(config);

  // 如果需要出牌阶段
  if (opts.playPhase) {
    state = { ...state, phase: '出牌' };
  }

  // 覆盖手牌（如有指定玩家）：未列出的玩家手牌置空，便于断言精确手牌数
  if (opts.hand) {
    const players = { ...state.players };
    for (const name of state.playerOrder) {
      const hand = opts.hand[name];
      players[name] = { ...players[name], hand: hand ? [...hand] : [] };
    }
    state = { ...state, players };
  }

  // 覆盖牌堆（如有指定）
  if (opts.deck) {
    const cardMap = { ...state.cardMap };
    for (const id of opts.deck) {
      if (!cardMap[id]) {
        cardMap[id] = {
          id,
          name: id,
          type: '基本牌',
          subtype: '杀',
          suit: '♠',
          rank: 'A',
          description: '',
        };
      }
    }
    state = {
      ...state,
      zones: { ...state.zones, deck: [...opts.deck] },
      cardMap,
    };
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

/**
 * 让所有 responder 依次 pass 过 trickResponse 窗口。
 * 返回所有 pass 完成后的 GameState。
 */
export function passAllTrickResponders(state: GameState): GameState {
  let current = state;
  while (current.pending?.type === '响应窗口' && current.pending.window.type === 'trickResponse') {
    const window_ = current.pending.window;
    const passed = window_.passedResponders ?? [];
    const active = (window_.responders ?? []).filter(p => !passed.includes(p));
    if (active.length === 0) break;
    const next = active[0];
    const result = safeEngine(current, { type: '打出', player: next });
    if (result.error) break;
    current = result.state;
  }
  return current;
}

/**
 * 给玩家装备指定 防具（写入 equipment.防具）。仅在测试 setup 中使用。
 */
export function withArmor(state: GameState, playerName: string, armorId: string): GameState {
  const player = state.players[playerName];
  return {
    ...state,
    players: {
      ...state.players,
      [playerName]: { ...player, equipment: { ...player.equipment, 防具: armorId } },
    },
  };
}
/**
/**
 * 给玩家装备指定 武器（写入 equipment.武器）。仅在测试 setup 中使用。
 */
export function withWeapon(state: GameState, playerName: string, weaponId: string): GameState {
  const player = state.players[playerName];
  return {
    ...state,
    players: {
      ...state.players,
      [playerName]: { ...player, equipment: { ...player.equipment, 武器: weaponId } },
    },
  };
}
/**
 * 给玩家设置手牌（写入 hand）。仅在测试 setup 中使用。
 */
export function withHand(state: GameState, playerName: string, cardIds: string[]): GameState {
  const player = state.players[playerName];
  return {
    ...state,
    players: {
      ...state.players,
      [playerName]: { ...player, hand: [...cardIds] },
    },
  };
}

/**
 * 给玩家设置装备（写入 equipment）。仅在测试 setup 中使用。
 * 接受 EquipSlot→cardId 映射，合并到现有 equipment。
 */
export function withEquipment(
  state: GameState,
  playerName: string,
  equipment: { 武器?: string; 防具?: string; 防御马?: string; 进攻马?: string },
): GameState {
  const player = state.players[playerName];
  return {
    ...state,
    players: {
      ...state.players,
      [playerName]: { ...player, equipment: { ...player.equipment, ...equipment } },
    },
  };
}
