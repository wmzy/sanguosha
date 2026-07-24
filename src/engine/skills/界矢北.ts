// 界矢北(界沮授·群·锁定技,OL 界限突破官方逐字):
//   锁定技,游戏开始时,你获得3点护甲。当你每回合首次受到伤害后,你回复1点体力,
//   然后当你本回合再受到伤害后,你失去1点体力。
//
// 与标版矢北区别(标版未实现,docs/research/武将技能/群雄/沮授.md):
//   - 标版矢北只有"首伤回血、再伤失血"机制(无开局护甲)
//   - 界版新增 OL 护甲系统(3 点伤害吸收护甲),且护甲可吸收任意类型伤害(普通/火焰/雷电)
//
// 实现要点:
//   - 护甲存储:每点护甲 = 一个 mark,id 形如 `界矢北/护甲:N`(N=state.seq 唯一,
//     参考 屯田 的"田"、界巧变的"变")。count = marks 中此前缀数量。
//     加/减经 加标记/去标记 atom(view 自动同步)。
//   - 游戏开始初始化(化身/界巧变先例):'回合开始' after-hook,首次触发时给本玩家
//     加 3 枚护甲 mark。主公首回合开始 ≈ 游戏开始,所有玩家实例同步初始化。
//   - 护甲减伤(before-hook on 造成伤害):
//       absorbed = min(护甲数, 伤害值)
//       移除 absorbed 枚护甲 mark(经 去标记 atom)
//       modify atom.amount -= absorbed(可能为 0,表示全部吸收)
//   - 首伤回血/再伤失血(after-hook on 造成伤害):
//       仅当最终 amount > 0 触发(护甲全吸收 → 未"受到伤害" → 不计)
//       count = player.vars['界矢北/damageCount/usedThisTurn'] ?? 0(/usedThisTurn 由 回合结束 自动清空)
//       count==0(首次受伤):回复体力 1
//       count>=1(再伤):失去体力 1(非伤害,不触发反馈/奸雄)
//       count+=1
//
// 命名:文件名/loader key/character skill name 均为 '界矢北'(避开标版冲突);
//   内部 Skill.name = '矢北'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerBeforeHook, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界矢北';
const DISPLAY_NAME = '矢北';

/** 护甲 mark id 前缀。每点护甲 = 1 个 mark。 */
const ARMOR_PREFIX = `${SKILL_ID}/护甲:`;
/** 游戏开始初始化标记(localVars,per-owner,首次触发后置 true) */
const INIT_KEY = (ownerId: number) => `${SKILL_ID}/init/${ownerId}`;
/** 本回合受伤计数(0=未受伤, 1=首次受伤后, ...);后缀 /usedThisTurn 由 回合结束 atom 自动清空 */
const DAMAGE_COUNT_KEY = `${SKILL_ID}/damageCount/usedThisTurn`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '锁定技:游戏开始时获得3点护甲;每回合首次受到伤害后回1血,本回合再受到伤害后失1血',
    isLocked: true,
  };
}

/** 数当前玩家的护甲点数 */
function armorCount(state: GameState, player: number): number {
  return state.players[player].marks.filter((m) => m.id.startsWith(ARMOR_PREFIX)).length;
}

/** 加 1 点护甲(经 加标记 atom,view 自动同步) */
async function addArmor(state: GameState, player: number): Promise<void> {
  await applyAtom(state, {
    type: '加标记',
    player,
    mark: { id: `${ARMOR_PREFIX}${state.seq}`, scope: player },
  });
}

/** 移除 N 点护甲(按 mark 加入顺序依次移除) */
async function removeArmor(state: GameState, player: number, count: number): Promise<void> {
  const marks = state.players[player].marks;
  const toRemove: string[] = [];
  for (const m of marks) {
    if (toRemove.length >= count) break;
    if (m.id.startsWith(ARMOR_PREFIX)) toRemove.push(m.id);
  }
  for (const markId of toRemove) {
    await applyAtom(state, { type: '去标记', player, markId });
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 游戏开始初始化(化身/界巧变先例):'回合开始' after-hook,首次触发加 3 点护甲 ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;
    if (st.localVars[INIT_KEY(ownerId)]) return;
    st.localVars[INIT_KEY(ownerId)] = true;
    await addArmor(st, ownerId);
    await addArmor(st, ownerId);
    await addArmor(st, ownerId);
  });

  // ── 护甲减伤:before-hook on 造成伤害,吸收伤害、扣减护甲 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '受到伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      const amount = atom.amount ?? 0;
      if (amount <= 0) return;
      const armor = armorCount(ctx.state, ownerId);
      if (armor <= 0) return;
      const absorbed = Math.min(armor, amount);
      const newAmount = amount - absorbed;
      // 先扣减护甲 mark(经 去标记 atom,view 同步),再 modify atom
      await removeArmor(ctx.state, ownerId, absorbed);
      return { kind: 'modify', atom: { ...ctx.atom, amount: newAmount } as typeof ctx.atom };
    },
  );

  // ── 首伤回血/再伤失血:after-hook on 造成伤害 ──
  // 仅当最终 amount > 0 触发(护甲全吸收则未"受到伤害")。
  // 在引擎濒死检查(系统规则 after-hook,ownerId=-1,最后执行)之前运行,
  // 故"首伤回 1 血"可避免 owner 因本次伤害进入濒死。
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    const finalAmount = atom.amount ?? 0;
    if (finalAmount <= 0) return; // 全吸收 → 不计

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    const count = (self.vars[DAMAGE_COUNT_KEY] as number | undefined) ?? 0;
    if (count === 0) {
      // 首次受伤:回 1 血
      await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
    } else {
      // 再伤:失 1 血(非伤害,不触发反馈/奸雄)
      await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
    }
    self.vars[DAMAGE_COUNT_KEY] = count + 1;
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技——无主动 action 声明
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
