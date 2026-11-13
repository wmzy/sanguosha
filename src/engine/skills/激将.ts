// 激将(刘备·主公技):
//   主公技,其他蜀势力角色可以在你需要时代替你使用或打出【杀】(视为由你使用或打出)。
//
// 本文件同时承载标版/界版的共享实现(registerJijiangUseAction /
// registerJijiangRespondActions / mountJijiangActions):界激将.ts import 并注入
// 界版差异(被动摸牌 hook 与 respond 第三分支)。标界同构的部分:use(主动代使用)
// 的校验与执行、respond 全座次注册的 响应型(代打出)/主动型(代使用) 两分支、
// onMount 前端动作。界版真实增量:回合外蜀角色用杀可令主公摸牌(见 界激将.ts)。
//
// 两种触发场景(官方"你需要时"):
//   1. 主动使用(use):出牌阶段,主公请求一名蜀势力角色代替使用一张【杀】(指定 killTarget)。
//   2. 响应打出(respond):主公被询问杀时(决斗/南蛮入侵等需要打出【杀】的场景),
//      主公发动激将,按座次逐个询问其他蜀势力角色是否打出一张【杀】(视为主公打出)。
//      第一个出杀的蜀角色:杀牌进处理区 → 调用方(决斗/南蛮入侵)检查处理区有杀 = 已出。
//      全部拒绝:处理区无杀 = 未出(主公承受原结算)。
//
// respond 注册(全座次,按 pending 内容分支,一个座次仅一个 respond):
//   - 代打出(atom.type==='询问杀', 主公 seat):主公被询问杀时,逐个请求蜀角色经
//     '杀/respondKill'(复用 杀.respond)把杀牌移入处理区,调用方(决斗/南蛮)检查
//     处理区判断已出。全部拒绝 → 主公承受原结算。
//   - 代使用(requestType==='激将/出杀', 蜀角色 seat):主动激将时,蜀角色选杀+
//     指定 killTarget,use execute 读 localVars['激将/出杀选择'] → runUseFlow(none)
//     走完整杀结算,damageType 由 cardMap 自动传导(火杀/雷杀不丢)。
import type { GameState, FrontendAPI, GameView, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame, frameCards } from '../core/frame';
import { runUseFlow } from './cards/use-card';
import { registerAction, declareAlternativeResponse } from '../core/skill';
import { engineCanPlayNow } from '../util/skillRuntime';
import { inAttackRange } from '../rules/distance';
import { defaultPlayActive, isLordOwner } from '../rules/action-active';

// use(代使用)路径的 localVars 键 / requestType 常量(对齐 乱武/借刀杀人 风格)
const REQUEST_TYPE = '激将/出杀';
const CHOICE_VAR = '激将/出杀选择';
const KILL_TARGET_VAR = '激将/killTarget';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '激将',
    description: '主公技,其他蜀势力角色可以在你需要时代替你使用或打出【杀】(视为由你使用或打出)',
  };
}

/** 主动代使用(use action)的标版/界版差异配置。 */
export interface JijiangUseOptions {
  /** 帧名与询问标题前缀('激将'|'界激将') */
  readonly displayName: string;
  /** 主动代使用 requestType('激将/出杀'|'界激将/出杀') */
  readonly requestType: string;
  /** 代使用选择 localVars 键 */
  readonly choiceVar: string;
  /** killTarget localVars 键 */
  readonly killTargetVar: string;
  /** use validate 失败文案 */
  readonly useError: string;
}

