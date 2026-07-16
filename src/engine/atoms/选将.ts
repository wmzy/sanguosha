// src/engine/atoms/选将.ts
// 游戏初始化 atoms:抽身份、选将、发牌
// 每个 atom 做一件事,符合三国杀身份局规则
// src/engine/atoms/选将.ts
// 游戏初始化 atoms:抽身份、选将、发牌
// 每个 atom 做一件事,符合三国杀身份局规则
import type {
  ActionPrompt,
  AtomDefinition,
  Card,
  PlayerState,
  ViewEvent,
  ViewEventSplit,
} from '../types';
import { TARGET_SYSTEM } from '../types';
import { createRng } from '../../shared/rng';
import { createStandardDeck, shuffle } from '../../shared/deck';
import { applyAtom, resolveTimeoutMs } from '../create-engine';
import { registerAtom } from '../atom';

/** 默认通用技能列表 */
export const DEFAULT_SKILLS = [
  '回合管理',
  '装备通用',
  '杀',
  '闪',
  '桃',
  '酒',
  '过河拆桥',
  '顺手牵羊',
  '无中生有',
  '桃园结义',
  '五谷丰登',
  '借刀杀人',
  '决斗',
  '南蛮入侵',
  '万箭齐发',
  '乐不思蜀',
  '兵粮寸断',
  '闪电',
  '无懈可击',
  '铁索连环',
  '火攻',
];

/** 身份牌配置 */
const IDENTITY_COUNTS: Record<number, { 主公: number; 忠臣: number; 反贼: number; 内奸: number }> =
  {
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
  validate: (state, atom) => {
    if (state.players.length === 0) return '没有玩家';
    if (!IDENTITY_COUNTS[atom.playerCount]) return `不支持的玩家数量: ${atom.playerCount}`;
    return null;
  },
  apply(state, atom) {
    const { playerCount, seed } = atom;
    const rng = createRng(seed);
    const counts = IDENTITY_COUNTS[playerCount];

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
      const tmp = identities[i];
      identities[i] = identities[j];
      identities[j] = tmp;
    }

    // 分配身份,主公固定 0 号位
    const lordIndex = identities.indexOf('主公');
    if (lordIndex > 0) {
      identities[lordIndex] = identities[0];
      identities[0] = '主公';
    }

    // 更新玩家身份(单一来源:identity 字段)
    for (let i = 0; i < state.players.length; i++) {
      const id = identities[i] || '未知';
      state.players[i].identity = id as PlayerState['identity'];
    }
  },
};

// ── 初始化洗牌 ──────────────────────────────────────────
// 创建标准牌堆并用 seed 洗牌(仅在开局时使用)

export const 初始化洗牌: AtomDefinition<{
  type: '初始化洗牌';
  seed: number;
}> = {
  type: '初始化洗牌',
  validate: () => null,
  apply(state, atom) {
    const rng = createRng(atom.seed);
    const allCards = shuffle(createStandardDeck(), rng);

    // 原地替换 cardMap 条目,而非 state.cardMap = {} 创建新对象——
    // 视图可能持有旧 cardMap 引用,换引用会导致视图的 cardMap 永远为空,
    // 后续 applyView 的 移动牌 通用 fallback 查不到卡牌对象(handCount++
    // 但卡不加入 hand[],引起手牌数不一致)。
    const keys = Object.keys(state.cardMap);
    for (const key of keys) delete state.cardMap[key];
    for (const card of allCards) state.cardMap[card.id] = card;

    state.zones.deck.length = 0;
    for (const card of allCards) state.zones.deck.push(card.id);
    state.rngSeed = atom.seed;
  },
  toViewEvents(): ViewEventSplit {
    // 牌堆从空变为标准牌堆总数。cardMap 内容不变(createStandardDeck 确定性创建,
    // apply 只是先删后加同样的卡),不需要增量更新 cardMap——只需同步 deckCount。
    // 缺少 applyView 时,前端增量视图在选将阶段牌堆数停留在 initialView 时的 0。
    return {
      ownerViews: new Map(),
      othersView: { type: '初始化洗牌', deckCount: createStandardDeck().length },
    };
  },
  applyView(view, event) {
    if (view.zones) {
      view.zones.deckCount = (event.deckCount as number) ?? view.zones.deckCount;
    }
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
    for (const p of state.players) {
      const isLord = p.identity === '主公';
      const bonus = isLord ? lordBonus : 0;
      const drawCount = handSize + bonus;
      const drawn = state.zones.deck.slice(cursor, cursor + drawCount);
      p.hand.push(...drawn);
      cursor += drawCount;
    }
    state.zones.deck = state.zones.deck.slice(cursor);
  },
  toViewEvents(state, atom): ViewEventSplit {
    const { handSize, lordBonus = 1 } = atom;
    // 每个玩家收到自己分到的牌面(ownerView);其他人只看到数量信息(othersView)。
    const ownerViews = new Map<number, ViewEvent>();
    let cursor = 0;
    for (const p of state.players) {
      const isLord = p.identity === '主公';
      const bonus = isLord ? lordBonus : 0;
      const drawCount = handSize + bonus;
      const cards = state.zones.deck
        .slice(cursor, cursor + drawCount)
        .map((id) => state.cardMap[id])
        .filter(Boolean);
      cursor += drawCount;
      ownerViews.set(p.index, {
        type: '发牌',
        handSize,
        lordBonus,
        cards,
      });
    }
    const othersView: ViewEvent = { type: '发牌', handSize, lordBonus };
    return { ownerViews, othersView };
  },
  applyView(view, event) {
    const handSize = (event.handSize as number) ?? 4;
    const lordBonus = (event.lordBonus as number) ?? 1;
    for (const p of view.players) {
      const isLord = p.identity === '主公';
      const bonus = isLord ? lordBonus : 0;
      p.handCount += handSize + bonus;
      // ownerView 携带自己分到的 cards,加入手牌;othersView 无 cards 字段
      if (event.cards && p.hand) {
        p.hand.push(...(event.cards as Card[]));
      }
    }
    // 牌堆减少(粗略:减去总发牌数)
    const total = view.players.reduce((sum, p) => {
      const isLord = p.identity === '主公';
      return sum + handSize + (isLord ? lordBonus : 0);
    }, 0);
    if (view.zones) view.zones.deckCount = Math.max(0, view.zones.deckCount - total);
  },
};

