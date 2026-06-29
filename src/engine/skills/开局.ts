// 开局(系统级):开局流程。由 create-engine.bootstrap() 在游戏开始时调用。
//   start action:抽身份 → 选将 → 初始化洗牌 → 发牌(lordBonus=1) → 回合开始(主公) → 阶段开始(主公,准备)
import type { ActionEntry, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { createRng } from '../../shared/rng';
import { registerActionEntry, unregisterActionEntry, instantiateSkill } from '../skill';

import { isLord } from '../character-meta';

/**
 * system 命名空间占位 ownerId(座次下标 -1,不对应任何玩家槽位)。
 * 客户端永远不发这个值(WS handler 注入的 ownerId 是绑定玩家名),
 * engine 内部 dispatch 只在 bootstrap 路径用到它。
 */
const SYSTEM_OWNER = -1;

/** 按身份发放的候选武将数量(三国杀OL身份模式标准)。
 *  主公:常备主公 + 非常备主公共 7 个候选位置;
 *  忠臣/内奸:比普通玩家多 1 个,即 5 个;
 *  反贼:基础 4 个。 */
const CANDIDATES_PER_IDENTITY: Record<string, number> = {
  主公: 7,
  忠臣: 5,
  反贼: 4,
  内奸: 5,
};

/** 主公候选的拆分:从常备主公池随机取 5,从非常备池随机取 2,合并为 7 张候选人。
 *  当池不足时按"先常备后非常备、不重复"补到 7,仍不够则给全部。 */
const CANDIDATES_LORD = 5;
const CANDIDATES_NON_LORD = 2;

/** 从已打乱的 charPool 中拆分主公候选:常备 5 + 非常备 2(总 7)。
 *  - charPool 需为 seed 打乱后的顺序,取前 N 即随机抽取。
 *  - isLord 判断走 character-meta.isLord,适用于任何数据来源的武将名。
 *  - 兑底:常备 < 5 时,用非常备补足到 7;总数仍不足则给现有全部。 */
function pickLordCandidates(
  charPool: Array<{ name: string; skills: string[] }>,
): Array<{ name: string; skills: string[] }> {
  const target = CANDIDATES_PER_IDENTITY['主公']; // 7
  const lordPicked: Array<{ name: string; skills: string[] }> = [];
  const nonLordPicked: Array<{ name: string; skills: string[] }> = [];
  for (const c of charPool) {
    if (lordPicked.length >= CANDIDATES_LORD && nonLordPicked.length >= CANDIDATES_NON_LORD) break;
    if (isLord(c.name)) {
      if (lordPicked.length < CANDIDATES_LORD) lordPicked.push(c);
    } else {
      if (nonLordPicked.length < CANDIDATES_NON_LORD) nonLordPicked.push(c);
    }
  }
  const result = [...lordPicked, ...nonLordPicked];
  // 兑底:常备不足 5 时,用非常备补足
  if (result.length < target) {
    const used = new Set(result.map((c) => c.name));
    for (const c of charPool) {
      if (result.length >= target) break;
      if (used.has(c.name)) continue;
      used.add(c.name);
      result.push(c);
    }
  }
  return result;
}

/** 开局配置 */
interface GameConfig {
  /** 可用武将列表 */
  characters: Array<{ name: string; skills: string[] }>;
  /** 玩家数量 */
  playerCount: number;
  /** 随机种子 */
  seed: number;
  /** 每人初始手牌数(默认 4) */
  handSize?: number;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '开局',
    description: '游戏开局:抽身份、选将、洗牌、发牌、启动第一回合',
  };
}

