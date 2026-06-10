// src/engine/skills/武圣.ts
// 武圣(关羽·锁定技/转化技):你可以将一张红色牌当【杀】使用或打出
// 简化实现:前端按钮在 onMount 给出,后端只做 validate(包不包装由后端校验+杀 reuse)
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '武圣',
    description: '你可以将一张红色牌当【杀】使用或打出',
  };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  // 杀的 action 路由自动处理 fromSkill='武圣' 的牌包装(后端校验)
  // 武圣自身不注册 action,只注册 after 钩子:牌离开处理区时还原
  api.onAtomAfter('移动牌', async (ctx) => {
    if (ctx.atom.from.zone === '处理区') {
      // 牌离开处理区 — 还原包装(简化:如果 from 来自出杀,卡片原始属性恢复)
      // TODO: 真正的包装/还原逻辑
    }
  });
  return () => {};
}

// 武圣包装/还原 helper(供 server / engine dispatch 调用)
export function isRedSuit(suit: string): boolean {
  return suit === '♥' || suit === '♦';
}

export const module_武圣: SkillModule = { createSkill, onInit };
registerSkillModule('武圣', module_武圣);
