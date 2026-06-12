// src/engine/skills/开局.ts
// 开局技能:按三国杀身份局规则初始化游戏
// 1. 抽身份 → 2. 选将 → 3. 洗牌 → 4. 发牌 → 5. 启动第一回合
import type { BackendAPI, EngineApi, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

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

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'start',
    () => null,
    async (api: EngineApi) => {
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
  );
  return () => {};
}

export const module_开局: SkillModule = { createSkill, onInit };
registerSkillModule('开局', module_开局);
