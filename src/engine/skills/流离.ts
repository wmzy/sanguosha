// src/engine/skills/流离.ts
// 流离(大乔·主动技):当你成为【杀】的目标时,可弃一张牌,将此【杀】转移给攻击范围内一名其他角色
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '流离',
    description: '当你成为杀的目标时,可弃一张牌,将此杀转移给攻击范围内一名其他角色',
  };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAfterHook(skill.id, ownerId, '指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: string; target?: string; cardId?: string };
    // 只在被指定为杀的目标时触发
    if (atom.target !== ownerId) return;
    // 检查是否有手牌可以弃
    const selfPlayer = ctx.state.players.find(p => p.name === ownerId);
    if (!selfPlayer || selfPlayer.hand.length === 0) return;
    // 检查攻击范围内是否有其他角色(简化:排除自己和已死亡)
    const aliveOthers = ctx.state.players.filter(p => p.name !== ownerId && p.alive);
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
    const newTarget = ctx.params.__流离目标 as string | undefined;
    if (!newTarget || newTarget === ownerId) return;
    // 弃 1 张牌(让玩家选择,简化:弃手牌第一张)
    const discardCard = selfPlayer.hand[0];
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCard] });
    // 修改 settlement 中的目标
    const settlement = ctx.params.settlement as Array<{ target: string; dodged: boolean; amount: number }> | undefined;
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
