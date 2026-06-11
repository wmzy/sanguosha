// src/engine/game-setup.ts
// 游戏开局:抽角色、洗牌、发牌
// 由引擎管理,session 只提供配置
import type { GameState } from './types';
import { createGameState } from './types';
import { createRng } from '../shared/rng';
import { createStandardDeck, shuffle } from '../shared/deck';

/** 开局配置 */
export interface GameSetupConfig {
  /** 可用角色列表 */
  characters: Array<{ name: string; skills: string[] }>;
  /** 玩家数量 */
  playerCount: number;
  /** 随机种子 */
  seed: number;
  /** 每人初始手牌数(默认 4) */
  handSize?: number;
  /** 游戏 ID */
  gameId?: string;
}

/** 默认通用技能列表 */
const DEFAULT_SKILLS = [
  '回合管理', '装备通用', '杀', '闪', '桃', '酒',
  '过河拆桥', '顺手牵羊', '无中生有', '桃园结义',
  '借刀杀人', '决斗', '南蛮入侵', '万箭齐发',
  '乐不思蜀', '无懈可击', '反馈',
];

/**
 * 创建初始游戏状态。
 * 抽角色(主公固定 0 号位,其余随机)、洗牌、发牌。
 */
export function createInitialState(config: GameSetupConfig): GameState {
  const { characters, playerCount, seed, handSize = 4, gameId = '' } = config;
  const rng = createRng(seed);

  // 1. 抽角色:主公固定 0 号位,其余随机
  const lord = characters.find(c => c.name === '主公');
  const others = characters.filter(c => c.name !== '主公');
  for (let i = others.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = others[i]; others[i] = others[j]; others[j] = tmp;
  }
  const selected = lord ? [lord, ...others.slice(0, playerCount - 1)] : others.slice(0, playerCount);

  // 2. 创建并洗牌
  const allCards = shuffle(createStandardDeck(), rng);
  const cardMap: GameState['cardMap'] = {};
  const deckIds: string[] = [];
  for (const card of allCards) {
    cardMap[card.id] = card;
    deckIds.push(card.id);
  }

  // 3. 发初始手牌
  let cursor = 0;
  const players = selected.map((char, i) => {
    const hand = deckIds.slice(cursor, cursor + handSize);
    cursor += handSize;
    return {
      index: i,
      name: char.name,
      character: char.name,
      health: 4,
      maxHealth: 4,
      alive: true,
      hand,
      equipment: {},
      skills: [...char.skills, ...DEFAULT_SKILLS],
      vars: {},
      marks: [],
      pendingTricks: [],
      judgeZone: [],
    };
  });

  return createGameState({
    players,
    cardMap,
    zones: { deck: deckIds.slice(cursor), discardPile: [], processing: [] },
    rngSeed: seed,
    meta: { gameId, createdAt: Date.now() },
  });
}
