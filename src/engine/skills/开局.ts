// src/engine/skills/开局.ts
// ============================================================
// 技能描述(系统级):
//   开局流程,由 create-engine.bootstrap() 在游戏开始时调用 onInit 注册。
//   非玩家技能,owner='系统'(占位符)。
//
// 关键原子操作(start action):
//   抽身份 → 选将 → 初始化洗牌 → 发牌(lordBonus=1) → 回合开始(主公) → 阶段开始(主公,准备)
//
// 关键时机:
//   - 由 create-engine.bootstrap() 手动调用 onInit(签名特殊:(skill, GameState))
//   - 唯一由"系统"ownerId 触发的 action,客户端永远不发此消息
//
// 已知问题/不完整实现:
//   1. **system ownerId 占位符易冲突**:`SYSTEM_OWNER = '系统'`,
//      若有玩家昵称叫"系统"会与 dispatch 路由冲突——应使用不可冲突的保留前缀(如 '__system__')。
//   2. **主公定位脆弱**:第 67 行通过 `vars.身份 === '主公'` 找主公,
//      若"抽身份" atom 实现没写入 vars.身份(项目可能改名为 '主公标志' 或别的 key),
//      lord 为 undefined → 首回合根本不会启动(无错误提示,游戏卡住)。
//   3. **选将不交互**:`选将` atom 直接传入 characters 配置,
//      标准三国杀身份局是"主公先选,反贼/忠臣再选"的多轮交互;
//      当前是一次性分配,缺玩家选择 UI。
//   4. **缺少阶段链初始化**:启动主公回合后只触发了 准备 阶段开始,
//      没有 "阶段结束(准备)" 来让 回合管理 的 hook 推进——
//      实际是否能进入摸牌阶段依赖 回合管理.ts 是否正确监听首阶段。
//   5. **不可中途重新开局**:onInit 使用闭包注册,
//      第二次 start 调用会因 registerActionEntry 重复抛错(全靠 instantiateSkill 的幂等卸载保护)。
//   6. handSize 默认 4 — 标准三国杀正确,但写死 lordBonus=1,
//      若引入"军争篇"等扩展(主公多得多张牌或不加)需要改源码。
// ============================================================
import type { ActionEntry, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import {
  registerActionEntry,
  unregisterActionEntry,
  type SkillModule,
} from '../skill';

/**
 * system 命名空间占位 ownerId。
 * 客户端永远不发这个值(WS handler 注入的 ownerId 是绑定玩家名),
 * engine 内部 dispatch 只在 bootstrap 路径用到它。
 */
const SYSTEM_OWNER = '系统';

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

      // 3. 初始化洗牌(创建标准牌堆并洗混)
      await applyAtom(state, { type: '初始化洗牌', seed });

      // 4. 发牌(主公多摸 1 张)
      await applyAtom(state, { type: '发牌', handSize, lordBonus: 1 });

      // 5. 启动第一回合(从主公开始)
      const lord = state.players.find(p => p.vars.身份 === '主公');
      if (lord) {
        await applyAtom(state, { type: '回合开始', player: lord.name });
        await applyAtom(state, { type: '阶段开始', player: lord.name, phase: '准备' });
      }
    },
  };
  registerActionEntry(entry);
  return () => unregisterActionEntry('开局', SYSTEM_OWNER, 'start');
}

// module_开局 不再走 SkillModule.onInit 路径 —— bootstrap() 直接调顶层 onInit。
// 这里只暴露 createSkill 让 SkillModule 注册表能找到这个模块(其他代码可能仍按
// SkillModule 接口查询),不再需要 registerSkillModule 注册。
export default { createSkill };
