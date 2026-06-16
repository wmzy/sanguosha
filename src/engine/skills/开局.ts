// 开局(系统级):开局流程。由 create-engine.bootstrap() 在游戏开始时调用。
//   start action:抽身份 → 选将 → 初始化洗牌 → 发牌(lordBonus=1) → 回合开始(主公) → 阶段开始(主公,准备)
import type { ActionEntry, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import {
  registerActionEntry,
  unregisterActionEntry,
  instantiateSkill,
  type SkillModule,
} from '../skill';

/**
 * system 命名空间占位 ownerId(座次下标 -1,不对应任何玩家槽位)。
 * 客户端永远不发这个值(WS handler 注入的 ownerId 是绑定玩家名),
 * engine 内部 dispatch 只在 bootstrap 路径用到它。
 */
const SYSTEM_OWNER = -1;

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

export function onInit(_skill: Skill, _state: GameState): () => void {
  const entry: ActionEntry = {
    skillId: '开局',
    ownerId: SYSTEM_OWNER,
    actionType: 'start',
    validate: (_state: GameState, _params: Record<string, Json>) => null,
    execute: async (state: GameState, params: Record<string, Json>) => {
      const config = params as unknown as GameConfig;
      const { characters, playerCount, seed, handSize = 4 } = config;

      // 1. 抽身份(每人一张,主公亮明)
      await applyAtom(state, { type: '抽身份', playerCount, seed });

      // 2. 选将(从武将池分配)
      await applyAtom(state, { type: '选将', characters, seed });

      // 2.5 注册技能实例(回合管理等默认技能)——必须在阶段推进前注册
      //     选将 已设置 player.skills,但技能实例需要 registerSkillsFromState 实例化
      for (const player of state.players) {
        for (const skillId of player.skills) {
          await instantiateSkill(skillId, player.index);
        }
      }

      // 3. 初始化洗牌(创建标准牌堆并洗混)
      await applyAtom(state, { type: '初始化洗牌', seed });

      // 4. 发牌(主公多摸 1 张)
      await applyAtom(state, { type: '发牌', handSize, lordBonus: 1 });

      // 5. 启动第一回合(从主公开始)
      const lord = state.players.find(p => p.vars.身份 === '主公');
      if (lord) {
        await applyAtom(state, { type: '回合开始', player: lord.index });
        await applyAtom(state, { type: '阶段开始', player: lord.index, phase: '准备' });
        // 触发阶段结束,让回合管理的阶段推进钩子接着跑(准备→判定→摸牌→出牌)
        await applyAtom(state, { type: '阶段结束', player: lord.index, phase: '准备' });
      }
    },
  };
  registerActionEntry(entry);
  return () => unregisterActionEntry('开局', SYSTEM_OWNER, 'start');
}

// module_开局 不再走 SkillModule.onInit 路径 —— bootstrap() 直接调顶层 onInit。
// 这里只暴露 createSkill 让 SkillModule 注册表能找到这个模块(其他代码可能仍按
// SkillModule 接口查询),不再需要 registerSkillModule 注册。
