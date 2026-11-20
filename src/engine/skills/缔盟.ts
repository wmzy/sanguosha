// 缔盟(鲁肃·吴·主动技):出牌阶段，你可以选择两名其他角色，
// 弃置等同于这两名角色手牌数差的牌，然后交换他们的手牌。每回合限一次。
//
// 流程(主动技,后端驱动交互):
//   1. use action:出牌阶段发动(限一次)
//   2. 请求回应(choosePlayer min2/max2):鲁肃选两名其他存活角色 A、B
//   3. diff = |A.hand.length - B.hand.length| → 版本各自结算
//      (标版:先弃 diff 张再交换;界版:校验差值→先交换→出牌阶段结束时延迟弃)
//
// 关键点:
//   - 鲁肃弃牌(不是目标弃牌),弃牌数 = 两人手牌数差的绝对值
//   - 交换后两人的手牌数不变,只是内容互换
//   - 限一次/回合:<skillKey>/usedThisTurn,回合用量 atom 同步到 view
//   - 限一次标记必须在第一个 await 前设置,防 dispatch 重入(同制衡/结姻)
//
// 本文件同时导出 createDimengSkill 工厂(缔盟族共享实现)及 swapHands /
// askMandatoryDiscard 两个流程助手,界缔盟 复用之,仅注入 选目标后结算 /
// 延迟弃牌(阶段结束 before-hook)/respond 弃牌校验严格度 差异。
import type { FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { registerAction } from '../core/skill';
import type { SkillModule } from '../types';
import { currentRequestType, requireRequestType, defineConfirmAction, engineCanPlayNowReason } from '../util/skillRuntime';

/** 缔盟族差异参数。 */
export interface DimengOptions {
  /** 技能键(标 '缔盟' / 界 '界缔盟'):once-per-turn 计数、结算帧标签、requestType/localVars 前缀 */
  skillKey: string;
  /** 玩家可见技能名(标/界均为 '缔盟') */
  displayName: string;
  description: string;
  /** 引擎侧选目标询问标题 */
  chooseTitle: string;
  /** respond requestType 不匹配文案 */
  mismatchError: string;
  /** respond 弃牌分支是否严格校验(标:张数=need 且全在手上;界:仅要求数组) */
  strictDiscardRespond: boolean;
  /** 选完目标后的结算(标:先弃 diff 张再交换 / 界:校验差值→先交换→记延迟弃)。
   *  discardRt/discardKey 为工厂按 skillKey 派生的询问键,保证与 respond 写入键一致。 */
  resolveAfterTargets: (
    st: GameState,
    ownerId: number,
    A: number,
    B: number,
    diff: number,
    discardRt: string,
    discardKey: string,
  ) => Promise<void>;
  /** 界版附加注册(阶段结束 before-hook:延迟弃牌);返回 unloader 列表 */
  extraInit?: (state: GameState, skillId: string, ownerId: number) => Array<() => void>;
}

/** 交换 A、B 手牌:记录双方原始手牌,逐张移动(移动牌 atom;缔盟族标/界共用)。
 *  先把 A 的牌移到 B,再把 B 的原始牌移到 A,完成交换。 */
export async function swapHands(st: GameState, A: number, B: number): Promise<void> {
  const handA = [...st.players[A].hand];
  const handB = [...st.players[B].hand];
  for (const cardId of handA) {
    await applyAtom(st, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: A },
      to: { zone: '手牌', player: B },
    });
  }
  for (const cardId of handB) {
    await applyAtom(st, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: B },
      to: { zone: '手牌', player: A },
    });
  }
}

/** 强制弃 N 张询问 + 兜底(标版交换前弃 / 界版出牌阶段结束时弃 共用,仅标题不同)。
 *  强制弃牌兜底:超时/未取得有效 cardIds → 自动从手牌首张起补足后继续
 *  (与 好施/庸肆/英魂 的 mandatory 兜底范式一致);防御性 min 由调用方先算好。 */
export async function askMandatoryDiscard(
  st: GameState,
  ownerId: number,
  discardRt: string,
  discardKey: string,
  actualDiscard: number,
  title: string,
): Promise<void> {
  delete st.localVars[discardKey];
  await applyAtom(st, {
    type: '请求回应',
    requestType: discardRt,
    target: ownerId,
    prompt: {
      type: 'useCard',
      title,
      cardFilter: { filter: () => true, min: actualDiscard, max: actualDiscard },
    },
    // 强制型弃牌(交换的代价):前端走多选弃牌 UI 提交 {cardIds};headless 不生成 skip
    mandatory: true,
    timeout: 30,
  });
  let discardCards = st.localVars[discardKey] as string[] | undefined;
  delete st.localVars[discardKey];
  if (!discardCards || discardCards.length === 0) {
    discardCards = st.players[ownerId]?.hand.slice(0, actualDiscard) ?? [];
  }
  if (discardCards.length > 0) {
    await applyAtom(st, { type: '弃置', player: ownerId, cardIds: discardCards, voluntary: true });
  }
}

