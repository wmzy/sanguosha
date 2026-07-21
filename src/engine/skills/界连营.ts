// 界连营(界陆逊·被动技):当你失去所有手牌后,你可以令至多X名角色各摸一张牌
//   (X为你失去的手牌数)。
//
// 与标 连营 的区别:标版"自己摸一张" → 界版"令至多X名角色各摸一张"。
//   X 定义:OL 现行版为「失去的手牌数」(本次使手牌归零的那次失去事件中失去的手牌张数),
//   不是早期版本的体力值。配合界谦逊把整手牌移出时可触发超大 X 的连营,是这套技能联动的核心。
//
// 模式 A(被动触发):after hook 挂载点覆盖所有"手牌减少"的路径:
//   移动牌/给予/装备/移出游戏 after + 获得/弃置 before+after。
//   触发条件:本次 atom 使自己手牌区牌减少,且 apply 后手牌数 == 0(失去所有手牌)。
//   "你可以" → 询问 confirm(trigger);确认后用 choosePlayer(min=1,max=X) 选目标(select),
//   对每个目标各 摸牌(count=1)。
//
// X 计数机制(关键):
//   - 每个 before-hook 在涉及界陆逊手牌时,写入 HAND_BEFORE_KEY = apply 前的手牌数。
//   - 对应 after-hook 读取并删除 HAND_BEFORE_KEY,作为 X 传给 maybeTriggerLianYing。
//   - 移出游戏(界谦逊)一次移走 N 张整手牌 → before 记 N、after 手牌归零 → X=N(联动核心)。
//   - 移动牌/给予/装备 单张移走 → X=1(失去最后一张的边界)。
//   - 获得/弃置 可能作用于装备/判定区(非手牌),before-hook 仅在涉及手牌时写入。
//
// 其他关键点:
//   - "角色"含自己 → 不排除自己(filter 仅校验存活)
//   - "至多X名"是硬规则:max 在引擎侧 clamp(防止越权客户端多选)
//   - 摸牌不减少手牌,不会自递归
//   - 牌堆+弃牌堆皆空 → 无法摸牌,跳过询问
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const TRIGGER_RT = '界连营/trigger';
const SELECT_RT = '界连营/select';
const CONFIRMED_KEY = '界连营/confirmed';
const TARGETS_KEY = '界连营/targets';
// before-hook 写入:本次 atom 涉及界陆逊手牌时,记录 apply 前的手牌数(>=1),作为 X
const HAND_BEFORE_KEY = '界连营/handBefore';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界连营',
    description: '被动技:当你失去所有手牌后,你可以令至多X名角色各摸一张牌(X为你失去的手牌数)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 触发:手牌归零 → 询问确认 → 选目标 → 各摸一张。
  //   lostCount = 本次失去的手牌数(before-hook 记录的 apply 前手牌数),作为 X。
  async function maybeTriggerLianYing(ctx: AtomAfterContext, lostCount: number): Promise<void> {
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (self.hand.length !== 0) return; // 必须归零(失去所有手牌)
    // X = 失去的手牌数;失去数 <1 视为非手牌归零事件,跳过
    const X = lostCount;
    if (X < 1) return;
    // 牌堆+弃牌堆皆空 → 无法摸牌,跳过询问
    if (ctx.state.zones.deck.length === 0 && ctx.state.zones.discardPile.length === 0) return;

    // 存活角色数(含自己),max 不超过存活数
    const aliveCount = ctx.state.players.filter((p) => p.alive).length;
    const maxTargets = Math.min(X, aliveCount);
    if (maxTargets < 1) return;

    // ① 是否发动界连营
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: TRIGGER_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `是否发动界连营?(失去${X}张手牌,令至多${maxTargets}名角色各摸一张牌)`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (ctx.state.localVars[CONFIRMED_KEY] !== true) return;

    // ② 选择 1~maxTargets 名角色(含自己)各摸一张
    delete ctx.state.localVars[TARGETS_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: SELECT_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: `界连营:选择至多${maxTargets}名角色(各摸一张牌)`,
        min: 1,
        max: maxTargets,
        filter: (view: GameView, target: number) => view.players[target]?.alive === true,
      },
      timeout: 20,
    });

    const rawTargets = ctx.state.localVars[TARGETS_KEY] as number[] | undefined;
    // 仅保留存活目标,并按"至多X名"硬规则 clamp(防越权多选)
    const targets = (
      Array.isArray(rawTargets)
        ? rawTargets.filter((t) => ctx.state.players[t]?.alive === true)
        : []
    ).slice(0, maxTargets);

    // 各摸一张牌
    for (const target of targets) {
      await applyAtom(ctx.state, { type: '摸牌', player: target, count: 1 });
    }
  }

  // 读取并清理本次 before-hook 记录的手牌数;非数字 = 本次 atom 未涉及界陆逊手牌 → 不触发
  function consumeLostCount(st: GameState): number | undefined {
    const before = st.localVars[HAND_BEFORE_KEY];
    delete st.localVars[HAND_BEFORE_KEY];
    return typeof before === 'number' ? before : undefined;
  }

  // respond:回答界连营询问(trigger=confirm, select=choosePlayer)
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是请求回应';
      if (atom.requestType !== TRIGGER_RT && atom.requestType !== SELECT_RT)
        return '当前不是界连营回应';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === TRIGGER_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === SELECT_RT) {
        // 兼容 targets(数组)与 target(单数)
        const targets =
          (params.targets as number[] | undefined) ??
          (typeof params.target === 'number' ? [params.target] : undefined);
        st.localVars[TARGETS_KEY] = targets ?? [];
      }
    },
  );

  // ── 移动牌 before+after:从自己手牌区移走牌(打出/使用/被拆等) ──
  registerBeforeHook(state, skill.id, ownerId, '移动牌', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as {
      type?: string;
      from?: { zone?: string; player?: number };
      to?: { zone?: string; player?: number };
    };
    if (atom.type !== '移动牌') return;
    if (atom.from?.zone !== '手牌') return;
    if (atom.from?.player !== ownerId) return;
    // 移到自己手牌不算失去
    if (atom.to?.player === ownerId && atom.to?.zone === '手牌') return;
    ctx.state.localVars[HAND_BEFORE_KEY] = ctx.state.players[ownerId]?.hand.length ?? 0;
  });
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as {
      type?: string;
      from?: { zone?: string; player?: number };
      to?: { zone?: string; player?: number };
    };
    if (atom.type !== '移动牌') return;
    if (atom.from?.zone !== '手牌') return;
    if (atom.from?.player !== ownerId) return;
    if (atom.to?.player === ownerId && atom.to?.zone === '手牌') return;
    const lost = consumeLostCount(ctx.state);
    if (lost === undefined) return;
    await maybeTriggerLianYing(ctx, lost);
  });

  // ── 给予 before+after:从自己手牌给他人(给予.validate 保证 cardId 在 from 手牌) ──
  registerBeforeHook(state, skill.id, ownerId, '给予', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { type?: string; from?: number; to?: number };
    if (atom.type !== '给予') return;
    if (atom.from !== ownerId) return;
    if (atom.to === ownerId) return; // 给自己不算失去
    ctx.state.localVars[HAND_BEFORE_KEY] = ctx.state.players[ownerId]?.hand.length ?? 0;
  });
  registerAfterHook(state, skill.id, ownerId, '给予', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; from?: number; to?: number };
    if (atom.type !== '给予') return;
    if (atom.from !== ownerId) return;
    if (atom.to === ownerId) return; // 给自己不算失去
    const lost = consumeLostCount(ctx.state);
    if (lost === undefined) return;
    await maybeTriggerLianYing(ctx, lost);
  });

  // ── 装备 before+after:从手牌装备(装备.validate 保证 cardId 在手牌) ──
  registerBeforeHook(state, skill.id, ownerId, '装备', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '装备') return;
    if (atom.player !== ownerId) return;
    ctx.state.localVars[HAND_BEFORE_KEY] = ctx.state.players[ownerId]?.hand.length ?? 0;
  });
  registerAfterHook(state, skill.id, ownerId, '装备', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '装备') return;
    if (atom.player !== ownerId) return;
    const lost = consumeLostCount(ctx.state);
    if (lost === undefined) return;
    await maybeTriggerLianYing(ctx, lost);
  });

  // ── 移出至暂存区 before+after:界谦逊把整手牌移出(联动核心) ──
  //   通用 atom,亦服务破军等技能;hook 过滤 target=陆逊 才算陆逊失去手牌。
  //   (破军打别人 target≠陆逊,自然不触发。谦逊 source=target=陆逊,触发。)
  registerBeforeHook(state, skill.id, ownerId, '移出至暂存区', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { type?: string; target?: number };
    if (atom.type !== '移出至暂存区') return;
    if (atom.target !== ownerId) return;
    ctx.state.localVars[HAND_BEFORE_KEY] = ctx.state.players[ownerId]?.hand.length ?? 0;
  });
  registerAfterHook(state, skill.id, ownerId, '移出至暂存区', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; target?: number };
    if (atom.type !== '移出至暂存区') return;
    if (atom.target !== ownerId) return;
    const lost = consumeLostCount(ctx.state);
    if (lost === undefined) return;
    await maybeTriggerLianYing(ctx, lost);
  });

  // ── 获得 before+after:有人从界陆逊获得牌 ──
  //   获得 可能作用于装备区(非手牌),before-hook 仅在涉及手牌时记录标记
  registerBeforeHook(state, skill.id, ownerId, '获得', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as {
      type?: string;
      from?: number;
      player?: number;
      cardId?: string;
    };
    if (atom.type !== '获得') return;
    if (atom.from !== ownerId) return;
    if (atom.player === ownerId) return;
    const hand = ctx.state.players[ownerId]?.hand ?? [];
    if (atom.cardId && hand.includes(atom.cardId)) {
      ctx.state.localVars[HAND_BEFORE_KEY] = hand.length;
    }
  });
  registerAfterHook(state, skill.id, ownerId, '获得', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; from?: number; player?: number };
    if (atom.type !== '获得') return;
    if (atom.from !== ownerId) return;
    if (atom.player === ownerId) return;
    const lost = consumeLostCount(ctx.state);
    if (lost === undefined) return; // 本次未涉及界陆逊手牌
    await maybeTriggerLianYing(ctx, lost);
  });

  // ── 弃置 before+after:界陆逊被弃牌 ──
  //   弃置 可能作用于装备/判定区(非手牌),before-hook 仅在涉及手牌时记录标记
  registerBeforeHook(state, skill.id, ownerId, '弃置', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { type?: string; player?: number; cardIds?: string[] };
    if (atom.type !== '弃置') return;
    if (atom.player !== ownerId) return;
    const hand = ctx.state.players[ownerId]?.hand ?? [];
    if (atom.cardIds?.some((id) => hand.includes(id))) {
      ctx.state.localVars[HAND_BEFORE_KEY] = hand.length;
    }
  });
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '弃置') return;
    if (atom.player !== ownerId) return;
    const lost = consumeLostCount(ctx.state);
    if (lost === undefined) return; // 本次未涉及界陆逊手牌
    await maybeTriggerLianYing(ctx, lost);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界连营',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动界连营?',
      confirmLabel: '发动(令角色摸牌)',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
