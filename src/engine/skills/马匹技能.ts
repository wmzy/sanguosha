// src/engine/skills/马匹技能.ts
// 进攻马/防御马的通用技能工厂。
//
// 马匹效果与武将技能(如马术)一致:通过 player.vars 的距离修正实现。
//   进攻马 → vars['距离/进攻修正'] = 1(你与其他角色距离-1)
//   防御马 → vars['距离/防御修正'] = 1(其他角色与你的距离+1)
//
// 机制:装备通用.ts 装备马匹时按 skillLoaders[card.name] 自动 添加技能,
// 卸下时 移除技能。技能实例生命周期与装备绑定:
//   - onInit(添加技能时):立即设 vars(装备当帧生效)
//   - 返回的卸载函数(移除技能/卸下时):清 vars
import type { GameState, Skill } from '../types';
import type { SkillModule } from '../skill';

/** 距离修正类型:进攻(缩短你到他人的距离)/防御(增加他人到你的距离) */
type MountKind = '进攻' | '防御';

const VAR_KEY: Record<MountKind, string> = {
  '进攻': '距离/进攻修正',
  '防御': '距离/防御修正',
};

/**
 * 创建一个马匹技能模块(进攻马或防御马)。
 * @param name    卡牌名(也是 skillId),如 '赤兔'
 * @param kind    '进攻' | '防御'
 * @param desc    技能描述
 */
export function createMountSkill(name: string, kind: MountKind, desc: string): SkillModule {
  const key = VAR_KEY[kind];
  return {
    createSkill(id: string, ownerId: number): Skill {
      return { id, ownerId, name, description: desc };
    },
    onInit(skill: Skill, state: GameState): () => void {
      const ownerId = skill.ownerId;
      // 装备时立即设距离修正 vars
      state.players[ownerId].vars[key] = 1;
      // 卸下时清(闭包捕获 state 同一引用)
      return () => {
        delete state.players[ownerId]?.vars[key];
      };
    },
  };
}

// ─── 进攻马 ───
export const 赤兔 = createMountSkill('赤兔', '进攻', '进攻马:你与其他角色的距离-1');
export const 紫骍 = createMountSkill('紫骍', '进攻', '进攻马:你与其他角色的距离-1');
export const 大宛 = createMountSkill('大宛', '进攻', '进攻马:你与其他角色的距离-1');

// ─── 防御马 ───
export const 的卢 = createMountSkill('的卢', '防御', '防御马:其他角色与你的距离+1');
export const 绝影 = createMountSkill('绝影', '防御', '防御马:其他角色与你的距离+1');
export const 爪黄飞电 = createMountSkill('爪黄飞电', '防御', '防御马:其他角色与你的距离+1');
