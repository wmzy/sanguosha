// src/engine/skills/丈八蛇矛.ts
// ============================================================
// 技能描述(三国杀官方规则):
//   丈八蛇矛(武器,射程 3):转化技,你可以将 2 张手牌当作【杀】使用或打出。
//
// 关键原子操作(标准设计):
//   transform 路径:UI 端选 2 张手牌 → 服务端验证 → 走杀.ts use/respond,
//   附加 fromSkill='丈八蛇矛' 标记,杀.ts 据此把 2 张牌全部弃置(代替单张杀)。
//
// 已知问题/不完整实现:
//   1. **onInit 完全空**:第 10-13 行只 return ()=>{},
//      后端没有任何 registerAction、registerBeforeHook 等注册逻辑——
//      丈八蛇矛装备后**完全无效**,玩家点 transform 按钮服务端会找不到 action handler。
//   2. **杀.ts 不识别 fromSkill='丈八蛇矛'**:杀.ts 的 use/respond execute 中没有任何
//      "若 fromSkill==='丈八蛇矛' 则取 cardIds 2 张并弃置"的处理逻辑,
//      "依赖杀.ts 处理 fromSkill"的注释完全是 wishful thinking。
//   3. **cardFilter 缺约束**:onMount 的 cardFilter `filter:()=>true` 允许任意 2 张牌,
//      包括装备/判定区——规则限定只能"手牌",需 filter 来源 zone。
//   4. **缺"使用/打出杀"语义区分**:丈八蛇矛 transform 应同时支持 use(出牌阶段)
//      和 respond(决斗/南蛮等);当前只注册 transform 一个 action,
//      执行链需要根据 context 分发——但 onInit 又是空的,根本走不下去。
//   5. **响应限制缺失**:丈八蛇矛需要保留 2 张手牌才能用,若只有 1 张手牌不应触发——
//      validate 缺失。
// ============================================================
import type { FrontendAPI, Skill } from '../types';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '丈八蛇矛', description: '武器:可将2张手牌当杀使用' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  // 后端不需要 registerAction,杀的 execute 处理 fromSkill='丈八蛇矛'
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('transform', {
    label: '丈八蛇矛',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择2张手牌当杀使用',
      cardFilter: { filter: () => true, min: 2, max: 2 },
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount };
