// src/engine/skills/开局.ts
// 开局系统技能:按三国杀身份局规则初始化游戏
// 1. 抽身份 → 2. 选将 → 3. 洗牌 → 4. 发牌 → 5. 启动第一回合
//
// 这是 system skill(非玩家技能),由 create-engine.bootstrap() 手动调用 onInit,
// onInit 接受 (skill, gameState) 而非 BackendAPI,registerActionEntry / unregisterActionEntry
// 直接从 skill.ts 模块导入。
import type { ActionEntry, EngineApi, GameState, Skill } from '../types';
import {
  registerActionEntry,
  unregisterActionEntry,
  type SkillModule,
} from '../skill';
import { registerSkillModule } from '../skill';

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

export function createSkill(id: string, ownerId: string): Skill {
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
    ownerId: '主公',
    actionType: 'start',
    validate: () => null,
    execute: async (api: EngineApi) => {
      const config = api.params as unknown as GameConfig;
      const { characters, playerCount, seed, handSize = 4 } = config;

      // 1. 抽身份(每人一张,主公亮明)
      await api.apply({ type: '抽身份', playerCount, seed });

      // 2. 选将(从武将池分配)
      await api.apply({ type: '选将', characters, seed });

      // 3. 初始化洗牌(创建标准牌堆并洗混)
      await api.apply({ type: '初始化洗牌', seed });

      // 4. 发牌(主公多摸 1 张)
      await api.apply({ type: '发牌', handSize, lordBonus: 1 });

      // 5. 启动第一回合(从主公开始)
      const state = api.state;
      const lord = state.players.find(p => p.vars.身份 === '主公');
      if (lord) {
        await api.apply({ type: '回合开始', player: lord.name });
        await api.apply({ type: '阶段开始', player: lord.name, phase: '准备' });
      }
    },
  };
  registerActionEntry(entry);
  return () => unregisterActionEntry('开局', '主公', 'start');
}

// module_开局 不再走 SkillModule.onInit 路径 —— bootstrap() 直接调顶层 onInit。
// 这里只暴露 createSkill 让 SkillModule 注册表能找到这个模块(其他代码可能仍按
// SkillModule 接口查询),并保留 registerSkillModule 副作用以维持向后兼容。
export const module_开局: SkillModule = { createSkill };
registerSkillModule('开局', module_开局);
