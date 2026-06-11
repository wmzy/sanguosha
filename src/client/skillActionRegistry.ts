// src/client/skillActionRegistry.ts
// 前端技能 action 注册表：收集技能 onMount 调用 defineAction 注册的 UI 配置
// 按设计文档 §4.7 / §4.13
import type { ActionPrompt, Card, CardWrapper, Skill, FrontendAPI } from '../engine/types';
// 确保所有 skill modules 已注册(side-effect import)
import '../engine/skills/index';
import { getSkillModule } from '../engine/skill';

export interface SkillActionDef {
  skillId: string;
  ownerId: string;
  actionType: string;
  label: string;
  style?: 'primary' | 'danger' | 'default' | 'passive';
  prompt: ActionPrompt;
  transform?: (card: Card) => CardWrapper;
}

// 全局注册表：key = "skillId:ownerId:actionType"
const registry = new Map<string, SkillActionDef>();

function actionKey(skillId: string, ownerId: string, actionType: string): string {
  return `${skillId}:${ownerId}:${actionType}`;
}

/** 创建一个 FrontendAPI 实例，defineAction 调用会注册到全局注册表 */
function makeFrontendAPI(skillId: string, ownerId: string): FrontendAPI {
  return {
    viewer: ownerId,
    onEvent() { return () => {}; },
    defineAction(actionType, opts) {
      registry.set(actionKey(skillId, ownerId, actionType), {
        skillId,
        ownerId,
        actionType,
        label: opts.label,
        style: opts.style,
        prompt: opts.prompt,
        transform: opts.transform,
      });
    },
    playEffect() {},
  };
}

/**
 * 为一个玩家初始化所有技能的前端 action 注册。
 * 遍历 player.skills，调用每个技能 module 的 onMount。
 */
export function registerSkillActions(playerName: string, skillIds: string[]): void {
  for (const skillId of skillIds) {
    try {
      const mod = getSkillModule(skillId);
      if (!mod.onMount) continue;
      const skill: Skill = mod.createSkill(skillId, playerName);
      const api = makeFrontendAPI(skillId, playerName);
      mod.onMount(skill, api);
    } catch (e) {
      // skill not registered, skip
      console.warn(`[skillActionRegistry] 注册 ${skillId} 失败:`, e);
    }
  }
}

/**
 * 获取某个玩家已注册的所有 action 定义。
 * 用于前端渲染技能按钮区。
 */
export function getActionsForPlayer(playerName: string): SkillActionDef[] {
  const result: SkillActionDef[] = [];
  for (const [, def] of registry) {
    if (def.ownerId === playerName) {
      result.push(def);
    }
  }
  return result;
}

/** 清空注册表（用于测试隔离或重连） */
export function clearRegistry(): void {
  registry.clear();
}