/** 注册主动激将 use action(标版/界版共用)。返回卸载函数。 */
export function registerJijiangUseAction(
  state: GameState,
  skill: Skill,
  opts: JijiangUseOptions,
): () => void {
  const ownerId = skill.ownerId;
  return registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 → engineCanPlayNow(见下方 ok)
      // 激将是主公技:仅主公位可用(以主公位 ownerId===0 为依据)
      const isLord = ownerId === 0;
      // 目标合法:不是自己 + 存活 + 蜀势力
      const targetIdx = params.target as number | undefined;
      const targetExists = typeof targetIdx === 'number' && !!state.players[targetIdx];
      const target = targetExists ? state.players[targetIdx] : null;
      const targetNotSelf = targetIdx !== ownerId;
      const targetAlive = target?.alive === true;
      const targetShu = target?.faction === '蜀';
      // killTarget 校验:可选,若提供则需存活且≠target
      const killTargetIdx = params.killTarget as number | undefined;
      const killTargetValid =
        killTargetIdx === undefined ||
        (state.players[killTargetIdx]?.alive === true && killTargetIdx !== targetIdx);
      const ok =
        engineCanPlayNow(state, ownerId) &&
        isLord &&
        targetExists &&
        targetNotSelf &&
        targetAlive &&
        targetShu &&
        killTargetValid;
      return ok ? null : opts.useError;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;
      const killTarget = params.killTarget as number | undefined;
      await pushFrame(state, opts.displayName, from, { ...params });

      // 存 killTarget 供 respond(出杀分支)权威校验必含目标;结算后清理
      if (typeof killTarget === 'number') {
        state.localVars[opts.killTargetVar] = killTarget;
      }

      // 请求回应:蜀角色选一张杀 + 指定目标(固定=killTarget),经 出杀 respond
      const killTargetName =
        typeof killTarget === 'number' ? (state.players[killTarget]?.name ?? '?') : '?';
      await applyAtom(state, {
        type: '请求回应',
        requestType: opts.requestType,
        target,
        prompt: {
          type: 'useCardAndTarget',
          title: `${opts.displayName}:对 ${killTargetName} 使用一张杀`,
          cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
          // killTarget 已知时固定该目标;未知时(退化场景)允许任一非自己目标
          targetFilter: {
            min: 1,
            max: 1,
            filter: (_v, t: number) =>
              typeof killTarget === 'number' ? t === killTarget : t !== target,
          },
        },
        timeout: 15,
      });

      const choice = state.localVars[opts.choiceVar] as
        | { cardId: string; targets: number[] }
        | undefined;
      delete state.localVars[opts.choiceVar];
      delete state.localVars[opts.killTargetVar];

      // 官方:出杀 → 走完整杀结算(runUseFlow→杀.resolveSlash),
      //      damageType 由 cardMap 自动传导(火杀/雷杀不再丢失);
      //      不出杀无效果。
      if (choice?.cardId && Array.isArray(choice.targets) && choice.targets.length > 0) {
        await runUseFlow(state, target, choice.cardId, choice.targets, '杀');
      }

      await popFrame(state);
    },
  );
}

/** 全座次 respond action 的标版/界版差异配置。 */
export interface JijiangRespondOptions {
  /** 询问标题前缀('激将'|'界激将') */
  readonly displayName: string;
  /** 主动代使用 requestType('激将/出杀'|'界激将/出杀') */
  readonly useRequestType: string;
  /** 代使用选择 localVars 键 */
  readonly useChoiceVar: string;
  /** killTarget localVars 键 */
  readonly killTargetVar: string;
  /** 非激将询问的兜底文案 */
  readonly respondError: string;
  /** 代打出循环内处理区出现杀后的钩子(界版:记录替打蜀角色供 询问杀 after-hook) */
  readonly onSubstituteKill?: (st: GameState, allyIdx: number) => void;
  /** 额外接受的 requestType(界版被动型 drawChoice) */
  readonly extraRequestTypes?: readonly string[];
  /** 额外分支的 execute(界版:记录是否令主公摸牌) */
  readonly onExtraRequest?: (
    st: GameState,
    seat: number,
    requestType: string,
    params: Record<string, Json>,
  ) => void;
}

/**
 * 注册激将的全座次 respond action(标版/界版共用),按 pending 内容分支:
 *   询问杀(主公 seat)= 响应型代打出;useRequestType(蜀角色 seat)= 主动型代使用;
 *   extraRequestTypes = 界版被动型等额外窗口。
 * 返回各座次的卸载函数列表。
 */