/** 缔盟族共享实现:选目标前的校验/询问/respond/onMount 逐字一致。 */
export function createDimengSkill(opts: DimengOptions) {
  const TARGET_RT = `${opts.skillKey}/target`; // 鲁肃:选两名目标
  const DISCARD_RT = `${opts.skillKey}/discard`; // 鲁肃:选弃牌
  const TARGET_KEY = `${opts.skillKey}/targets`;
  const DISCARD_KEY = `${opts.skillKey}/discardCards`;

  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.displayName,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): (() => void) | void {
    const ownerId = skill.ownerId;
    const unloaders: Array<() => void> = [];

    // ── use action:鲁肃主动发动缔盟 ──
    unloaders.push(
      registerAction(
        state,
        skill.id,
        ownerId,
        'use',
        (st: GameState, _params: Record<string, Json>): string | null => {
          const playError = engineCanPlayNowReason(st, ownerId);
          if (playError) return playError;
          if (usedThisTurn(st, ownerId, opts.skillKey)) return '本回合已使用过缔盟';
          // 至少两名其他存活角色
          const others = st.players.filter((p) => p.alive && p.index !== ownerId);
          if (others.length < 2) return '需要至少两名其他角色';
          return null;
        },
        async (st: GameState, _params: Record<string, Json>): Promise<void> => {
          // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
          await markOncePerTurn(st, ownerId, opts.skillKey);

          await pushFrame(st, opts.skillKey, ownerId, {});

          // 1) 询问鲁肃选两名其他角色
          delete st.localVars[TARGET_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: TARGET_RT,
            target: ownerId,
            prompt: {
              type: 'choosePlayer',
              title: opts.chooseTitle,
              min: 2,
              max: 2,
              filter: (_view: GameView, t: number) =>
                t !== ownerId && st.players[t]?.alive === true,
            },
            timeout: 30,
          });

          const targets = st.localVars[TARGET_KEY] as number[] | undefined;
          delete st.localVars[TARGET_KEY];
          if (!Array.isArray(targets) || targets.length !== 2) {
            await popFrame(st);
            return; // 未选或超时
          }
          const [A, B] = targets;
          if (!st.players[A]?.alive || !st.players[B]?.alive) {
            await popFrame(st);
            return;
          }

          // 2) 手牌数差 → 版本各自结算(标:先弃后换 / 界:校验差值→先换→记延迟弃)
          const diff = Math.abs(st.players[A].hand.length - st.players[B].hand.length);
          await opts.resolveAfterTargets(st, ownerId, A, B, diff, DISCARD_RT, DISCARD_KEY);

          await popFrame(st);
        },
      ),
    );

    // ── respond action:处理 target/discard 询问 ──
    unloaders.push(
      registerAction(
        state,
        skill.id,
        ownerId,
        'respond',
        (st: GameState, _params: Record<string, Json>): string | null => {
          return requireRequestType(st, ownerId, [TARGET_RT, DISCARD_RT], {
            mismatchError: opts.mismatchError,
          }).error;
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(ownerId);
          const rt = currentRequestType(st, ownerId);
          if (rt === TARGET_RT) {
            const targets = params.targets as number[] | undefined;
            if (Array.isArray(targets) && targets.length === 2) {
              st.localVars[TARGET_KEY] = targets;
            }
          } else if (rt === DISCARD_RT) {
            const ids = params.cardIds as string[] | undefined;
            if (opts.strictDiscardRespond) {
              // 校验:恰好 N 张且全部为 owner 手牌(弃置 atom 不校验归属,
              // 异常客户端提交任意 cardId 会把他人手中的牌复制进弃牌堆)
              const need = (
                slot?.atom as { prompt?: { cardFilter?: { min?: number } } } | undefined
              )?.prompt?.cardFilter?.min;
              if (
                Array.isArray(ids) &&
                typeof need === 'number' &&
                ids.length === need &&
                ids.every((id) => st.players[ownerId]?.hand.includes(id))
              ) {
                st.localVars[DISCARD_KEY] = ids;
              }
            } else if (Array.isArray(ids)) {
              st.localVars[DISCARD_KEY] = ids;
            }
          }
        },
      ),
    );

    if (opts.extraInit) unloaders.push(...opts.extraInit(state, skill.id, ownerId));

    return () => unloaders.forEach((fn) => fn());
  }

  function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
    defineConfirmAction(api, 'use', {
      label: opts.displayName,
      title: '缔盟:选择两名其他角色交换手牌',
      confirmLabel: '发动',
      cancelLabel: '取消',
      activeWhen: (ctx) => activeUnlessUsedThisTurn(opts.skillKey)(ctx),
    });

    defineConfirmAction(api, 'respond', {
      label: opts.displayName,
      title: opts.displayName,
      confirmLabel: '确认',
      cancelLabel: '取消',
    });

    return () => {};
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: DimengOptions = {
  skillKey: '缔盟',
  displayName: '缔盟',
  description:
    '出牌阶段限一次,选择两名其他角色,弃置等同于他们手牌数差的牌,然后交换他们的手牌',
  chooseTitle: '缔盟:选择两名其他角色交换手牌',
  mismatchError: '当前不是缔盟询问',
  strictDiscardRespond: true,
  resolveAfterTargets: async (st, ownerId, A, B, diff, discardRt, discardKey) => {
    // 2) 计算手牌数差,鲁肃弃等量牌(不足则弃光,兜底在 askMandatoryDiscard 内)
    const actualDiscard = Math.min(diff, st.players[ownerId].hand.length);
    if (actualDiscard > 0) {
      await askMandatoryDiscard(
        st,
        ownerId,
        discardRt,
        discardKey,
        actualDiscard,
        `缔盟:弃置 ${actualDiscard} 张牌`,
      );
    }

    // 3) 交换 A、B 手牌
    await swapHands(st, A, B);
  },
};

export const { createSkill, onInit, onMount } = createDimengSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;

// [requestType 迁移·不迁项] execute 的 slot 另读 prompt.cardFilter.min(弃牌数校验,
// 非 requestType),保留手写 pendingSlots.get;requestType 读取已走 currentRequestType。
