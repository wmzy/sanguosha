// 界直谏(界张昭张纮·吴·主动技·OL 界限突破版):
//   出牌阶段,你可以将一张装备牌置入一名其他角色的装备区(可替换原装备),然后摸一张牌。
//
// OL 界限突破差异(相对标 直谏 src/engine/skills/直谏.ts,经工厂参数注入):
//   1. **可替换原装备**:目标对应栏位已有装备时,先弃置原装备再装新装备(替换语义)。
//      标版"不得替换"(栏位必须为空)的限制在界版取消。
//   2. 无"使用装备牌时摸牌"被动(那是移动版 msgs 的界直谏,不是 OL 版)。
//   3. 主动效果摸牌(1 张)与标版一致。
//
// 装备流程/onMount 复用标版直谏导出的 createZhijianSkill 工厂
// (差异仅 名称/描述/文案/allowReplace)。
//
// 关键点:
//   - 替换原装备流程与 装备通用 一致:移除旧装备技能 → 卸下 → 移动牌(旧装备入弃牌堆)→ 装备新 → 添加新技能。
//     替换会触发目标"失去装备"相关技能(如枭姬),这是预期行为。
//   - 装备到目标的 装备 atom player=目标,不会触发任何"自己使用装备"的被动(本技能也无此被动)。
import { createZhijianSkill, type ZhijianOptions } from './直谏';

const OPTIONS: ZhijianOptions = {
  name: '界直谏',
  description: '出牌阶段:将一张装备牌置入一名其他角色的装备区(可替换原装备),然后摸一张牌',
  skillId: '界直谏',
  mountLabel: '界直谏',
  mountTitle: '界直谏:将一张装备牌置入一名其他角色的装备区(可替换原装备)',
  allowReplace: true,
};

export const { createSkill, onInit, onMount } = createZhijianSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