export function registerJijiangRespondActions(
  state: GameState,
  skill: Skill,
  opts: JijiangRespondOptions,
): Array<() => void> {
  const unloaders: Array<() => void> = [];
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          const atom = slot.atom as { type: string; requestType?: string };

          // ── 响应型(代打出):主公被询问杀 → 逐个请求蜀角色出杀 ──
          if (atom.type === '询问杀') {
            const self = st.players[seat];
            if (!self?.alive) return '玩家不存在或已死亡';
            // 主公技:仅主公位可用
            if (seat !== 0) return '仅主公可用';
            // 必须有其他蜀势力存活角色(有手牌)
            const hasShuAllies = st.players.some(
              (p) => p.alive && p.index !== seat && p.faction === '蜀' && p.hand.length > 0,
            );
            if (!hasShuAllies) return '没有可出杀的蜀势力角色';
            return null;
          }

          // ── 主动型(代使用):蜀角色选杀 + 指定 killTarget ──
          if (atom.requestType === opts.useRequestType) {
            const cardId = params.cardId as string | undefined;
            const targets = params.targets as number[] | undefined;
            if (typeof cardId !== 'string') return '请选择一张杀';
            if (!Array.isArray(targets) || targets.length === 0) return '请选择目标';
            const self = st.players[seat];
            if (!self?.hand.includes(cardId)) return '牌不在手牌中';
            if (st.cardMap[cardId]?.name !== '杀') return '只能使用杀';
            // 必含主公指定的 killTarget(权威,前端 targetFilter 仅提示)
            const killTarget = st.localVars[opts.killTargetVar] as number | undefined;
            if (typeof killTarget === 'number' && !targets.includes(killTarget))
              return '必须包含激将指定的目标';
            // 每个目标须在蜀角色攻击范围内(镜像 杀.canUse 距离校验)
            for (const t of targets) {
              if (!inAttackRange(st, seat, t, cardId)) return '目标不在攻击范围内';
            }
            return null;
          }

          // ── 额外窗口(界版被动型 drawChoice):放行,execute 记录选择 ──
          if (atom.requestType !== undefined && opts.extraRequestTypes?.includes(atom.requestType)) {
            return null;
          }

          return opts.respondError;
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(seat);
          const atom = slot?.atom as { type: string; requestType?: string } | undefined;

          // ── 响应型(代打出):逐个请求蜀角色出杀,第一个出杀即止 ──
          if (atom?.type === '询问杀') {
            // 从主公起逆时针逐个询问蜀势力角色
            const numPlayers = st.players.length;
            for (let offset = 1; offset < numPlayers; offset++) {
              const allyIdx = (seat - offset + numPlayers) % numPlayers;
              const ally = st.players[allyIdx];
              if (!ally?.alive) continue;
              if (ally.faction !== '蜀') continue;
              if (ally.hand.length === 0) continue;

              // 询问该蜀势力角色是否打出杀(复用 '杀/respondKill' requestType,
              // 蜀角色通过自身 '杀' 技能 respond 把杀牌移入处理区,视为主公打出)
              await applyAtom(st, {
                type: '请求回应',
                requestType: '杀/respondKill',
                target: allyIdx,
                prompt: {
                  type: 'useCard',
                  title: `${opts.displayName}:主公(${st.players[seat]?.name ?? `P${seat}`})需要杀,是否打出一张杀?`,
                  cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
                },
                timeout: 15,
              });

              // 检查处理区:有杀 = 已出,激将结束(杀牌留在处理区供调用方检查)
              const killCardId = frameCards(st).find((id) => {
                const c = st.cardMap[id];
                return c?.name === '杀';
              });
              if (killCardId) {
                // 界版:记录替打的蜀角色(供 询问杀 after-hook 判定"替你打出"触发)
                opts.onSubstituteKill?.(st, allyIdx);
                return;
              }
              // 该角色拒绝/无杀,继续询问下一个
            }
            // 全部拒绝:处理区无杀,execute 结束,主公承受原结算
            return;
          }

          // ── 主动型(代使用):记录蜀角色的出杀选择 ──
          if (atom?.requestType === opts.useRequestType) {
            st.localVars[opts.useChoiceVar] = {
              cardId: params.cardId as string,
              targets: params.targets as number[],
            };
            return;
          }

          // ── 额外窗口(界版被动型):记录选择 ──
          if (
            atom?.requestType !== undefined &&
            opts.extraRequestTypes?.includes(atom.requestType)
          ) {
            opts.onExtraRequest?.(st, seat, atom.requestType, params);
          }
        },
      ),
    );
  }
  return unloaders;
}

/** onMount 的标版/界版差异配置。 */
export interface JijiangMountOptions {
  /** 动作 label('激将'|'界激将') */
  readonly label: string;
  /** use 动作 choosePlayer 标题(逐字保留:标版半角冒号,界版全角冒号) */
  readonly useTitle: string;
  /** respond 动作 confirm 标题 */
  readonly respondTitle: string;
  /** 主动代使用 requestType */
  readonly useRequestType: string;
  /** respond activeWhen 额外接受的 requestType(界版被动型 drawChoice) */
  readonly extraRequestTypes?: readonly string[];
}

