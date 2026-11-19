// 好施(鲁肃·吴·主动技):摸牌阶段，你可以额外摸两张牌，
// 若此时你的手牌数超过五张，你必须将一半（向下取整）的手牌
// 交给除你外手牌数最少的一名角色。
//
// 机制(镜像英姿,但 +2 且触发强制给牌):
//   - before hook 挂在「摸牌」:仅在自己摸牌阶段的摸牌(区分无中生有/遗计等)
//     询问是否发动。发动则 modify(count+2),并设 ACTIVE 标记。
//   - after hook 挂在「摸牌」:若 ACTIVE 标记存在且手牌 > 5,
//     找到除自己外手牌最少的存活角色(并列则询问选择),
//     询问鲁肃选择 floor(handCount/2) 张牌给予该角色(给予 atom)。
//   - 每回合限一次:`${prefix}/usedThisTurn`(once-per-turn)防重入,由「回合结束」atom 自动清空。
//
// 本文件同时导出好施族共享核心(registerHaoshiDrawHooks/applyHaoshiDrawRespond):
// 标/界的摸牌 before/after hooks 与 respond 的 confirm/target/give 三分支逐字相同,
// 仅 localVars/requestType 键前缀不同('好施' vs '界好施',同对局两版共存时键空间隔离),
// 询问文案不含前缀(标/界官方同名,玩家可见文案一致)。界好施.ts 消费这些导出,
// 只写"直到下回合开始的被动给牌"差异段。
import type {
  FrontendAPI,
  GameView,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { usedThisTurn, markOncePerTurn } from '../rules/once-per-turn';
import {
  registerAction,
  registerBeforeHook,
  registerAfterHook,
} from '../core/skill';
import type { SkillModule } from '../types';
import {
  askConfirm,
  defineConfirmAction,
  firstTarget,
  requireRequestType,
  currentRequestType,
} from '../util/skillRuntime';

const PREFIX = '好施';
const CONFIRM_RT = '好施/confirm'; // 鲁肃:是否发动好施
const CHOOSE_TARGET_RT = '好施/target'; // 鲁肃:并列时选目标
const GIVE_RT = '好施/give'; // 鲁肃:选牌给出

/** 好施族摸牌 hooks 注册参数。 */
export interface HaoshiDrawOptions {
  /** localVars/requestType 键前缀('好施' / '界好施',同对局两版共存时键空间隔离);
   *  每回合限一次的 vars 键亦用此前缀。 */
  prefix: string;
  /** 分半给牌完成后的回调(界版在此激活"直到下回合开始"的跨回合被动)。 */
  afterGive?: (state: GameState, target: number) => void;
}

/**
 * 注册好施族摸牌 hooks(标/界机制逐字相同,仅键前缀不同):
 *   - before hook:仅对自己回合摸牌阶段的摸牌询问是否发动,发动则 count+2 并设 ACTIVE 标记;
 *   - after hook:ACTIVE 标记存在且手牌 > 5 时,把一半(向下取整)手牌交给除自己外
 *     手牌最少的存活角色(并列则询问选择),完成后调用 opts.afterGive(如有)。
 *
 * @returns 每个 hook 的 unloader 列表(标版历史行为不持有 unloader,调用方可忽略)。
 */
export function registerHaoshiDrawHooks(
  state: GameState,
  skillId: string,
  ownerId: number,
  opts: HaoshiDrawOptions,
): Array<() => void> {
  const { prefix } = opts;
  const CONFIRM_RT = `${prefix}/confirm`;
  const CHOOSE_TARGET_RT = `${prefix}/target`;
  const GIVE_RT = `${prefix}/give`;
  const CONFIRMED_KEY = `${prefix}/confirmed`;
  const ACTIVE_KEY = `${prefix}/active`; // before 设,after 读,确保仅对好施的摸牌生效
  const TARGET_KEY = `${prefix}/chosenTarget`;
  const GIVE_KEY = `${prefix}/giveCards`;

  const unloaders: Array<() => void> = [];

  // ── 摸牌 before hook:摸牌阶段询问,发动则额外摸两张 ──
  unloaders.push(
    registerBeforeHook(
      state,
      skillId,
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
        if (usedThisTurn(ctx.state, ownerId, prefix)) return; // 本回合已发动

        // 询问是否发动
        const confirmed = await askConfirm(ctx.state, CONFIRM_RT, ownerId, {
          confirmedKey: CONFIRMED_KEY,
          title: '是否发动好施?(额外摸两张牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
          defaultChoice: false,
          timeout: 15,
        });
        if (!confirmed) return;

        // 发动:限一次标记 + ACTIVE 标记(防 dispatch 重入)
        await markOncePerTurn(ctx.state, ownerId, prefix);
        ctx.state.localVars[ACTIVE_KEY] = true;

        const count = atom.count ?? 2;
        return { kind: 'modify', atom: { ...ctx.atom, count: count + 2 } as typeof ctx.atom };
      },
    ),
  );

  // ── 摸牌 after hook:若手牌 > 5,给牌给手牌最少的角色 ──
  unloaders.push(
    registerAfterHook(
      state,
      skillId,
      ownerId,
      '摸牌',
      async (ctx): Promise<void> => {
        const atom = ctx.atom;
        if (atom.player !== ownerId) return;
        if (!ctx.state.localVars[ACTIVE_KEY]) return;
        delete ctx.state.localVars[ACTIVE_KEY];

        const st = ctx.state;
        const self = st.players[ownerId];
        if (!self?.alive) return;
        const handCount = self.hand.length;
        if (handCount <= 5) return; // 不超过五张,无需给牌

        const giveCount = Math.floor(handCount / 2);

        // 找除自己外手牌最少的存活角色
        let minCount = Infinity;
        const candidates: number[] = [];
        for (const p of st.players) {
          if (p.index === ownerId || !p.alive) continue;
          if (p.hand.length < minCount) {
            minCount = p.hand.length;
            candidates.length = 0;
            candidates.push(p.index);
          } else if (p.hand.length === minCount) {
            candidates.push(p.index);
          }
        }
        if (candidates.length === 0) return;

        let target: number;
        if (candidates.length === 1) {
          target = candidates[0];
        } else {
          // 并列:询问选择
          delete st.localVars[TARGET_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: CHOOSE_TARGET_RT,
            target: ownerId,
            prompt: {
              type: 'choosePlayer',
              title: '好施:选择手牌最少的角色(给予手牌)',
              min: 1,
              max: 1,
              filter: (_view: GameView, t: number) => candidates.includes(t),
            },
            timeout: 15,
          });
          const chosen = st.localVars[TARGET_KEY] as number | undefined;
          delete st.localVars[TARGET_KEY];
          if (typeof chosen !== 'number') return;
          target = chosen;
        }

        // 询问选择 giveCount 张牌给出
        delete st.localVars[GIVE_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: GIVE_RT,
          target: ownerId,
          prompt: {
            type: 'useCard',
            title: `好施:选择 ${giveCount} 张牌交给 ${st.players[target].name}`,
            cardFilter: { filter: () => true, min: giveCount, max: giveCount },
          },
          // 强制型给牌(「分半给最少者」是效果必要部分):前端走多选弃牌式 UI 提交 {cardIds}
          mandatory: true,
          timeout: 30,
        });
        let giveCards = st.localVars[GIVE_KEY] as string[] | undefined;
        delete st.localVars[GIVE_KEY];
        // 强制给牌兜底:超时未回应 → 自动从手牌首张起补足(不放弃给牌义务,
        // 与庸肆/英魂/成略的 mandatory 兜底范式一致)
        if (!giveCards || giveCards.length === 0) {
          giveCards = st.players[ownerId]?.hand.slice(0, giveCount) ?? [];
        }
        if (giveCards && giveCards.length > 0) {
          for (const cardId of giveCards) {
            await applyAtom(st, { type: '给予', cardId, from: ownerId, to: target });
          }
          opts.afterGive?.(st, target);
        }
      },
    ),
  );

  return unloaders;
}

