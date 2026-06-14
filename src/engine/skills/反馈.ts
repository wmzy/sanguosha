// src/engine/skills/反馈.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/武将技能/魏国/司马懿.md):
//   反馈(司马懿·被动技):
//     - 触发时机:当你受到伤害后
//     - 发动条件:伤害来源有牌(手牌或装备牌)
//     - 效果:你可以获得伤害来源的一张牌
//     - 限制:无次数限制
//     - 备注:
//       - 可以选择获得手牌或装备牌
//       - **由司马懿选择获得哪张牌(不能观看手牌后选择)**——版本有差异
//
// 关键原子操作:
//   after 钩子(造成伤害):
//     请求回应(confirm) → 获得(source.hand[0] 或 source.equipment 第一槽)
//
// 关键时机:
//   - 受到伤害后(after hook of 造成伤害)
//   - 来源必须存活/有手牌或装备
//
// 已知问题/不完整实现:
//   1. **描述错误**:写"锁定技",但实现是 confirm 后才发动 = 非锁定技。
//      标准反馈也是非锁定技,描述应改"主动技"。
//   2. **来源未死亡校验缺失**:伤害来源若已死亡(濒死求桃失败),
//      规则上不应再"获得"其牌——当前只检查 alive 缺失,需补 sourcePlayer.alive。
//   3. **获取牌的方式不符合规则**:
//      - 标准规则:从来源的所有手牌+装备中,**随机**一张(或某些版本是由你选);
//      - 当前实现:固定取 hand[0],没有手牌再取 equipment[0]——
//        完全可预测,严重影响公平性与可玩性。
//      应该是 prompt(让玩家选) 或 用 PRNG 随机。
//   4. **装备牌"获得"语义不清**:从对方装备区拿装备牌时,
//      "获得"atom 只移动到自己手牌——但对方仍记 equipment 字段持有 cardId?
//      需验证 获得.ts atom 的实现是否自动卸下来源装备。
//   5. **触发限制缺失**:某些版本反馈有"每回合限一次"或"每次伤害限一次"限制,
//      当前实现无任何限制,理论上同一次多点伤害会触发多次?
//      ——其实 after hook 只在 造成伤害 atom after 触发,每点伤害是一次 atom,
//      多段伤害也只一个 atom,因此实际是"每次伤害一次",符合规则。
//   6. ctx.params.__反馈confirmed 用 __ 私有字段(同反模式)。
// ============================================================
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '反馈',
    description: '锁定技:受到伤害后,你可以获得伤害来源的一张牌',
  };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAfterHook(skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; source?: number; amount?: number };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.source === undefined) return;
    // 检查来源是否有牌
    const sourcePlayer = ctx.state.players[atom.source];
    if (!sourcePlayer) return;
    const hasCards = sourcePlayer.hand.length > 0 || Object.keys(sourcePlayer.equipment).length > 0;
    if (!hasCards) return;
    // 询问是否发动
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '反馈/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '是否发动反馈?', confirmLabel: '发动', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10000,
    });
    const confirmed = ctx.params.__反馈confirmed as boolean | undefined;
    if (!confirmed) return;
    // 获得来源的一张牌(简化:取手牌第一张,优先手牌)
    const source = ctx.state.players[atom.source];
    if (!source) return;
    let cardId: string | undefined;
    if (source.hand.length > 0) {
      cardId = source.hand[0];
      await applyAtom(ctx.state, { type: '获得', player: ownerId, cardId, from: atom.source });
    } else {
      const equipSlot = Object.keys(source.equipment)[0] as keyof typeof source.equipment;
      if (equipSlot) {
        cardId = source.equipment[equipSlot];
        if (cardId) {
          await applyAtom(ctx.state, { type: '获得', player: ownerId, cardId, from: atom.source });
        }
      }
    }
  });
  return () => {};
}

export default { createSkill, onInit };