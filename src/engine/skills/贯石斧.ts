// src/engine/skills/贯石斧.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   贯石斧(武器,攻击范围 3,♠5):
//     - 目标角色使用【闪】后,你可以弃置 2 张牌
//     - 令此【杀】依然造成伤害
//
// 关键原子操作:
//   after 钩子(询问闪):
//     若 source===ownerId ∧ 装备贯石斧 ∧ discardPile 顶为闪 ∧ 手牌 ≥ 2
//       → 加标签('贯石斧/可强命')
//   confirm action(贯石斧/可强命):
//     validate: 参数 choice 为 boolean 且玩家带 '贯石斧/可强命' 标签
//     execute: 去标签 + 若 choice=true 则弃 2 张手牌 + mutate parent frame
//       settlement[i].dodged=false(使杀仍造成伤害)
//
// 关键时机:
//   - 询问闪 atom after 触发 → 检测是否被闪抵消
//   - 通过 state.zones.discardPile 顶端读最近一张被弃的牌判断是否为闪
//   - settlement.dodged 是 杀 帧的 params,确认强命时直接 mutate 父帧
import type { AtomAfterContext, Json, Skill } from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const TAG = '贯石斧/可强命';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '贯石斧',
    description: '武器技:杀被闪抵消后,可弃两张手牌令此杀依然造成伤害',
  };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  // ── after hook:检测自己的杀被闪抵消,加标签标记「可强命」──
  registerAfterHook(_skill.id, ownerId, '询问闪', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number };
    // 只对自己使用的杀做出反应
    if (atom.source !== ownerId) return;
    // 检查自己装备的是贯石斧
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const weaponId = self.equipment?.['武器'];
    if (!weaponId) return;
    const weapon = ctx.state.cardMap[weaponId];
    if (!weapon || weapon.name !== '贯石斧') return;
    // 检查最近一张弃牌是否为闪
    const discardPile = ctx.state.zones.discardPile;
    if (discardPile.length === 0) return;
    const topCardId = discardPile[discardPile.length - 1];
    const topCard = ctx.state.cardMap[topCardId];
    if (!topCard || topCard.name !== '闪') return;
    // 强命需弃 2 张手牌;手牌不足则不开机会(标准规则要求「可以」,
    // 玩家无可弃时不提示即可,符合「不强制要求」的体验)
    if (self.hand.length < 2) return;
    // 加标签标记可强命
    await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: TAG });
  });

  // ── confirm action:玩家选择是否弃 2 张牌强命 ──
  registerAction(
    '贯石斧/可强命',
    ownerId,
    'confirm',
    (state, params: Record<string, Json>): string | null => {
      if (typeof params.choice !== 'boolean') return 'choice required';
      if (params.choice === true) {
        // 选择强命时要求手牌仍 ≥ 2(强命机会期间可能手牌有变)
        if (state.players[ownerId].hand.length < 2) return '手牌不足两张,无法强命';
      }
      return null;
    },
    async (state, params: Record<string, Json>) => {
      const choice = params.choice as boolean;
      // 先摘掉标签
      await applyAtom(state, { type: '去标签', player: ownerId, tag: TAG });
      if (!choice) return;
      const self = state.players[ownerId];
      if (!self || self.hand.length < 2) return;
      // 弃 2 张手牌(简化:弃手牌前两张)
      const discardCards = self.hand.slice(0, 2);
      await applyAtom(state, { type: '弃置', player: ownerId, cardIds: discardCards });
      // mutate 父帧(杀帧)的 settlement:把对应目标的 dodged 置为 false,
      // 使 杀.ts 后续结算时仍按命中处理 → 造成伤害
      const frame = topFrame(state);
      if (frame) {
        const settlement = frame.params.settlement as
          | Array<{ target: number; dodged: boolean }>
          | undefined;
        if (settlement) {
          // 取最后一个 dodged=true 的目标(就是当前被闪抵消的那个)
          for (let i = settlement.length - 1; i >= 0; i--) {
            if (settlement[i].dodged) {
              settlement[i].dodged = false;
              break;
            }
          }
        }
      }
    },
  );

  return () => {};
}

export default { createSkill, onInit };