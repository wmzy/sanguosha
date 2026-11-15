// 连营(陆逊·被动技):当你失去最后的手牌时,你可以摸一张牌。
//
// 模式 A(被动触发):before+after hook 挂在「移动牌」「给予」「装备」「获得」「弃置」
// 「移出至暂存区」,覆盖所有"手牌减少"的路径。
//   触发条件:本次 atom 使自己手牌区的牌减少,且 apply 后手牌数 == 0(失去最后的手牌)。
//   "你可以" → 询问确认(请求回应/连营/confirm),确认后摸一张牌。
//
// 关键点:
//   - "失去最后的手牌" = 本次操作移走了自己手牌区的牌,且手牌归零
//   - 移动牌/给予/装备/移出至暂存区:atom 字段(from.zone=手牌 / validate 保证
//     cardId 在 from 手牌)即可判定确实移走了手牌 → before 记录 apply 前手牌数,
//     after 仅在标记存在时判定(界版标记值兼作 X=失去手牌数)
//   - 获得/弃置:可能作用于装备/判定区(非手牌),before-hook 仅在涉及手牌时记录标记,
//     after-hook 仅在标记存在时判定(避免手牌本就为 0、只丢装备时误触)
//   - 摸牌不减少手牌,不会自递归
//   - 牌堆+弃牌堆皆空时无法摸牌,提前跳过询问(摸牌 atom validate 会拦截)
//   - 无回合限制:自己回合内/外失去最后手牌均可触发
//
// 本文件同时导出 createLianyingSkill 工厂(连营族共享实现),界连营 复用之,
// 仅注入 触发结算(标:自己摸一张 / 界:令至多X名角色各摸一张)与 respond 分支差异;
// 询问 requestType/localVars 键按版本前缀隔离('连营/…' / '界连营/…')。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';
import {
  askConfirm,
  requireRequestType,
  defineConfirmAction,
  type ConfirmActionOptions,
} from '../util/skillRuntime';

const CONFIRM_RT = '连营/confirm';
const CONFIRMED_KEY = '连营/confirmed';
// 获得/弃置 before-hook 写入:标记本次 atom 涉及陆逊的手牌(值=before 手牌数,>=1)
const HAND_BEFORE_KEY = '连营/handBefore';

/** 连营族差异参数。 */
export interface LianyingOptions {
  /** 技能名(Skill.name / 按钮 label;标 '连营' / 界 '界连营') */
  skillName: string;
  description: string;
  /** 是否发动询问的 requestType(标 '连营/confirm' / 界 '界连营/trigger') */
  confirmRt: string;
  confirmedKey: string;
  /** before-hook 标记键:apply 前手牌数(界版兼作 X=失去手牌数) */
  handBeforeKey: string;
  /** respond 可处理的全部 requestType(标 [confirm] / 界 [trigger, select]) */
  respondRts: readonly string[];
  /** respond requestType 不匹配文案 */
  mismatchError: string;
  /** 触发结算(公共守卫已过:存活 + 手牌归零 + 牌堆/弃牌堆可摸;lostCount=本次失去的手牌数)。
   *  标版:确认后自己摸一张;界版:确认后选至多 X 名角色各摸一张。 */
  trigger: (state: GameState, ownerId: number, lostCount: number) => Promise<void>;
  /** respond execute(validate 已断言 requestType ∈ respondRts) */
  respondExecute: (st: GameState, ownerId: number, params: Record<string, Json>) => void;
  /** onMount confirm 按钮(defineConfirmOptions 透传) */
  mount: ConfirmActionOptions;
}

