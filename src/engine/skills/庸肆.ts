// 庸肆(袁术·群·锁定技,风林火山 hero/100):
//   锁定技,摸牌阶段,你多摸X张牌;弃牌阶段开始时,你弃置X张牌。(X为全场势力数)
//
// 机制:
//   - 摸牌 before hook:仅在自己摸牌阶段的摸牌(区分无中生有/遗计等)modify count += X。
//     锁定技,无需询问,直接 modify。
//   - 弃牌阶段开始 after hook(挂在「阶段开始」):phase==='弃牌' 且为本玩家回合时,
//     强制弃置 X 张牌(玩家选择弃哪 X 张)。锁定技,超时则自动弃手牌前 X 张。
//   - X = 全场存活玩家的不同势力数(袁术本人为群,故 X≥1);不足时弃牌数封顶为手牌数。
//
// 原子操作:
//   摸牌:registerBeforeHook('摸牌') → modify { count: count + X }
//   弃牌:registerAfterHook('阶段开始', phase='弃牌') → 请求回应(选 X 张) → 弃置
//
// 与系统 __弃牌 的关系:庸肆弃牌在「弃牌阶段开始时」触发,先于系统手牌上限弃牌。
//   回合管理的 阶段结束(出牌) after-hook 内先 applyAtom(阶段开始,弃牌)(庸肆 hook 在此
//   串行执行并阻塞至玩家选牌完成),再检查手牌上限创建 __弃牌 —— 故顺序正确。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';

/** 弃牌选择询问的 requestType(前缀=技能id,符合 T1)。 */
const DISCARD_RT = '庸肆/弃牌';
/** localVars key:玩家选择的弃牌 cardIds(respond 写,after-hook 读)。 */
const DISCARD_CHOICE = '庸肆/弃牌选择';
/** localVars key:本次需弃置的牌数(after-hook 写,respond validate 读)。 */
const DISCARD_COUNT = '庸肆/弃牌数';

/** 全场存活玩家的不同势力数(X)。袁术本人为群,故下限 1。 */
function aliveFactionCount(state: GameState): number {
  const factions = new Set<string>();
  for (const p of state.players) {
    if (p.alive && p.faction) factions.add(p.faction);
  }
  return Math.max(1, factions.size);
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '庸肆',
    description: '锁定技,摸牌阶段你多摸X张牌;弃牌阶段开始时你弃置X张牌(X为全场势力数)',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 摸牌 before hook:摸牌阶段多摸 X 张(锁定技,直接 modify) ──
  const unloadDraw = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      // 仅自己摸牌阶段的摸牌(排除无中生有/遗计/苦肉等其他摸牌)
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      if (ctx.state.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      const X = aliveFactionCount(ctx.state);
      const count = atom.count ?? 2;
      return { kind: 'modify', atom: { ...ctx.atom, count: count + X } as typeof ctx.atom };
    },
  );

  // ── 弃牌阶段开始 after hook:强制弃置 X 张牌 ──
  const unloadDiscardHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.phase !== '弃牌') return;
      if (atom.player !== ownerId) return;
      const st = ctx.state;
      const self = st.players[ownerId];
      if (!self?.alive) return;

      const X = aliveFactionCount(st);
      const toDiscard = Math.min(X, self.hand.length);
      if (toDiscard <= 0) return;

      // 询问玩家选择弃置的 X 张牌(锁定技:超时自动弃)
      delete st.localVars[DISCARD_CHOICE];
      st.localVars[DISCARD_COUNT] = toDiscard;
      await applyAtom(st, {
        type: '请求回应',
        requestType: DISCARD_RT,
        target: ownerId,
        prompt: {
          type: 'useCard',
          title: `庸肆:弃置 ${toDiscard} 张牌`,
          cardFilter: { filter: () => true, min: toDiscard, max: toDiscard },
        },
        // 锁定技:必须弃,前端隐藏"不回应"按钮;超时由下方兜底自动弃
        mandatory: true,
        timeout: 30,
      });

      // 读取玩家选择;超时(未设)或不合法则自动弃手牌前 toDiscard 张
      const me = st.players[ownerId];
      const chosen = st.localVars[DISCARD_CHOICE] as string[] | undefined;
      delete st.localVars[DISCARD_CHOICE];
      delete st.localVars[DISCARD_COUNT];
      const chosenValid =
        Array.isArray(chosen) &&
        chosen.length === toDiscard &&
        chosen.every((id) => me.hand.includes(id));
      const cardIds = chosenValid ? chosen : me.hand.slice(0, toDiscard);
      await applyAtom(st, { type: '弃置', player: ownerId, cardIds });
    },
  );

  // ── respond:玩家选择弃置的牌(写 localVars,实际弃置由 after-hook 统一执行) ──
  const unloadRespond = registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是庸肆弃牌窗口';
      const atom = slot.atom as { requestType?: string; target: number };
      if (atom.requestType !== DISCARD_RT) return '当前不是庸肆弃牌窗口';
      if (atom.target !== ownerId) return '不是你的庸肆弃牌';
      const cardIds = params.cardIds;
      if (!Array.isArray(cardIds)) return 'cardIds required';
      const need = st.localVars[DISCARD_COUNT] as number | undefined;
      if (typeof need === 'number' && cardIds.length !== need) return `需弃置 ${need} 张牌`;
      const player = st.players[ownerId];
      if (!player) return 'target not found';
      for (const id of cardIds) {
        if (typeof id !== 'string' || !player.hand.includes(id)) return `card ${id} not in hand`;
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[DISCARD_CHOICE] = params.cardIds;
    },
  );

  return () => {
    unloadDraw();
    unloadDiscardHook();
    unloadRespond();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '庸肆',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '庸肆:选择弃置的牌',
      cardFilter: { filter: () => true, min: 1, max: 99 },
    },
    activeWhen: (ctx) => {
      const slot = ctx.view.pending;
      if (!slot) return false;
      if (slot.target !== ctx.perspectiveIdx) return false;
      const atom = slot.atom as { type: string; requestType?: string };
      return atom.type === '请求回应' && atom.requestType === DISCARD_RT;
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
