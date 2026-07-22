// 马术(马超·锁定技):你计算与其他角色的距离时,始终-1。
//
// 实现机制(与马匹技能·进攻马完全一致):
//   onInit 设 state.players[ownerId].vars['距离/进攻修正'] = 1,
//   distance.ts 的 effectiveDistance 读取该 vars 做进攻修正(正值=缩短距离)。
//   卸载时清除。区别:进攻马是装备技能(装备/卸载时实例化),马术是武将锁定技(开局即生效)。
import type { Skill, GameState } from '../types';

const VAR_KEY = '距离/进攻修正';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '马术', description: '锁定技:你与其他角色的距离-1', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  // 装备/技能生效时立即设距离修正 vars(当帧生效)
  state.players[ownerId].vars[VAR_KEY] = 1;
  // 卸载时清除(闭包捕获 state 同一引用)
  return () => {
    delete state.players[ownerId]?.vars[VAR_KEY];
  };
}
