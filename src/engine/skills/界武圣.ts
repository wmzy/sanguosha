// 界武圣(界关羽·转化技):将一张红色牌(手牌或装备区)当【杀】使用或打出。
//
// 模型(组合 action):前端两步 UI(点武圣给红牌加"杀"显示 → 点出杀选目标),
// 提交时一个 ClientMessage:preceding=[武圣.transform] + 主 action=杀.use。
// 后端 dispatch 先执行 武圣.transform(创建影子杀),再 杀.use validate 看到"杀"通过。
// 杀技能零感知武圣——它看到的永远是 cardMap 里的一张"杀"。
//
// 界限突破:红色牌包括装备区(原版仅手牌)。装备区红色牌转化时先卸下到手牌再「当作」
// (工厂 includeEquipment 维度;rollback 还原槽位与武器距离 vars)。
// 五件套由 skillRuntime 工厂统一实现;影子卡 id 后缀 = 注册传入的 skillId('界武圣'),
// 与客户端 `${牌id}#${skillId}` 构造约定一致(见 CLAUDE.md)。
//
// 实现复用 武圣.ts 导出的 createWushengSkill 工厂(参照 八阵.ts 复用 八卦阵.ts 工厂),
// 注入两点差异:
//   - includeEquipment: 红色牌含装备区(含 activeWhen 的装备区红牌检查);
//   - diamondSlashNoDistanceLimit: 官方被动"你使用的方片【杀】无距离限制"
//     (经 distance provider 实现,任何方片杀生效,含物理方片杀与武圣/丈八转化出的方片杀)。
import { createWushengSkill } from './武圣';

export const { createSkill, onInit, onMount } = createWushengSkill({
  name: '界武圣',
  description: '你可以将一张红色牌(手牌或装备区)当【杀】使用或打出',
  includeEquipment: true,
  diamondSlashNoDistanceLimit: true,
});

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
