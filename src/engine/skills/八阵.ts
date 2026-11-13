// 八阵(卧龙诸葛·锁定技):当你没有装备防具时,始终视为你装备着【八卦阵】。
//
// 实现:复用 八卦阵.ts 导出的 createBaguaDodgeSkill 工厂(询问闪 before-hook:
// 询问是否发动 → 判定 → 红色放虚拟闪 + cancel 主询问闪,流程逐字同八卦阵),
// 仅注入差异参数:
//   - 生效守卫 guard:owner 无防具时生效——一旦装备了真实防具(仁王盾/藤甲/八卦阵等),
//     八阵失效;卸下防具后自动恢复。
//   - 文案前缀 '八阵'(requestType/localVars 键/虚拟闪 id/判定 标签),
//     询问标题带 '(判定,红色视为出闪)' 后缀;isLocked 标记锁定技。
//   - 八卦阵是装备防具技(随装备加载/卸载);八阵是角色锁定技(常驻)。
//
// 无防具检查:防具 slot 名为 '防具',equipment['防具'] 为空即无防具。
import type { GameState } from '../types';
import { createBaguaDodgeSkill, type BaguaDodgeOptions } from './八卦阵';

/** owner 当前是否无防具(八阵生效条件) */
function noArmor(state: GameState, ownerId: number): boolean {
  const equip = state.players[ownerId]?.equipment;
  if (!equip) return true;
  return !equip['防具'];
}

const OPTIONS: BaguaDodgeOptions = {
  name: '八阵',
  description: '锁定技:没有装备防具时,视为装备着八卦阵',
  prefix: '八阵',
  confirmTitle: '是否发动八阵(判定,红色视为出闪)?',
  isLocked: true,
  guard: noArmor,
};

export const { createSkill, onInit, onMount } = createBaguaDodgeSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
