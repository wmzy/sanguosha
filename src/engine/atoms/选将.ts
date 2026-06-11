// src/engine/atoms/选将.ts
// 游戏初始化 atoms:抽身份、选将、发牌
// 每个 atom 做一件事,符合三国杀身份局规则
import type { AtomDefinition, GameState } from '../types';
import { createRng } from '../../shared/rng';
import { createStandardDeck, shuffle } from '../../shared/deck';
import { registerAtom } from '../atom';

/** 默认通用技能列表 */
const DEFAULT_SKILLS = [
  '回合管理', '装备通用', '杀', '闪', '桃', '酒',
  '过河拆桥', '顺手牵羊', '无中生有', '桃园结义',
  '借刀杀人', '决斗', '南蛮入侵', '万箭齐发',
  '乐不思蜀', '无懈可击', '反馈',
];

/** 身份牌配置 */
const IDENTITY_COUNTS: Record<number, { 主公: number; 忠臣: number; 反贼: number; 内奸: number }> = {
  2: { 主公: 1, 忠臣: 0, 反贼: 1, 内奸: 0 },
  3: { 主公: 1, 忠臣: 0, 反贼: 1, 内奸: 1 },
  4: { 主公: 1, 忠臣: 1, 反贼: 1, 内奸: 1 },
  5: { 主公: 1, 忠臣: 1, 反贼: 2, 内奸: 1 },
  6: { 主公: 1, 忠臣: 1, 反贼: 3, 内奸: 1 },
  7: { 主公: 1, 忠臣: 2, 反贼: 3, 内奸: 1 },
  8: { 主公: 1, 忠臣: 2, 反贼: 4, 内奸: 1 },
};

// ── 抽身份 ──────────────────────────────────────────────
// 每人抽一张身份牌,主公亮明身份

export const 抽身份: AtomDefinition<{
  type: '抽身份';
  playerCount: number;
  seed: number;
}> = {
  type: '抽身份',
  validate: (state) => {
    if (state.players.length === 0) return '没有玩家';
    return null;
  },
  apply(state, atom) {
    const { playerCount, seed } = atom;
    const rng = createRng(seed);
    const counts = IDENTITY_COUNTS[playerCount];
    if (!counts) return state;

    // 构建身份牌堆
    const identities: string[] = [];
    for (const [role, count] of Object.entries(counts)) {
      for (let i = 0; i < count; i++) {
        identities.push(role);
      }
    }

    // 洗混身份牌
    for (let i = identities.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      const tmp = identities[i]; identities[i] = identities[j]; identities[j] = tmp;
    }

    // 分配身份,主公固定 0 号位
    const lordIndex = identities.indexOf('主公');
    if (lordIndex > 0) {
      identities[lordIndex] = identities[0];
      identities[0] = '主公';
    }

    // 更新玩家身份(存入 vars)
    const players = state.players.map((p, i) => ({
      ...p,
      vars: { ...p.vars, 身份: identities[i] || '未知' },
    }));

    return { ...state, players };
  },
};

// ── 选将 ──────────────────────────────────────────────
// 从武将池中随机分配武将给每个玩家
// 注:实际游戏中主公先选、其他人依次选,这里简化为随机分配

export const 选将: AtomDefinition<{
  type: '选将';
  characters: Array<{ name: string; skills: string[] }>;
  seed: number;
}> = {
  type: '选将',
  validate: (state) => {
    if (state.players.length === 0) return '没有玩家';
    return null;
  },
  apply(state, atom) {
    const { characters, seed } = atom;
    const rng = createRng(seed);
    const playerCount = state.players.length;

    // 打乱武将池
    const pool = [...characters];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }

    // 主公从池中选(取第一个),其他人依次分配
    const lord = pool.find(c => c.name === '主公');
    const others = pool.filter(c => c.name !== '主公');
    const selected = lord ? [lord, ...others.slice(0, playerCount - 1)] : others.slice(0, playerCount);

    // 更新玩家武将和技能
    const players = state.players.map((p, i) => {
      const char = selected[i];
      if (!char) return p;
      return {
        ...p,
        character: char.name,
        skills: [...char.skills, ...DEFAULT_SKILLS],
      };
    });

    return { ...state, players };
  },
};

// ── 洗牌 ──────────────────────────────────────────────
// 创建标准牌堆并用 seed 洗牌

export const 洗牌: AtomDefinition<{
  type: '洗牌';
  seed: number;
}> = {
  type: '洗牌',
  validate: () => null,
  apply(state, atom) {
    const rng = createRng(atom.seed);
    const allCards = shuffle(createStandardDeck(), rng);

    const cardMap: GameState['cardMap'] = {};
    const deckIds: string[] = [];
    for (const card of allCards) {
      cardMap[card.id] = card;
      deckIds.push(card.id);
    }

    return {
      ...state,
      cardMap,
      zones: { ...state.zones, deck: deckIds },
      rngSeed: atom.seed,
    };
  },
};

// ── 发牌 ──────────────────────────────────────────────
// 从牌堆顶给每个玩家发 handSize 张牌
// 主公多摸 1 张(三国杀规则)

export const 发牌: AtomDefinition<{
  type: '发牌';
  handSize: number;
  lordBonus?: number; // 主公额外摸牌数(默认 1)
}> = {
  type: '发牌',
  validate: (state) => {
    if (state.players.length === 0) return '没有玩家';
    if (state.zones.deck.length === 0) return '牌堆为空';
    return null;
  },
  apply(state, atom) {
    const { handSize, lordBonus = 1 } = atom;
    let cursor = 0;
    const players = state.players.map(p => {
      const isLord = p.vars.身份 === '主公';
      const bonus = isLord ? lordBonus : 0;
      const drawCount = handSize + bonus;
      const hand = [...p.hand, ...state.zones.deck.slice(cursor, cursor + drawCount)];
      cursor += drawCount;
      return { ...p, hand };
    });

    return {
      ...state,
      players,
      zones: { ...state.zones, deck: state.zones.deck.slice(cursor) },
    };
  },
};

registerAtom(抽身份);
registerAtom(选将);
registerAtom(洗牌);
registerAtom(发牌);