/** 注册 use/respond 前端动作(标版/界版共用)。 */
export function mountJijiangActions(
  skill: Skill,
  api: FrontendAPI,
  opts: JijiangMountOptions,
): (() => void) | void {
  // use:主动激将(出牌阶段选择蜀角色)
  api.defineAction('use', {
    label: opts.label,
    style: 'primary',
    prompt: {
      type: 'choosePlayer',
      title: opts.useTitle,
      min: 1,
      max: 1,
      // 其他蜀势力角色(与后端 validate 同源):缺 filter 时无头枚举退化为全体存活角色
      // (含自己与非蜀)→ 提交恒拒「现在不能使用激将」。
      filter: (view: GameView, t: number) =>
        t !== skill.ownerId && view.players[t]?.alive === true && view.players[t]?.faction === '蜀',
    },
    // 门槛与后端 validate 同源(isActiveAction 是 replace 语义,activeWhen 必须整体
    // 重述默认出牌门槛,不能只判主公位):
    //   defaultPlayActive = 自己回合 + 出牌阶段 + 无阻塞 pending(validate 的 myTurn/inActPhase/free)
    //   isLordOwner      = 主公位 ownerId===0(validate 的主公技门槛)
    // 只判主公位会放行别人回合/阻塞询问中的枚举 → 提交恒拒。
    activeWhen: (ctx) => defaultPlayActive(ctx) && isLordOwner(skill.ownerId),
  });
  // respond:响应型激将(被询问杀时激活)
  api.defineAction('respond', {
    label: opts.label,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: opts.respondTitle,
      confirmLabel: '激将',
      cancelLabel: '不发动',
    },
    activeWhen: (ctx) => {
      const slot = ctx.view.pending;
      if (!slot) return false;
      if (slot.target !== ctx.perspectiveIdx) return false;
      const atom = slot.atom as { type: string; requestType?: string };
      // 响应型(代打出):主公被询问杀
      if (atom.type === '询问杀') return true;
      // 主动型(代使用):蜀角色被请求出杀
      if (atom.requestType === opts.useRequestType) return true;
      // 额外窗口(界版被动型):蜀角色被请求是否令主公摸牌
      if (atom.requestType !== undefined && opts.extraRequestTypes?.includes(atom.requestType)) {
        return true;
      }
      // 其余 pending 不是激将询问,不激活。分支专属校验由引擎 validate 权威判定:
      // 询问杀 分支查主公位与在场蜀势力,出杀/drawChoice 只发给对应角色(派发时已过滤),
      // view 层不重复 faction 判断以免与 validate 双写漂移。
      return false;
    },
  });
  return () => {};
}

const USE_OPTIONS: JijiangUseOptions = {
  displayName: '激将',
  requestType: REQUEST_TYPE,
  choiceVar: CHOICE_VAR,
  killTargetVar: KILL_TARGET_VAR,
  useError: '现在不能使用激将',
};

const RESPOND_OPTIONS: JijiangRespondOptions = {
  displayName: '激将',
  useRequestType: REQUEST_TYPE,
  useChoiceVar: CHOICE_VAR,
  killTargetVar: KILL_TARGET_VAR,
  respondError: '当前不是激将询问',
};

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use:主动激将(出牌阶段,主公请求蜀角色代为使用杀指定 killTarget) ──
  // 卸载函数沿用历史行为不接入 cleanup:use 注册在 ownerId 座位上,
  // unloadSkillInstance 按 (skillId,座次) 即可清掉。
  registerJijiangUseAction(state, skill, USE_OPTIONS);

  // ── respond:注册到全座次,按 pending 内容分支 ────────────────
  unloaders.push(declareAlternativeResponse(state, ownerId, '询问杀'));
  unloaders.push(...registerJijiangRespondActions(state, skill, RESPOND_OPTIONS));

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  return mountJijiangActions(skill, api, {
    label: '激将',
    useTitle: '激将:选择一名蜀势力角色出杀',
    respondTitle: '激将:令蜀势力角色替你打出杀?',
    useRequestType: REQUEST_TYPE,
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