export function onInit(_skill: Skill, state: GameState): () => void {
  const entry: ActionEntry = {
    skillId: '开局',
    ownerId: SYSTEM_OWNER,
    actionType: 'start',
    validate: (state: GameState, params: Record<string, Json>) => {
      const config = params as unknown as GameConfig;
      if (config.playerCount < 2) return '至少需要2名玩家';
      return null;
    },
    execute: async (state: GameState, params: Record<string, Json>) => {
      const config = params as unknown as GameConfig;
      const { characters, playerCount, seed, handSize = 4 } = config;

      // 1. 抽身份(每人一张,主公亮明)
      await applyAtom(state, { type: '抽身份', playerCount, seed });

      // 2. 选将(交互式):主公先选(串行),然后其他人同时选(并行)
      //    候选人按身份发放数量(见 CANDIDATES_PER_IDENTITY)。
      const charRng = createRng(seed + 1);
      const charPool = [...characters].filter((c) => c.name !== '主公');
      // 打乱武将池(主公选将与此后候选池抽取都从这个打乱后的序列里取)
      for (let i = charPool.length - 1; i > 0; i--) {
        const j = charRng.nextInt(i + 1);
        const tmp = charPool[i];
        charPool[i] = charPool[j];
        charPool[j] = tmp;
      }
      const lordIdx = state.players.findIndex((p) => p.identity === '主公');

      // 2a. 主公先选(串行):从池中按 isLord 拆成常备/非常备两组,合并为 7 张候选人。
      //     拆分:常备主公随机 5 + 非常备随机 2(charPool 已 seed 打乱,取前 N 即随机)。
      //     池不足时:常备不足用非常备补足,总数仍不足则给现有全部。
      //     主公选完后,池中【未被选中】的武将全部进入候选池,供其他身份玩家分配。
      const used = new Set<string>();
      if (lordIdx >= 0) {
        const lordAvail = pickLordCandidates(charPool);
        if (lordAvail.length > 0) {
          await applyAtom(state, { type: '选将询问', target: lordIdx, candidates: lordAvail });
          const lordChosen = state.players[lordIdx].character;
          if (lordChosen) used.add(lordChosen);
        }
      }

      // 2b. 其他人并行选:从【候选池=主公未选的剩余武将】随机抽,按身份发候选数张。
      //     候选池必须覆盖所有人的需求——池不足时报错（不允许共享候选以避免 data race）。
      const others = state.players.map((_, i) => i).filter((i) => i !== lordIdx);
      if (others.length > 0) {
        // 候选池:主公未选的全部武将(顺序即打乱后顺序,等价于随机)
        const candidatePool = charPool.filter((c) => !used.has(c.name));
        const wantByPlayer = others.map((idx) => {
          const identity = state.players[idx].identity;
          return CANDIDATES_PER_IDENTITY[identity ?? ''] ?? CANDIDATES_PER_IDENTITY['反贼'];
        });
        const totalWant = wantByPlayer.reduce((a, b) => a + b, 0);
        if (candidatePool.length < totalWant) {
          throw new Error(
            `武将池不足: 需要 ${totalWant} 个候选提供给非主公玩家，当前池中只有 ${candidatePool.length} 个`,
          );
        }

        const selections: Array<{
          target: number;
          candidates: Array<{ name: string; skills: string[] }>;
        }> = [];
        const allocated = new Set<string>(used);
        for (let k = 0; k < others.length; k++) {
          const want = wantByPlayer[k];
          const cand = candidatePool.filter((c) => !allocated.has(c.name)).slice(0, want);
          for (const c of cand) allocated.add(c.name);
          selections.push({ target: others[k], candidates: cand });
        }
        if (selections.length > 0) {
          await applyAtom(state, { type: '并行选将', selections });
          for (const idx of others) {
            const chosen = state.players[idx]?.character;
            if (chosen) used.add(chosen);
          }
        }
      }

      // 2.5 注册技能实例(回合管理等默认技能)——必须在阶段推进前注册
      //     选将 已设置 player.skills,但技能实例需要 registerSkillsFromState 实例化
      for (const player of state.players) {
        for (const skillId of player.skills) {
          await instantiateSkill(state, skillId, player.index);
        }
      }

      // 3. 初始化洗牌(创建标准牌堆并洗混)
      await applyAtom(state, { type: '初始化洗牌', seed });

      // 4. 发牌(主公多摸 1 张)
      await applyAtom(state, { type: '发牌', handSize, lordBonus: 1 });

      // 5. 启动第一回合(从主公开始)
      const lord = state.players.find((p) => p.identity === '主公');
      if (lord) {
        await applyAtom(state, { type: '回合开始', player: lord.index });
        await applyAtom(state, { type: '阶段开始', player: lord.index, phase: '准备' });
        // 触发阶段结束,让回合管理的阶段推进钩子接着跑(准备→判定→摸牌→出牌)
        await applyAtom(state, { type: '阶段结束', player: lord.index, phase: '准备' });
      }
    },
  };
  registerActionEntry(state, entry);
  return () => unregisterActionEntry(state, '开局', SYSTEM_OWNER, 'start');
}

// module_开局 不再走 SkillModule.onInit 路径 —— bootstrap() 直接调顶层 onInit。
// 这里只暴露 createSkill 让 SkillModule 注册表能找到这个模块(其他代码可能仍按
// SkillModule 接口查询),不再需要 registerSkillModule 注册。