/** 连营族共享实现:六对手牌减少路径的 hook 骨架与 respond 逐字一致。 */
export function createLianyingSkill(opts: LianyingOptions) {
  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.skillName,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;

    // 触发:手牌归零 → 版本各自结算。调用方已保证本次 atom 确实移走了陆逊的手牌;
    // lostCount = before-hook 记录的 apply 前手牌数(界版作为 X)。
    async function maybeTrigger(ctx: AtomAfterContext, lostCount: number): Promise<void> {
      if (lostCount < 1) return; // 标版:before 仅在涉及手牌时记标记;界版:X>=1
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (self.hand.length !== 0) return; // 必须归零(失去最后/所有手牌)
      // 牌堆+弃牌堆皆空 → 无法摸牌,跳过询问
      if (ctx.state.zones.deck.length === 0 && ctx.state.zones.discardPile.length === 0) return;
      await opts.trigger(ctx.state, ownerId, lostCount);
    }

    // 读取并清理本次 before-hook 记录的手牌数;非数字 = 本次 atom 未涉及陆逊手牌 → 不触发
    function consumeLostCount(st: GameState): number | undefined {
      const before = st.localVars[opts.handBeforeKey];
      delete st.localVars[opts.handBeforeKey];
      return typeof before === 'number' ? before : undefined;
    }

    // respond:回答连营询问
    registerAction(
      state,
      skill.id,
      ownerId,
      'respond',
      (st: GameState, _params: Record<string, Json>) => {
        return requireRequestType(st, ownerId, opts.respondRts, {
          wrongTypeError: '当前不是请求回应',
          mismatchError: opts.mismatchError,
        }).error;
      },
      async (st: GameState, params: Record<string, Json>) => {
        opts.respondExecute(st, ownerId, params);
      },
    );

    // ── 移动牌 before+after:从自己手牌区移走牌(打出/使用/被拆等) ──
    registerBeforeHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '移动牌') return;
      if (atom.from.zone !== '手牌') return;
      if (atom.from.player !== ownerId) return;
      // 移到自己手牌不算失去
      if (atom.to.zone === '手牌' && atom.to.player === ownerId) return;
      ctx.state.localVars[opts.handBeforeKey] = ctx.state.players[ownerId]?.hand.length ?? 0;
    });
    registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '移动牌') return;
      if (atom.from.zone !== '手牌') return;
      if (atom.from.player !== ownerId) return;
      if (atom.to.zone === '手牌' && atom.to.player === ownerId) return;
      const lost = consumeLostCount(ctx.state);
      if (lost === undefined) return;
      await maybeTrigger(ctx, lost);
    });

    // ── 给予 before+after:从自己手牌给他人(给予.validate 保证 cardId 在 from 手牌) ──
    registerBeforeHook(state, skill.id, ownerId, '给予', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '给予') return;
      if (atom.from !== ownerId) return;
      if (atom.to === ownerId) return; // 给自己不算失去
      ctx.state.localVars[opts.handBeforeKey] = ctx.state.players[ownerId]?.hand.length ?? 0;
    });
    registerAfterHook(state, skill.id, ownerId, '给予', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '给予') return;
      if (atom.from !== ownerId) return;
      if (atom.to === ownerId) return; // 给自己不算失去
      const lost = consumeLostCount(ctx.state);
      if (lost === undefined) return;
      await maybeTrigger(ctx, lost);
    });

    // ── 装备 before+after:从手牌装备(装备.validate 保证 cardId 在手牌) ──
    registerBeforeHook(state, skill.id, ownerId, '装备', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '装备') return;
      if (atom.player !== ownerId) return;
      ctx.state.localVars[opts.handBeforeKey] = ctx.state.players[ownerId]?.hand.length ?? 0;
    });
    registerAfterHook(state, skill.id, ownerId, '装备', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '装备') return;
      if (atom.player !== ownerId) return;
      const lost = consumeLostCount(ctx.state);
      if (lost === undefined) return;
      await maybeTrigger(ctx, lost);
    });

    // ── 移出至暂存区 before+after:陆逊的牌被移出游戏(界破军/界谦逊等) ──
    //   通用 atom,可能作用于装备区(非手牌);hook 过滤 target=陆逊 才算陆逊失去手牌
    //  (破军打别人 target≠陆逊,自然不触发;谦逊 source=target=陆逊,触发)。
    registerBeforeHook(state, skill.id, ownerId, '移出至暂存区', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '移出至暂存区') return;
      if (atom.target !== ownerId) return;
      ctx.state.localVars[opts.handBeforeKey] = ctx.state.players[ownerId]?.hand.length ?? 0;
    });
    registerAfterHook(state, skill.id, ownerId, '移出至暂存区', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '移出至暂存区') return;
      if (atom.target !== ownerId) return;
      const lost = consumeLostCount(ctx.state);
      if (lost === undefined) return;
      await maybeTrigger(ctx, lost);
    });

    // ── 获得 before+after:有人从陆逊获得牌 ──
    //   获得 可能作用于装备区(非手牌),before-hook 仅在涉及手牌时记录标记
    registerBeforeHook(state, skill.id, ownerId, '获得', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '获得') return;
      if (atom.from !== ownerId) return;
      if (atom.player === ownerId) return;
      const hand = ctx.state.players[ownerId]?.hand ?? [];
      if (atom.cardId && hand.includes(atom.cardId)) {
        ctx.state.localVars[opts.handBeforeKey] = hand.length;
      }
    });
    registerAfterHook(state, skill.id, ownerId, '获得', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '获得') return;
      if (atom.from !== ownerId) return;
      if (atom.player === ownerId) return;
      const lost = consumeLostCount(ctx.state);
      if (lost === undefined) return; // 本次未涉及陆逊手牌
      await maybeTrigger(ctx, lost);
    });

    // ── 弃置 before+after:陆逊被弃牌 ──
    //   弃置 可能作用于装备/判定区(非手牌),before-hook 仅在涉及手牌时记录标记
    registerBeforeHook(state, skill.id, ownerId, '弃置', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '弃置') return;
      if (atom.player !== ownerId) return;
      const hand = ctx.state.players[ownerId]?.hand ?? [];
      if (atom.cardIds?.some((id) => hand.includes(id))) {
        ctx.state.localVars[opts.handBeforeKey] = hand.length;
      }
    });
    registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '弃置') return;
      if (atom.player !== ownerId) return;
      const lost = consumeLostCount(ctx.state);
      if (lost === undefined) return; // 本次未涉及陆逊手牌
      await maybeTrigger(ctx, lost);
    });

    return () => {};
  }

  function onMount(_skill: Skill, api: FrontendAPI): void {
    defineConfirmAction(api, 'respond', opts.mount);
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: LianyingOptions = {
  skillName: '连营',
  description: '被动技:当你失去最后的手牌时,你可以摸一张牌',
  confirmRt: CONFIRM_RT,
  confirmedKey: CONFIRMED_KEY,
  handBeforeKey: HAND_BEFORE_KEY,
  respondRts: [CONFIRM_RT],
  mismatchError: '当前不是连营确认',
  trigger: async (state, ownerId, _lostCount) => {
    const confirmed = await askConfirm(state, CONFIRM_RT, ownerId, {
      confirmedKey: CONFIRMED_KEY,
      title: '是否发动连营?(失去最后的手牌,摸一张牌)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
      defaultChoice: false,
      timeout: 10,
    });
    if (!confirmed) return;
    await applyAtom(state, { type: '摸牌', player: ownerId, count: 1 });
  },
  respondExecute: (st, _ownerId, params) => {
    st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
  },
  mount: {
    label: '连营',
    title: '是否发动连营?',
    confirmLabel: '发动(摸一张牌)',
    style: 'default',
  },
};

export const { createSkill, onInit, onMount } = createLianyingSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
