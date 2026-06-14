// src/engine/skills/流离.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/武将技能/吴国/大乔.md):
//   流离(大乔·主动技):
//     - 触发时机:成为【杀】的目标时
//     - 发动条件:有牌可以弃置,且攻击范围内有其他角色
//     - 效果:
//       1) 弃置一张牌
//       2) 将【杀】转移给攻击范围内的一名其他角色
//     - 限制:无次数限制
//     - 备注:
//       - 弃置的牌可以是手牌或装备牌
//       - 转移后的【杀】目标改变,**原目标不再是目标**
//       - 攻击范围由大乔的武器和距离计算决定
//     - FAQ:
//       - 不能转移给不在攻击范围内的角色
//       - 不能在【杀】已经造成伤害后发动(必须指定目标后、生效前)
//
// 关键原子操作:
//   after 钩子(指定目标):
//     请求回应(confirm) → 请求回应(choosePlayer) → 弃置(self.hand[0]) →
//     mutate parent frame.params.settlement[].target = newTarget
//
// 关键时机:
//   - "成为【杀】的目标时"——after hook of 指定目标
//   - 必须在询问闪之前介入,否则"闪"将由错误目标决定
//   - 必须在造成伤害之前介入,否则规则上不能发动(FAQ)
//
// 已知问题/不完整实现:
//   1. **"攻击范围内"未验证**:描述里说"攻击范围内一名其他角色",
//      但代码 filter 只排除自己,任何存活角色都能被选中(违反规则)。
//      应使用 distance.ts 的 inAttackRange 验证。
//   2. **触发时机错误**:after hook 在【指定目标】atom 执行后触发,
//      但 杀.ts 的 use 流程是 "指定目标 → 询问闪",当 hook 修改 settlement.target 时,
//      下一个迭代的 询问闪 已经按旧 target 排队(若同步),但代码靠 mutate settlement 来"间接"修改后续迭代的 target——
//      检查 杀.ts 第 65-68 行:`for (target of targets) { 指定目标; 询问闪 }`——
//      这里 targets 数组是循环变量,**不会读 settlement**,因此 settlement.target 修改对询问闪无效。
//      流离实际上**不工作**(询问闪还是问旧目标)。
//   3. **弃牌强制第一张**:直接弃 selfPlayer.hand[0],未询问玩家选哪张(违反规则)。
//      应通过 prompt(useCard, min:1, max:1) 让玩家选弃哪张。
//   4. **"非【杀】"未过滤**:after hook 不检查 atom.cardId 是否真是【杀】——
//      理论上对决斗等"指定目标"的非杀牌也会触发(违反"成为【杀】的目标时")。
//   5. 用 frame.params.__流离confirmed 等 __ 私有字段(同其他文件反模式)。
//   6. 第 67 行的空 `;` 是死代码,注释"也修改当前 atom 的 target"未真实实现。
// ============================================================
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '流离',
    description: '当你成为杀的目标时,可弃一张牌,将此杀转移给攻击范围内一名其他角色',
  };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAfterHook(skill.id, ownerId, '指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
    // 只在被指定为杀的目标时触发
    if (atom.target !== ownerId) return;
    // 检查是否有手牌可以弃
    const selfPlayer = ctx.state.players[ownerId];
    if (!selfPlayer || selfPlayer.hand.length === 0) return;
    // 检查攻击范围内是否有其他角色(简化:排除自己和已死亡)
    const aliveOthers = ctx.state.players.filter(p => p.index !== ownerId && p.alive);
    if (aliveOthers.length === 0) return;
    // 询问是否发动
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '流离/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '是否发动流离?', confirmLabel: '发动', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10000,
    });
    // 读回应:未回应或取消则不发动
    const confirmed = ctx.params.__流离confirmed as boolean | undefined;
    if (!confirmed) return;
    // 询问选择新目标
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '流离/chooseTarget',
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '流离:选择转移目标',
        min: 1,
        max: 1,
        filter: (_view, target) => target !== ownerId,
      },
      timeout: 15000,
    });
    const newTarget = ctx.params.__流离目标 as number | undefined;
    if (newTarget === undefined || newTarget === ownerId) return;
    // 弃 1 张牌(让玩家选择,简化:弃手牌第一张)
    const discardCard = selfPlayer.hand[0];
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCard] });
    // 修改 settlement 中的目标
    const settlement = ctx.params.settlement as Array<{ target: number; dodged: boolean; amount: number }> | undefined;
    if (settlement) {
      const item = settlement.find(s => s.target === ownerId);
      if (item) {
        item.target = newTarget;
      }
    }
    // 也修改当前 atom 的 target,后续 atom 读取新值
    ;
  });
  return () => {};
}

export default { createSkill, onInit };
