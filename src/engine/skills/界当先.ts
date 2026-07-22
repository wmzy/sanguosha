// 界当先(界廖化·锁定技,OL 界限突破官方逐字):
//   回合开始时,你执行一个额外的出牌阶段。此阶段开始时,你可以从牌堆或弃牌堆中
//   获得一张无距离限制的【杀】,然后若你未于此阶段造成过伤害,阶段结束时你对自己
//   造成1点伤害。
//
// 与标版当先的区别(标版未实现;OL 一将成名·廖化 当先):
//   - 标版:"回合开始时,你执行一个额外的出牌阶段"(仅额外出牌阶段,无获取杀与自伤)
//   - 界版:额外出牌阶段开始时可获得无距离限制的杀;若该阶段未造成伤害则结束自伤1点
//
// 实现要点:
//   - 触发:回合开始 after-hook(player===ownerId)。在 回合管理 的回合开始 → 阶段开始(准备)
//     链中插入:额外出牌阶段先于正常准备阶段执行(hook 阻塞链直到额外阶段结束)。
//   - 额外出牌阶段:applyAtom(阶段开始, 出牌) + 出牌窗口循环 + 内联收尾(无 阶段结束 atom,
//     以免触发 回合管理 after-hook 把阶段推进到 弃牌)。循环条件:active 标志 + 玩家存活。
//   - 玩家"结束额外阶段":注册 'end' action(skillId='界当先'),execute 仅置 active=false,
//     循环检测后退出 → 收尾(伤害检查 + 清理)。dispatch 同时 resolve 当前 出牌窗口 pending。
//   - 自伤检查:造成伤害 after-hook 统计 source===ownerId 且 active 期间的伤害总额;
//     额外阶段结束时若 damageInPhase===0,applyAtom(造成伤害, target=自己, source=自己, 1)。
//   - 无距离限制的杀:获取杀时把 cardId 记入 turn.vars['当先/noRangeKillCardId'],
//     杀.use validate 读此变量放行超距目标(在 杀.ts 加最小检查)。
//     杀离开手牌时(after-hook on 移动牌)清除此标记(仅对该张杀生效)。
//   - 超时拦截:出牌窗口.onTimeout 会触发 回合管理 的 end-turn 序列,对额外出牌阶段是错的。
//     拦截:onTimeout 链首个 阶段结束(任意 phase) → 置 active=false + exiting=true + cancel;
//     后续 阶段结束/清过期标记/下一玩家/回合结束 在 exiting=true 时一律 cancel;
//     回合结束 hook 清除 exiting 标志(防泄漏到后续正常回合)。
//   - localVars/turn.vars 键名前缀 '当先/'(界版规范:与显示名一致,不带"界"前缀)。
//   - turn.vars 的 active/exiting/damageInPhase/noRangeKillCardId 均会被 回合结束 atom 自动清空
//     (turn.vars 整体重置),无需手动清理——这里仍显式 delete 以便 hook 重入安全。
//
// 命名:文件名/loader key/character skill name 均为 '界当先'(避开标当先冲突);
//   内部 Skill.name = '当先'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, hasBlockingPending } from '../skill';
import { registerAttackRangeExemptor } from '../distance';

const DISPLAY_NAME = '当先';

/** turn.vars:额外出牌阶段是否激活(true=进行中)。 */
const ACTIVE_KEY = '当先/active';
/** turn.vars:额外出牌阶段正在退出(超时链拦截期间)。 */
const EXITING_KEY = '当先/exiting';
/** turn.vars:本额外出牌阶段累计造成的伤害值。 */
const DMG_IN_PHASE_KEY = '当先/damageInPhase';
/** turn.vars:无距离限制杀的 cardId(仅对当先获得的该张杀生效)。 */
const NORANGE_KILL_KEY = '当先/noRangeKillCardId';

/** localVars:玩家是否选择获得杀。 */
const CONFIRMED_KEY = '当先/confirmed';
/** localVars:玩家选择的杀来源('deck' | 'discard')。 */
const SOURCE_KEY = '当先/sourceChoice';

