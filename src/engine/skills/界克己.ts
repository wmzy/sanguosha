// 界克己(界吕蒙·吴国·界限突破):
//   OL 官方(hero/306)逐字:
//   "若你未于本回合出牌阶段使用或打出过【杀】,你可以跳过弃牌阶段。"
//
// 与标克己区别:
//   - 标版实现把"本回合"当作整回合任一阶段出过杀即计数,导致在出牌阶段外打出杀
//     (如响应延时锦囊/决斗/南蛮等)也会阻止克己——比官方更严格。
//   - 界版严格按官方"出牌阶段内"判定:仅在「出牌」阶段(且为自己回合)使用/打出杀
//     才计数;出牌阶段外打出杀不阻止克己。
//
// 实现/交互复用标版克己导出的 createKejiSkill 工厂,仅注入差异:
//   - 键名按技能 id '界克己' 隔离(界克己/playedSlash、界克己/confirmed、界克己/confirm)。
//   - onlyPlayPhase=true:移动牌 after hook 增设「出牌」阶段守卫(标版无此守卫)。
import { createKejiSkill, type KejiOptions } from './克己';
import type { SkillModule } from '../types';

const OPTIONS: KejiOptions = {
  skillId: '界克己',
  displayName: '界克己',
  description: '若你未于本回合出牌阶段使用或打出过【杀】,你可以跳过弃牌阶段',
  onlyPlayPhase: true,
  confirmTitle: '界克己:本回合出牌阶段未出杀,是否跳过弃牌阶段?',
};

export const { createSkill, onInit, onMount } = createKejiSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
