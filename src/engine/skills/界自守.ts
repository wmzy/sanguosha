// 界自守(界刘表·群·主动技,OL 界限突破官方逐字):
//   摸牌阶段,你可以多摸X张牌,你以此法摸牌的结束阶段,
//   若你本回合对其他角色造成过伤害,你弃置X张牌(X为全场势力数)。
//
// 与标版自守(标版未实现)的区别:
//   - 标版:摸牌阶段多摸X张,然后防止你本回合对其他角色造成的伤害。
//   - 界版:多摸X张;若本回合造成过伤害,结束阶段弃X张(惩罚机制,而非防止伤害)。
//   机制完全不同,必须独立界版文件。
//
// 实现要点:
//   - 触发时机:摸牌 before-hook(仅自己摸牌阶段,排除无中生有/遗计/苦肉等)。
//   - X = 全场存活玩家不同势力数(countFactions)。
//   - 主动技:询问是否发动;发动 → modify(count+X) + 设 turn.vars[ACTIVE_VAR]=true。
//   - 本回合伤害追踪:造成伤害 after-hook(source=ownerId, target≠ownerId, amount>0)
//     → turn.vars[DMG_VAR]=true。turn.vars 由「回合结束」atom 自动清空,天然每回合重置。
//   - 弃牌惩罚:阶段开始(回合结束) after-hook(player=ownerId),
//     若 ACTIVE + DMG → 询问玩家选 min(X, handCount) 张手牌弃置。
//     弃牌数封顶为当前手牌数(避免牌不够时 validate 失败)。
//   - 弃牌窗口在「弃牌阶段」之后的「回合结束」阶段,不与系统 __弃牌 冲突。
//
// 命名:文件名/loader key/character skill name 均为 '界自守'(避开标自守冲突);
//   内部 Skill.name = '自守'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import {
  registerAction,
  registerAfterHook,
  registerBeforeHook,
  type SkillModule,
} from '../skill';

const DISPLAY_NAME = '自守';

/** localVars key:玩家是否发动自守(true=发动)。 */
const CONFIRMED_KEY = '自守/confirmed';
/** 询问 requestType:是否发动自守 */
const CONFIRM_RT = '自守/confirm';
/** 询问 requestType:弃牌阶段(自守惩罚) */
const DISCARD_RT = '自守/弃牌';

/** turn.vars key:本回合是否发动了自守(true=已发动)。回合结束自动清空。 */
const ACTIVE_VAR = '自守/active';
/** turn.vars key:本回合 owner 是否对其他角色造成过伤害。回合结束自动清空。 */
const DMG_VAR = '自守/damageDealt';
/** localVars key:玩家选择的弃牌 cardIds。 */
const DISCARD_KEY = '自守/discardCards';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '摸牌阶段可多摸X张(X为全场势力数);若本回合对其他角色造成过伤害,结束阶段弃X张',
  };
}

/** 计算全场存活玩家的不同势力数(X)。 */
function countFactions(state: GameState): number {
  const factions = new Set<string>();
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.faction) factions.add(p.faction);
  }
  return factions.size;
}

/** 当前 pending 的 requestType(类型安全读取) */
function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as { requestType?: string }).requestType;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond action:处理 confirm / 弃牌 两种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT && rt !== DISCARD_RT) {
        return '当前不是自守询问';
      }
      if (rt === CONFIRM_RT) return null; // confirm 类:任意 choice 均可

      // 弃牌类:校验 cardIds
      const cardIds = params.cardIds as string[] | undefined;
      if (!Array.isArray(cardIds) || cardIds.length === 0) return '请选择要弃置的牌';
      const self = st.players[ownerId];
      if (!self) return '玩家不存在';
      for (const id of cardIds) {
        if (typeof id !== 'string' || !self.hand.includes(id)) return `牌 ${id} 不在手牌中`;
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === DISCARD_RT) {
        const ids = params.cardIds as string[] | undefined;
        if (Array.isArray(ids)) st.localVars[DISCARD_KEY] = ids;
      }
    },
  );

  // ── 摸牌 before-hook:摸牌阶段询问,发动则多摸 X 张 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      // 仅自己回合的摸牌阶段(排除无中生有/遗计/苦肉等其他摸牌)
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      if (ctx.state.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      const x = countFactions(ctx.state);
      if (x <= 0) return; // 无势力可计,不发动

      // 询问是否发动
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动自守?(多摸 ${x} 张牌;若本回合对其他角色造成过伤害,结束阶段弃 ${x} 张)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return;

      // 发动:设 ACTIVE 标记 + modify count
      ctx.state.turn.vars[ACTIVE_VAR] = true;
      const count = atom.count ?? 2;
      return { kind: 'modify', atom: { ...ctx.atom, count: count + x } as typeof ctx.atom };
    },
  );

  // ── 造成伤害 after-hook:owner 对其他角色造成过伤害 → 标记 ──
  //    target≠ownerId(对其他角色)、amount>0(被抵消的 0 伤害不算)
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if (atom.target === undefined || atom.target === ownerId) return; // 仅对其他角色
    if ((atom.amount ?? 0) <= 0) return;
    ctx.state.turn.vars[DMG_VAR] = true;
  });

  // ── 阶段开始(回合结束) after-hook:发动过 + 造成过伤害 → 弃 X 张 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.phase !== '回合结束') return;
      if (atom.player !== ownerId) return;

      // 必须发动过自守 + 本回合造成过伤害
      if (!ctx.state.turn.vars[ACTIVE_VAR]) return;
      if (!ctx.state.turn.vars[DMG_VAR]) return;

      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      const x = countFactions(ctx.state);
      if (x <= 0) return;

      // 弃牌数封顶为当前手牌数(牌不够时全弃)
      const handCount = self.hand.length;
      if (handCount === 0) return;
      const discardCount = Math.min(x, handCount);

      // 询问玩家选 discardCount 张手牌弃置
      delete ctx.state.localVars[DISCARD_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: DISCARD_RT,
        target: ownerId,
        prompt: {
          type: 'useCard',
          title: `自守:本回合对其他角色造成过伤害,弃 ${discardCount} 张牌`,
          cardFilter: { filter: () => true, min: discardCount, max: discardCount },
        },
        defaultChoice: undefined,
        timeout: 30,
      });

      const cardIds = ctx.state.localVars[DISCARD_KEY] as string[] | undefined;
      delete ctx.state.localVars[DISCARD_KEY];
      if (cardIds && cardIds.length > 0) {
        await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds });
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '自守',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动自守?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
