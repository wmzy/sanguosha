// 破势(陆抗·吴·觉醒技,风林火山 hero/414 官方逐字):
//   "觉醒技,准备阶段,若你的装备栏均被废除或体力值为1,你减少1点体力上限,
//    将手牌摸至体力上限,失去'决堰'并获得'怀柔'。"
//
// 模式(觉醒技,强制):after hook 挂在「阶段开始」(phase='准备')。
//   准备阶段(player===ownerId) → 条件满足 且未觉醒 → 强制结算:
//     1. 减少1点体力上限(设上限 amount=maxHealth-1;clamp 体力)
//     2. 将手牌摸至体力上限(摸牌 count = max(0, 新上限 - 手牌数))
//     3. 失去"决堰"(移除技能)
//     4. 获得"怀柔"(添加技能;怀柔未注册则 instantiateSkill 跳过,不影响其余效果)
//   觉醒标记:player.vars['破势/awakened'](整局一次,不被「回合结束」自动清理)
//
// 条件(满足其一即触发):
//   - 装备栏均被废除:5 个 EquipSlot(武器/防具/进攻马/防御马/宝物)全部有 决堰/废除: 标记
//   - 体力值为1:getHealthValue(self) === 1
//
// 关键点:
//   - 触发时机:文档「准备阶段」,挂在「阶段开始」phase='准备'(与 鸿举/若愚 同构)
//   - 减上限在摸牌前(先降上限,再按新上限摸)
//   - "失去决堰":移除技能 atom 会卸载决堰的 hooks/providers(含本回合杀次数/距离/集智效果)
//   - "获得怀柔":怀柔尚未实现,添加技能 atom 把 skillId 加入 skills 列表,
//     instantiateSkill 检测未注册则跳过实例化(不影响觉醒其余效果)
import type { AtomAfterContext, FrontendAPI, GameState, Skill } from '../types';
import { getHealthValue } from '../types';
import type { EquipSlot } from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import { ABOLISH_PREFIX } from './决堰';
import type { SkillModule } from '../types';

const AWAKENED_KEY = '破势/awakened';

/** 全部装备槽(5 个) */
const ALL_SLOTS: EquipSlot[] = ['武器', '防具', '进攻马', '防御马', '宝物'];

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '破势',
    description:
      '觉醒技:准备阶段,若装备栏均被废除或体力值为1,减少1点体力上限,将手牌摸至体力上限,失去决堰并获得怀柔',
  };
}

/** 玩家的装备栏是否全部废除(5 个槽均有废除标记) */
export function allSlotsAbolished(state: GameState, player: number): boolean {
  const vars = state.players[player]?.vars;
  if (!vars) return false;
  return ALL_SLOTS.every((s) => vars[ABOLISH_PREFIX + s]);
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '准备') return;
    if (ctx.state.players[ownerId]?.vars[AWAKENED_KEY]) return; // 整局一次
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 触发条件:装备栏均被废除 或 体力值为1
    const abolished = allSlotsAbolished(ctx.state, ownerId);
    const healthIsOne = getHealthValue(self) === 1;
    if (!abolished && !healthIsOne) return;

    // 标记已觉醒(读完条件立即设,防重入)
    ctx.state.players[ownerId].vars[AWAKENED_KEY] = true;

    // 1. 减少1点体力上限(设上限 clamp 体力:若体力 > 新上限则降至新上限)
    await applyAtom(ctx.state, {
      type: '设上限',
      player: ownerId,
      amount: self.maxHealth - 1,
    });

    // 2. 将手牌摸至体力上限(此时上限已 -1)
    const newMax = ctx.state.players[ownerId].maxHealth;
    const handCount = ctx.state.players[ownerId].hand.length;
    const drawCount = Math.max(0, newMax - handCount);
    if (drawCount > 0) {
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: drawCount });
    }

    // 3. 失去"决堰"
    await applyAtom(ctx.state, { type: '移除技能', player: ownerId, skillId: '决堰' });

    // 4. 获得"怀柔"(未注册则跳过实例化,不影响其余效果)
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '怀柔' });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 觉醒技,被动触发,无主动 action
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