registerAtom(抽身份);
registerAtom(初始化洗牌);
registerAtom(发牌);

// 选将询问(交互式选将)
// 等待型 atom:给目标玩家展示候选人,等待选择。
// 开局.execute 依次为每个玩家 applyAtom(选将询问)。
// 候选人列表存在 atom.candidates 字段,前端从 view.pending.atom.candidates 渲染。
// respond action(系统规则:respond, requestType='__选将') 读取玩家选择并分配武将。
export const 选将询问: AtomDefinition<{
  type: '选将询问';
  target: number;
  candidates: Array<{ name: string; skills: string[] }>;
  prompt?: ActionPrompt;
}> = {
  type: '选将询问',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    if (!Array.isArray(atom.candidates) || atom.candidates.length === 0)
      return 'candidates required';
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  toViewEvents(state, atom) {
    const target = atom.target;
    const candidates = atom.candidates;
    const timeoutMs = resolveTimeoutMs(state, 60);
    // 主公(被问询者)看到候选人列表
    const ownerView: import('../types').ViewEvent = {
      type: '选将询问',
      target,
      candidates,
      timeoutMs,
      pending: {
        startTime: Date.now(),
        deadline: Date.now() + timeoutMs,
        prompt: { type: 'chooseCharacter', title: '请选择武将', candidates },
      },
    };
    // 其他人看到"等待主公选将"
    const othersView: import('../types').ViewEvent = {
      type: '等待选将',
      waitingFor: target,
      waitingForName: '主公',
    };
    return {
      ownerViews: new Map([[target, ownerView]]),
      othersView,
    };
  },
  applyView(view, event) {
    const target = event.target as number;
    const candidates = (event.candidates ?? []) as Array<{ name: string; skills: string[] }>;
    const timeoutMs = (event.timeoutMs as number | undefined) ?? 60000;
    // 只有被问询的玩家才设置 pending
    if (view.viewer === target) {
      view.pending = {
        type: 'awaits',
        atom: { type: '选将询问', target, candidates } as unknown as import('../types').Atom,
        prompt: {
          type: 'chooseCharacter',
          title: '请选择武将',
          candidates,
        } as import('../types').ActionPrompt,
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    }
  },
  pending: {
    // 选将超时:从候选人中随机分配一个未被选走的武将(确定性:用 state.seq 做种子)。
    // 否则玩家超时未选 → character 空 → 游戏带空武将进入出牌阶段(不可玩)。
    // 并行选将被引擎拆成多个 选将询问 slot,超时也走这里。
    async onTimeout(state, atom) {
      const target = atom.target;
      const p = state.players[target];
      if (!p || p.character) return;
      const candidates = atom.candidates;
      const taken = new Set(state.players.map((pl) => pl.character));
      const available = candidates.filter((c) => !taken.has(c.name));
      const pool = available.length > 0 ? available : candidates;
      // 用 state.seq 做种子:单调递增,对同一局游戏确定性可复现
      const rng = createRng(state.seq ^ (target * 2654435761));
      const pick = pool[rng.nextInt(pool.length)];
      await applyAtom(state, {
        type: '分配武将',
        target,
        character: pick.name,
        skills: [...DEFAULT_SKILLS, ...pick.skills],
      });
    },
    prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
    timeout: 60,
  },
  effect: { blockUntilDone: true, duration: 200 },
};

registerAtom(选将询问);

// ── 并行选将(交互式,多人同时选)──────────────────────
// 等待型 atom:给多个目标玩家同时展示各自的候选人,各自独立选择、独立 resolve。
// 全部 resolve 后父 applyAtom 的 Promise 才 resolve(语义同 Promise.all)。
//
// 与 串行选将询问 的区别:主公先选(串行)后,其余人同时选(并行),加快开局。
// 引擎管线(create-engine.ts)把它拆成多个单 target 的 选将询问 slot,各 slot 独立 pending。
// respond action(系统规则:选将)按 slot.atom.target 精确匹配,与串行路径完全一致。
export const 并行选将: AtomDefinition<{
  type: '并行选将';
  selections: Array<{ target: number; candidates: Array<{ name: string; skills: string[] }> }>;
}> = {
  type: '并行选将',
  validate(state, atom) {
    if (!Array.isArray(atom.selections) || atom.selections.length === 0)
      return 'selections required';
    for (const s of atom.selections) {
      if (!state.players[s.target]) return `target ${s.target} not found`;
      if (!Array.isArray(s.candidates) || s.candidates.length === 0)
        return `candidates required for target ${s.target}`;
    }
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  toViewEvents(state, atom) {
    const selections = atom.selections;
    const timeoutMs = resolveTimeoutMs(state, 60);
    // 找主公已选的角色(主公在并行选将之前已完成选将)
    const lordIdx = state.players.findIndex((p) => p.identity === '主公');
    const lordCharacter = lordIdx >= 0 ? state.players[lordIdx].character : '';
    const lordName = lordIdx >= 0 ? state.players[lordIdx].name : '';
    // ownerViews:每个目标玩家看到自己的候选人 + 主公已选角色
    const ownerViews = new Map<number, import('../types').ViewEvent>();
    for (const s of selections) {
      ownerViews.set(s.target, {
        type: '并行选将',
        selections: selections.map((sel) => ({ target: sel.target, candidates: sel.candidates })),
        lordCharacter,
        lordName,
        timeoutMs,
        pending: {
          startTime: Date.now(),
          deadline: Date.now() + timeoutMs,
          prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: s.candidates },
        },
      });
    }
    // othersView:已选完的玩家(如主公)看到"等待其他玩家选将"
    const othersView: import('../types').ViewEvent = {
      type: '等待选将',
      waitingFor: TARGET_SYSTEM,
      waitingForName: '其他玩家',
      lordCharacter,
      lordName,
    };
    return { ownerViews, othersView };
  },
  applyView(view, event) {
    const selections = (event.selections ?? []) as Array<{
      target: number;
      candidates: Array<{ name: string; skills: string[] }>;
    }>;
    const lordCharacter = (event.lordCharacter as string) ?? '';
    const lordName = (event.lordName as string) ?? '';
    // 更新主公角色(如果 view 中主公还是空的)
    if (lordCharacter) {
      const lordPlayer = view.players.find((p) => p.identity === '主公');
      if (lordPlayer && !lordPlayer.character) {
        lordPlayer.character = lordCharacter;
        lordPlayer.name = lordName || lordCharacter;
      }
    }
    // 找当前 viewer 是否在 selections 中
    const mySelection = selections.find((s) => s.target === view.viewer);
    if (mySelection) {
      const timeoutMs = (event.timeoutMs as number | undefined) ?? 60000;
      view.pending = {
        type: 'awaits',
        atom: {
          type: '选将询问',
          target: mySelection.target,
          candidates: mySelection.candidates,
        } as unknown as import('../types').Atom,
        prompt: {
          type: 'chooseCharacter',
          title: '请选择武将',
          candidates: mySelection.candidates,
        } as import('../types').ActionPrompt,
        target: mySelection.target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    }
  },
  pending: {
    // 超时:无操作。并行选将拆成多个单-target 选将询问 slot,各 slot 用选将询问的 onTimeout
    onTimeout: async () => {},
    prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
    timeout: 60,
  },
  // 并行选将拆成多个单-target 选将询问 slot,各 target 独立选择、独立 resolve
  parallelSplit(atom) {
    return atom.selections.map((s) => ({
      target: s.target,
      slotAtom: { type: '选将询问' as const, target: s.target, candidates: s.candidates },
    }));
  },
  effect: { blockUntilDone: true, duration: 200 },
};

registerAtom(并行选将);
