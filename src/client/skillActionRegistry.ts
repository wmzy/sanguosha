// src/client/skillActionRegistry.ts
// 前端技能 action 注册表：收集技能 onMount 调用 defineAction 注册的 UI 配置
// import skills/index 触发 setSkillModuleResolver(动态 import 按需加载)
import '../engine/skills';
import type { ActionActiveWhen, ActionPrompt, Card, CardWrapper, FrontendAPI, Skill } from '../engine/types';
import { getSkillModule } from '../engine/skill';

export interface SkillActionDef {
  skillId: string;
  /** 玩家座次下标 */
  ownerId: number;
  actionType: string;
  label: string;
  style?: 'primary' | 'danger' | 'default' | 'passive';
  prompt: ActionPrompt;
  transform?: (card: Card) => CardWrapper;
  /** 激活谓词(undefined = 用前端默认出牌激活条件) */
  activeWhen?: ActionActiveWhen;
}

// 全局注册表：key = "skillId:ownerId:actionType"
const registry = new Map<string, SkillActionDef>();

function actionKey(skillId: string, ownerId: number, actionType: string): string {
  return `${skillId}:${ownerId}:${actionType}`;
}

/** 创建一个 FrontendAPI 实例，defineAction 调用会注册到全局注册表 */
function makeFrontendAPI(skillId: string, ownerId: number): FrontendAPI {
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
        activeWhen: opts.activeWhen,
      });
    },
    playEffect() {},
  };
}

/**
 * 为一个玩家初始化所有技能的前端 action 注册。
 * 通过 import() 动态加载技能模块，调用每个技能 module 的 onMount。
 * @param playerIndex 玩家座次下标
 */
export async function registerSkillActions(playerIndex: number, skillIds: string[]): Promise<void> {
  for (const skillId of skillIds) {
    try {
      const mod = await getSkillModule(skillId);
      if (!mod.onMount) continue;
      const skill: Skill = mod.createSkill(skillId, playerIndex);
      const api = makeFrontendAPI(skillId, playerIndex);
      mod.onMount(skill, api);
    } catch {
      // 技能模块未实现(吕布/华佗等 stub 技能 path 为空)→ 静默跳过。
      // 引擎 instantiateSkill 对同样情况也是 catch 后返回 null,这里保持一致,避免控制台被刷屏。
    }
  }
}

/**
 * 获取某个玩家已注册的所有 action 定义。
 * 用于前端渲染技能按钮区。
 * @param playerIndex 玩家座次下标
 */
export function getActionsForPlayer(playerIndex: number): SkillActionDef[] {
  const result: SkillActionDef[] = [];
  for (const [, def] of registry) {
    if (def.ownerId === playerIndex) {
      result.push(def);
    }
  }
  return result;
}

/**
 * 跨所有 ownerId 查找指定 skillId + actionType 的 action 定义。
 * 用于视角切换的瞬态场景:target 玩家 action 已被清/未注册到当前 perspective 时
 * 仍能在 registry 里找到定义。
 */
export function findActionAcrossOwners(skillId: string, actionType: string): SkillActionDef | undefined {
  for (const def of registry.values()) {
    if (def.skillId === skillId && def.actionType === actionType) {
      return def;
    }
  }
  return undefined;
}

/** 获取当前注册表里所有 ownerId(用于调试/扩展) */
export function getRegisteredOwnerIds(): number[] {
  const set = new Set<number>();
  for (const def of registry.values()) set.add(def.ownerId);
  return [...set];
}

/** 清空注册表（用于测试隔离或重连） */
export function clearRegistry(): void {
  registry.clear();
}