/**
 * 好施族 respond execute 的 confirm/target/give 三分支(标/界逐字相同):
 * 把回应写入 prefix 派生的 localVars 键。give 分支校验「恰好 N 张且全为本人手牌」
 * (strictGiveIds=true 时额外拒绝重复牌,界版守卫)——非法提交不写 GIVE_KEY,
 * 让 after-hook 走兜底给牌,防 给予 atom validate 抛错打断技能结算。
 *
 * @returns rt 是否属于好施族三分支(已消费;界版据此继续判断 passiveGive 分支)。
 */
export function applyHaoshiDrawRespond(
  st: GameState,
  seat: number,
  rt: string | undefined,
  params: Record<string, Json>,
  prefix: string,
  strictGiveIds = false,
): boolean {
  const CONFIRM_RT = `${prefix}/confirm`;
  const CHOOSE_TARGET_RT = `${prefix}/target`;
  const GIVE_RT = `${prefix}/give`;
  const CONFIRMED_KEY = `${prefix}/confirmed`;
  const TARGET_KEY = `${prefix}/chosenTarget`;
  const GIVE_KEY = `${prefix}/giveCards`;

  if (rt === CONFIRM_RT) {
    st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    return true;
  }
  if (rt === CHOOSE_TARGET_RT) {
    const t = firstTarget(params);
    if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
    return true;
  }
  if (rt === GIVE_RT) {
    const ids = params.cardIds as string[] | undefined;
    // 校验:恰好 N 张、全部为本人手牌(、无重复——strictGiveIds)
    const need = (
      st.pendingSlots.get(seat)?.atom as
        | { prompt?: { cardFilter?: { min?: number } } }
        | undefined
    )?.prompt?.cardFilter?.min;
    if (
      Array.isArray(ids) &&
      typeof need === 'number' &&
      ids.length === need &&
      (!strictGiveIds || new Set(ids).size === ids.length) &&
      ids.every((id) => st.players[seat]?.hand.includes(id))
    ) {
      st.localVars[GIVE_KEY] = ids;
    }
    return true;
  }
  return false;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '好施',
    description:
      '摸牌阶段，你可以额外摸两张牌，若此时你的手牌数超过五张，你必须将一半（向下取整）的手牌交给除你外手牌数最少的一名角色',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond action:处理 confirm/target/give 三种询问(三分支为标/界共享实现)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      return requireRequestType(st, ownerId, [CONFIRM_RT, CHOOSE_TARGET_RT, GIVE_RT], {
        mismatchError: '当前不是好施询问',
      }).error;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      applyHaoshiDrawRespond(st, ownerId, currentRequestType(st, ownerId), params, PREFIX);
    },
  );

  // ── 摸牌 before/after hooks:发动 +2 摸、>5 分半给最少者(标/界共享实现)──
  // 标版历史行为:不持有 unloader(保持原卸载语义不变)。
  registerHaoshiDrawHooks(state, skill.id, ownerId, { prefix: PREFIX });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  defineConfirmAction(api, 'respond', {
    label: '好施',
    title: '好施',
    confirmLabel: '确认',
    cancelLabel: '取消',
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