/** requestType:确认是否获得杀。 */
const CONFIRM_RT = '当先/confirm';
/** requestType:选择杀来源(牌堆 or 弃牌堆)。 */
const SOURCE_RT = '当先/source';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '锁定技:回合开始时执行一个额外的出牌阶段;此阶段开始时可获得一张无距离限制的杀;若未于此阶段造成过伤害,阶段结束时受1点伤害',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:处理 当先/confirm 与 当先/source 两类询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不需要回应';
      const rt = atom.requestType;
      if (rt !== CONFIRM_RT && rt !== SOURCE_RT) return '当前不是当先询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === SOURCE_RT) {
        // confirm=true → 牌堆(deck);confirm=false → 弃牌堆(discard)
        const fromDeck = params.choice === true || params.confirmed === true;
        st.localVars[SOURCE_KEY] = fromDeck ? 'deck' : 'discard';
      }
    },
  );

  // ── end:玩家主动结束额外出牌阶段 ──
  // 仅在额外出牌阶段对 owner 有效;execute 仅置 active=false,循环随后退出 → 收尾。
  registerAction(
    state,
    skill.id,
    ownerId,
    'end',
    (st: GameState, _params: Record<string, Json>): string | null => {
      if (st.turn.vars[ACTIVE_KEY] !== true) return '当前不处于当先额外出牌阶段';
      if (st.phase !== '出牌') return '当前不处于当先额外出牌阶段';
      if (hasBlockingPending(st)) return '请先处理待响应事件';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家已死亡';
      return null;
    },
    async (st: GameState, _params: Record<string, Json>): Promise<void> => {
      // 循环条件检测后退出,由 hook 内联收尾(伤害检查 + 清理)
      st.turn.vars[ACTIVE_KEY] = false;
    },
  );

  // ── 距离豁免器:当先获得的该张杀无距离限制 ──────────────────────
  //   turn.vars[NORANGE_KILL_KEY] 存该张杀的 cardId,predicate 命中时放行。
  //   通过 distance provider 实现,避免污染 杀.ts/distance.ts。
  const unloadRangeExemptor = registerAttackRangeExemptor(
    state,
    ownerId,
    (st, _from, _to, cardId) => {
      if (!cardId) return false;
      return cardId === st.turn.vars[NORANGE_KILL_KEY];
    },
  );

  // ── 回合开始 after-hook:额外出牌阶段主逻辑(锁定技,自动触发) ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 1) 标记进入额外出牌阶段
    ctx.state.turn.vars[ACTIVE_KEY] = true;
    ctx.state.turn.vars[DMG_IN_PHASE_KEY] = 0;
    delete ctx.state.turn.vars[EXITING_KEY];

    // 2) 进入出牌阶段(触发相关 before/after hook)
    await applyAtom(ctx.state, { type: '阶段开始', player: ownerId, phase: '出牌' });

    // 3) 询问:是否获得一张杀?(描述中"你可以",故可选)
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '当先:是否从牌堆或弃牌堆获得一张无距离限制的杀?',
        confirmLabel: '获得杀',
        cancelLabel: '不获得',
      },
      defaultChoice: false,
      timeout: 15,
    });

    if (ctx.state.localVars[CONFIRMED_KEY] === true) {
      // 4) 询问:从哪个区域?(确认=牌堆,取消=弃牌堆)
      delete ctx.state.localVars[SOURCE_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: SOURCE_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '当先:从哪个区域获得杀?',
          confirmLabel: '牌堆',
          cancelLabel: '弃牌堆',
        },
        defaultChoice: false,
        timeout: 15,
      });

      const source = ctx.state.localVars[SOURCE_KEY] as string | undefined;
      const fromZone = source === 'discard' ? '弃牌堆' : '牌堆';
      const zones = source === 'discard'
        ? ctx.state.zones.discardPile
        : ctx.state.zones.deck;
      // 找第一张杀
      let killCardId: string | undefined;
      for (const cid of zones) {
        if (ctx.state.cardMap[cid]?.name === '杀') {
          killCardId = cid;
          break;
        }
      }
      if (killCardId) {
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: killCardId,
          from: { zone: fromZone },
          to: { zone: '手牌', player: ownerId },
        });
        // 标记此杀为无距离限制(被杀.use validate 读取)
        ctx.state.turn.vars[NORANGE_KILL_KEY] = killCardId;
      }
    }

    // 5) 出牌窗口循环(inline await,阻塞本 hook 直到额外阶段结束)
    while (
      ctx.state.turn.vars[ACTIVE_KEY] === true &&
      ctx.state.players[ownerId]?.alive === true
    ) {
      await applyAtom(ctx.state, {
        type: '出牌窗口',
        player: ownerId,
        timeout: 50,
      });
    }

    // 6) 阶段结束:伤害检查(若此阶段未造成过伤害,自伤1点)
    if (
      (ctx.state.turn.vars[DMG_IN_PHASE_KEY] as number | undefined) === 0 &&
      ctx.state.players[ownerId]?.alive === true
    ) {
      await applyAtom(ctx.state, {
        type: '造成伤害',
        target: ownerId,
        source: ownerId,
        amount: 1,
      });
    }

    // 7) 清理(turn.vars 会在 回合结束 atom 整体重置;这里显式清以保 hook 重入安全)
    delete ctx.state.turn.vars[ACTIVE_KEY];
    delete ctx.state.turn.vars[DMG_IN_PHASE_KEY];
    delete ctx.state.turn.vars[EXITING_KEY];
    delete ctx.state.turn.vars[NORANGE_KILL_KEY];
  });

  // ── 造成伤害 after-hook:统计额外出牌阶段内 owner 造成的伤害 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (ctx.state.turn.vars[ACTIVE_KEY] !== true) return;
    const cur = (ctx.state.turn.vars[DMG_IN_PHASE_KEY] as number | undefined) ?? 0;
    ctx.state.turn.vars[DMG_IN_PHASE_KEY] = cur + (atom.amount ?? 0);
  });

  // ── 移动牌 after-hook:无距离杀离开手牌时清除标记(仅对该张杀生效) ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    const tracked = ctx.state.turn.vars[NORANGE_KILL_KEY];
    if (typeof tracked !== 'string') return;
    if (atom.cardId !== tracked) return;
    if (atom.from?.zone !== '手牌') return;
    delete ctx.state.turn.vars[NORANGE_KILL_KEY];
  });

  // ── 超时拦截:end-turn 链(阶段结束→清过期标记→下一玩家→回合结束)在额外阶段无效 ──
  // 首个 阶段结束 触发退出:置 active=false + exiting=true + cancel;
  // 后续 阶段结束/清过期标记/下一玩家 在 exiting=true 时 cancel;
  // 回合结束 清除 exiting 标志(避免泄漏到正常回合)。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段结束',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      // 已在退出中:cancel 后续所有 阶段结束
      if (ctx.state.turn.vars[EXITING_KEY] === true) {
        return { kind: 'cancel' };
      }
      // 额外阶段激活中:首次 阶段结束 触发退出
      if (ctx.state.turn.vars[ACTIVE_KEY] === true) {
        ctx.state.turn.vars[ACTIVE_KEY] = false;
        ctx.state.turn.vars[EXITING_KEY] = true;
        return { kind: 'cancel' };
      }
    },
  );

  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '清过期标记',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      if (ctx.state.turn.vars[EXITING_KEY] !== true) return;
      return { kind: 'cancel' };
    },
  );

  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '下一玩家',
    async (ctx): Promise<HookResult | void> => {
      if (ctx.state.turn.vars[EXITING_KEY] !== true) return;
      // 不带 player 检查:下一玩家 atom 没有 player 字段;仅 exiting 时 cancel
      return { kind: 'cancel' };
    },
  );

  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '回合结束',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      if (ctx.state.turn.vars[EXITING_KEY] !== true) return;
      // 清除 exiting 标志(避免影响后续正常 回合结束)
      delete ctx.state.turn.vars[EXITING_KEY];
      return { kind: 'cancel' };
    },
  );

  return () => {
    unloadRangeExemptor();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'passive',
    prompt: {
      type: 'confirm',
      title: '当先:是否获得一张无距离限制的杀?',
      confirmLabel: '获得杀',
      cancelLabel: '不获得',
    },
  });
  api.defineAction('end', {
    label: '当先·结束额外阶段',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '结束当先额外出牌阶段?',
      confirmLabel: '结束',
      cancelLabel: '继续出牌',
    },
    // turn.vars 不投影到 view,前端无法直接判断额外阶段;后端 validate 兜底
    activeWhen: (ctx) =>
      ctx.view.currentPlayerIndex === ctx.perspectiveIdx && ctx.view.phase === '出牌',
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
