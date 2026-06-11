// src/engine/skills/流离.ts
// 流离(大乔·主动技):当你成为【杀】的目标时,可弃一张牌,将此【杀】转移给攻击范围内一名其他角色
import type { AtomAfterContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '流离',
    description: '当你成为杀的目标时,可弃一张牌,将此杀转移给攻击范围内一名其他角色',
  };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.onAtomAfter('指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: string; target?: string; cardId?: string };
    // 只在被指定为杀的目标时触发
    if (atom.target !== api.self) return;
    // 检查是否有手牌可以弃
    const selfPlayer = ctx.state.players.find(p => p.name === api.self);
    if (!selfPlayer || selfPlayer.hand.length === 0) return;
    // 检查攻击范围内是否有其他角色(简化:排除自己和已死亡)
    const aliveOthers = ctx.state.players.filter(p => p.name !== api.self && p.alive);
    if (aliveOthers.length === 0) return;
    // 询问是否发动
    await ctx.api.apply({
      type: '请求回应',
      requestType: '流离/confirm',
      target: api.self,
      prompt: { type: 'confirm', title: '是否发动流离?', confirmLabel: '发动', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10000,
    });
    // 读回应:未回应或取消则不发动
    const confirmed = ctx.params.__流离confirmed as boolean | undefined;
    if (!confirmed) return;
    // 询问选择新目标
    await ctx.api.apply({
      type: '请求回应',
      requestType: '流离/chooseTarget',
      target: api.self,
      prompt: {
        type: 'choosePlayer',
        title: '流离:选择转移目标',
        min: 1,
        max: 1,
        filter: (_view, target) => target !== api.self,
      },
      timeout: 15000,
    });
    const newTarget = ctx.params.__流离目标 as string | undefined;
    if (!newTarget || newTarget === api.self) return;
    // 弃 1 张牌(让玩家选择,简化:弃手牌第一张)
    const discardCard = selfPlayer.hand[0];
    await ctx.api.apply({ type: '弃置', player: api.self, cardIds: [discardCard] });
    // 修改 settlement 中的目标
    const settlement = ctx.params.settlement as Array<{ target: string; dodged: boolean; amount: number }> | undefined;
    if (settlement) {
      const item = settlement.find(s => s.target === api.self);
      if (item) {
        item.target = newTarget;
      }
    }
    // 也修改当前 atom 的 target,后续 atom 读取新值
    ;
  });
  return () => {};
}

export const module_流离: SkillModule = { createSkill, onInit };
registerSkillModule('流离', module_流离);
