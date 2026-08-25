// 掣政(孙亮·吴·锁定技,风林火山 hero/403):
//   "你防止于你的出牌阶段对攻击范围内不包含你的角色造成的伤害。
//    出牌阶段结束时,若你本阶段使用的牌数小于这些角色数,你弃置其中一名角色一张牌。"
//
// 机制(三段):
//   1) 伤害结算开始时 beforeHook:source===自己 && 自己出牌阶段 && 目标攻击范围内不含自己
//      → cancel(防止整段伤害流程,同绝情)。
//   2) 使用时 afterHook:自己出牌阶段使用牌时,turn.vars['掣政/出牌数'] += 1。
//   3) 阶段结束(出牌) beforeHook(自己):若 出牌数 < "攻击范围内不含自己的角色数",
//      choosePlayer 选其中一名 → 弃置其一张牌(优先手牌,其次装备)。
//
// 关键点:
//   - "攻击范围内不包含你的角色":!inAttackRange(state, 目标, 自己) —— 从目标看自己的距离。
//   - 防止伤害用 伤害结算开始时 cancel:跳过整段流程(不触发造成/受到伤害后 hook)。
//   - "使用的牌数":使用时 atom 计数(装备/锦囊/基本牌均算;打出闪/回应不算)。
//   - 弃牌目标:仅限有牌(手牌或装备)的"这些角色";1 名则自动选定,多名则询问。
//   - 弃哪张:手牌优先(hand[0]),无手牌则首件装备(描述未指定选牌,引擎自动选定)。
import type { FrontendAPI, GameState, GameView, Json, Skill } from '../types';
import type { SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { inAttackRange } from '../rules/distance';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';

const CHOOSE_RT = '掣政/选目标';
const CHOOSE_KEY = '掣政/所选目标';
const USED_KEY = '掣政/出牌数'; // turn.vars key

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '掣政',
    description:
      '锁定技:防止你出牌阶段对攻击范围内不含你的角色造成的伤害;出牌阶段结束时若用牌数少于这些角色数,弃置其中一名角色一张牌',
    isLocked: true,
  };
}

/** 攻击范围内不包含 ownerId 的存活其他角色 */
function outOfRangeChars(state: GameState, ownerId: number): number[] {
  const result: number[] = [];
  for (const p of state.players) {
    if (p.index === ownerId || !p.alive) continue;
    if (!inAttackRange(state, p.index, ownerId)) result.push(p.index);
  }
  return result;
}

/** 角色是否有任意牌(手牌或装备)可供弃置 */
function hasAnyCard(state: GameState, idx: number): boolean {
  const p = state.players[idx];
  if (!p) return false;
  if (p.hand.length > 0) return true;
  return Object.values(p.equipment).some((id) => !!id);
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 1) 伤害结算开始时 beforeHook:防止远距离伤害 ──
  registerBeforeHook(state, skill.id, ownerId, '伤害结算开始时', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    const st = ctx.state;
    if (st.phase !== '出牌') return;
    if (st.currentPlayerIndex !== ownerId) return;
    // 目标的攻击范围内不含自己 → 防止伤害(跳过整段伤害流程)
    if (!inAttackRange(st, atom.target, ownerId)) {
      return { kind: 'cancel' };
    }
    return;
  });

  // ── 2) 使用时 afterHook:累计出牌阶段用牌数 ──
  registerAfterHook(state, skill.id, ownerId, '使用时', async (ctx) => {
    const st = ctx.state;
    if (st.phase !== '出牌') return;
    if (ctx.atom.source !== ownerId) return;
    const prev = (st.turn.vars[USED_KEY] as number | undefined) ?? 0;
    st.turn.vars[USED_KEY] = prev + 1;
  });

  // ── 3) 阶段结束(出牌) beforeHook:用牌不足则弃他人牌 ──
  registerBeforeHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;

    const used = (st.turn.vars[USED_KEY] as number | undefined) ?? 0;
    // 触发基数 = 全部"攻击范围内不包含你的角色数"(官方:「小于这些角色数」,
    // 不因个别角色无牌而缩小);可弃置目标从其中有牌者中选。
    const outRange = outOfRangeChars(st, ownerId);
    if (used >= outRange.length) return;
    const targets = outRange.filter((t) => hasAnyCard(st, t));
    // 无有牌可弃的目标 → 无从执行惩罚,跳过
    if (targets.length === 0) return;

    await pushFrame(st, '掣政', ownerId, {});

    // 选其中一名角色(1 名自动选定,多名则询问)
    let chosen: number;
    if (targets.length === 1) {
      chosen = targets[0];
    } else {
      delete st.localVars[CHOOSE_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CHOOSE_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '掣政:你本阶段用牌数不足,选择一名角色弃置其一张牌',
          min: 1,
          max: 1,
          candidates: targets,
          filter: (view: GameView, t: number) =>
            t !== ownerId && view.players[t]?.alive === true,
        },
        timeout: 30,
      });
      const picked = st.localVars[CHOOSE_KEY] as number | undefined;
      delete st.localVars[CHOOSE_KEY];
      if (typeof picked !== 'number' || !targets.includes(picked)) {
        await popFrame(st);
        return;
      }
      chosen = picked;
    }

    // 弃置其一张牌:优先手牌 hand[0],其次首件装备
    const tp = st.players[chosen];
    if (tp?.alive) {
      let discardId: string | undefined;
      if (tp.hand.length > 0) {
        discardId = tp.hand[0];
      } else {
        const equipIds = Object.values(tp.equipment).filter(
          (id): id is string => !!id,
        );
        if (equipIds.length > 0) discardId = equipIds[0];
      }
      if (discardId) {
        await applyAtom(st, { type: '弃置', player: chosen, cardIds: [discardId] });
      }
    }

    await popFrame(st);
  });

  // ── respond action:处理 选目标(多名候选时) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是掣政窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== CHOOSE_RT) return '当前不是掣政窗口';
      const t =
        (params.targets as number[] | undefined)?.[0] ??
        (typeof params.target === 'number' ? params.target : undefined);
      if (typeof t !== 'number') return '请选择一名角色';
      if (t === ownerId) return '不能选择自己';
      if (!st.players[t]?.alive) return '目标不合法';
      // 必须是攻击范围内不含自己的角色
      if (inAttackRange(st, t, ownerId)) return '只能选择攻击范围内不包含你的角色';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const t =
        (params.targets as number[] | undefined)?.[0] ??
        (typeof params.target === 'number' ? params.target : undefined);
      if (typeof t === 'number') st.localVars[CHOOSE_KEY] = t;
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
