// 界潜心(界徐庶·蜀·觉醒技,OL 界限突破 hero/304 官方逐字):
//   觉醒技，当你造成伤害后，若你已受伤，你减少1点体力上限并获得"荐言"。
//
// 分析:
//   类型: 觉醒技 | 时机: 造成伤害 after-hook, source === ownerId
//   触发条件:
//     - ownerId 是伤害来源(atom.source === ownerId)
//     - amount > 0
//     - ownerId 已受伤(health < maxHealth)
//     - 未觉醒(player.vars['界潜心/awakened'] 为 falsy)
//   流程:
//     1. 标记已觉醒(防重入)
//     2. 设上限(player=ownerId, amount = maxHealth - 1)
//     3. 添加技能(player=ownerId, skillId='界荐言')
//
//   觉醒标记: player.vars['界潜心/awakened'] (无 /usedThisTurn 后缀,永久不被「回合结束」清理)
//
//   注意:这是三国杀首个"回合外"可发动的觉醒技——诛害在他人回合造成的伤害同样触发。
//   此处实现不依赖"是否在 ownerId 回合",只要满足 source === ownerId 即可。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界潜心';
const DISPLAY_NAME = '潜心';
const AWAKENED_KEY = `${SKILL_ID}/awakened`;
const GRANT_SKILL_ID = '界荐言';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '觉醒技:造成伤害后,若你已受伤,你减少1点体力上限并获得"荐言"',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 造成伤害 after-hook:潜心觉醒主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return; // 仅在自己造成伤害时触发
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 觉醒技:整局一次
    if (self.vars[AWAKENED_KEY]) return;
    // 触发条件:已受伤(当前体力 < 体力上限)
    if (self.health >= self.maxHealth) return;

    // 标记已觉醒(在读条件后立即设,防重入)
    ctx.state.players[ownerId].vars[AWAKENED_KEY] = true;

    // 1. 减少1点体力上限(设上限 amount = maxHealth - 1)
    //    设上限 atom 不允许 0 上限;maxHealth >= 2 时才减(避免 maxHealth=1 时减为 0)
    const newMax = self.maxHealth - 1;
    if (newMax >= 1) {
      await applyAtom(ctx.state, {
        type: '设上限',
        player: ownerId,
        amount: newMax,
      });
    }

    // 2. 永久获得"荐言"(实际 skillId 为 '界荐言',与 loader/character 一致)
    await applyAtom(ctx.state, {
      type: '添加技能',
      player: ownerId,
      skillId: GRANT_SKILL_ID,
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 觉醒技,被动触发,无主动 action
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
