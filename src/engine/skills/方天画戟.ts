// 方天画戟(武器,攻击范围 4):
//   当你使用【杀】时,若此杀是你最后 1 张手牌,你可以额外指定至多 2 个目标(最多 3 名)。
//
//   实现:杀的 validate 不限制目标数量上限(只检查每个目标在攻击范围内),
//   因此多目标本身已被支持。方天画戟只需在 UI 层(前端)允许多选即可。
//   此技能保留为占位——当需要"仅最后一张手牌时才允许多目标"规则时再激活。
import type { Skill, GameState } from '../types';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '方天画戟', description: '武器:最后一张手牌为杀时可指定最多3个目标', isLocked: true };
}

export function onInit(_skill: Skill, _state: GameState): () => void {
  // 方天画戟的效果由杀的 validate + 前端多选目标自然支持。
  // 当前杀的 validate 不限制目标数量上限,因此无需额外 hook。
  // 规则限定"仅最后一张手牌"的检查应在杀的 validate 中实现。
  return () => {};
}
