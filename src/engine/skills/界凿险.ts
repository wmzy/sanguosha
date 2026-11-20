// 界凿险(界邓艾·觉醒技):准备阶段,若"田"的数量≥3,你须减1点体力上限,
//   然后获得技能"急袭",且本回合结束后进行一个额外回合。
//
// 与标版凿险差异:觉醒时额外设 凿险/extraTurn 标志,本回合结束时触发额外回合。
//   额外回合机制参考 放权/界放权:before hook 挂「回合结束」→ cancel 正常回合结束 →
//   手动清理 per-turn 状态 → 亲自启动 ownerId 的额外回合(回合管理 阶段推进钩子自动走完)。
//   额外回合结束后,正常 座次顺序 推进(下一玩家 atom 自然从 ownerId 推到正常下家)。
//
// 觉醒判定流程/额外回合 hook 复用标版凿险导出的 createZaoxianSkill 工厂
// (差异仅 名称/描述/extraTurnAfterAwaken;觉醒标记共享 '凿险/awakened'——
//  同一角色只会拥有一版凿险)。
//
// 关键点:
//   - 觉醒技:整局一次(player.vars['凿险/awakened'] 防重入)
//   - 田数量 = marks 中 `屯田/田:` 前缀的 mark 数量
//   - 减上限后若体力>新上限,设上限 atom 自动 clamp
//   - 急袭技能模块需在 skills/index.ts 注册
//   - 额外回合仅触发一次(标志在消费后立即清除)
import { createZaoxianSkill, type ZaoxianOptions } from './凿险';
import type { SkillModule } from '../types';

const OPTIONS: ZaoxianOptions = {
  name: '界凿险',
  description:
    '觉醒技:准备阶段田≥3时,减1体力上限、获得"急袭",且本回合结束后进行一个额外回合',
  extraTurnAfterAwaken: true,
};

export const { createSkill, onInit, onMount } = createZaoxianSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
