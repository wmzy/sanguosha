// engine/skills/index.ts — 技能模块聚合入口
//
// 模块顶层副作用：import 即触发 registerSkill()。
// `registerAllSkills` 是显式语义出口，方便未来切换到"显式 register 调用"
// 模式（先在 init 阶段调用一次）；当前实现下无需重复调用。

import './wei';
import './shu';
import './wu';
import './qun';
import './equipment';
import './wansha';
import './kongcheng';
import './weimu';

export function registerAllSkills(): void {
  // 当前实现：模块顶层副作用已注入所有 skill；本函数为占位 + 显式语义出口。
  // 调用者可在测试 setup 显式调用以表达意图，但无副作用。
}
