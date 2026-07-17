// 诈降(界黄盖·锁定技,OL hero/307 官方逐字):
//   当你失去1点体力后，你摸三张牌，若在你的出牌阶段，你本回合使用【杀】的限制次数+1、
//   使用红色【杀】无距离限制且不能被抵消。
//
// 触发:'失去体力' atom 的 after-hook(target===owner 且 amount>0)。
//   ⚠ 关键区分:挂在'失去体力'而非'造成伤害'——失去体力不是受到伤害,
//   二者必须严格区分(苦肉走失去体力,普攻/南蛮走造成伤害)。
//
// 效果拆分:
//   1. 摸3张牌:无条件(任何阶段失去体力都摸)。
//   2. 杀增益(仅当失去体力时处于 owner 的出牌阶段才激活,turn-scoped):
//      a) 杀次数+1:registerSlashMaxProvider 返回 1(base 1 + 1 = 2),非"无限"。
//      b) 红色杀无距离:杀技能自身 validate 读 turn.vars[ACTIVE_VAR] 且卡色为红时放行
//         (distance.ts 不再做全局放行——红色专属,非所有杀)。
//      c) 红色杀不能被抵消:杀技能自身 execute 在询问闪前检查 turn.vars[ACTIVE_VAR]
//         且卡色为红 → 跳过询问闪(目标不可出闪响应)。
//   摸3与濒死的顺序:引擎 runAfterHooks 把系统级 hook(濒死)排最后,故诈降摸3先于
//   濒死求桃——黄盖可借诈降摸到的桃自救(OL 经典连招)。
//
// turn-scoped:turn.vars / turnUsage 在回合结束 atom 自动清空,效果仅本回合。
// provider 随技能实例生命周期注册/卸载(返回的 unload 由 setSkillInstanceUnload 清理)。
import type { AtomAfterContext, FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, type SkillModule } from '../skill';
import { registerSlashMaxProvider } from '../slash-quota';

/** 本回合诈降杀增益是否激活的 turn.vars key(值为激活者座次 number)。
 *  仅在 owner 出牌阶段失去体力后设置;杀技能/action-active/distance 据此分支红色杀增益。 */
const ACTIVE_VAR = '诈降/active';

/** 失去体力时是否处于 owner 自己的出牌阶段(诈降杀增益的生效条件)。 */
function inOwnerPlayPhase(state: GameState, ownerId: number): boolean {
  return state.currentPlayerIndex === ownerId && state.phase === '出牌';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '诈降',
    description:
      '锁定技：当你失去1点体力后，你摸三张牌，若在你的出牌阶段，你本回合使用【杀】的限制次数+1、使用红色【杀】无距离限制且不能被抵消。',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── 出杀上限提供者:诈降激活后本回合杀次数 +1(base 1 + 1 = 2) ─────────
  //   官方"限制次数+1"是额度叠加,非"无限"(诸葛连弩/咆哮式 ∞ 由 provider 返回 Infinity)。
  const unloadProvider = registerSlashMaxProvider(
    state,
    ownerId,
    (st: GameState, player: number) => (st.turn.vars[ACTIVE_VAR] === player ? 1 : 0),
  );

  // ─── 失去体力 after-hook:摸3张 + (若出牌阶段)激活红色杀增益 ──────────
  //    挂在'失去体力'而非'造成伤害'(诈降只对失去体力触发,不对伤害触发)。
  registerAfterHook(state, skill.id, ownerId, '失去体力', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; amount?: number };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;

    // 1. 摸3张牌(无条件——任何阶段失去体力都摸)
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 3 });

    // 2. 若处于 owner 的出牌阶段:激活本回合红色杀增益(次数+1 / 红杀无距离 / 红杀不可抵消)
    if (inOwnerPlayPhase(ctx.state, ownerId)) {
      ctx.state.turn.vars[ACTIVE_VAR] = ownerId;
      // 投影到 view.turnUsage,供前端 viewSlashMax / viewCanAttack 判定
      await applyAtom(ctx.state, {
        type: '回合用量',
        player: ownerId,
        key: ACTIVE_VAR,
        value: true,
      });
    }
  });

  // provider 是 WeakMap 注册表,需显式卸载;actions/hooks 随 state-bound 注册表自动清理。
  return () => {
    unloadProvider();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技无主动 action。红色杀增益(无距离/不可抵消/+1次)由杀技能自身读取
  // turn.vars['诈降/active'] 并按卡色分支实现(详见 杀.ts validate/execute)。
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
