// 巧变(张郃·主动技):你可以弃置一张手牌来跳过自己的一个阶段(回合开始和回合结束除外)。
//   - 跳过摸牌阶段:从至多两名其他角色处各获得一张手牌
//   - 跳过出牌阶段:将场上的一张牌移动到另一个合理的位置
//
// 实现:
//   - before hook 挂在「阶段开始」:判定/摸牌/出牌/弃牌 阶段开始时询问是否发动。
//     发动则选弃牌 + 跳过当前阶段(阶段结束 推进 + cancel)。
//   - 跳过摸牌:发动后询问选择 1-2 名有手牌的其他角色,各获得其一张随机手牌(不展示,与突袭一致)。
//   - 跳过出牌:发动后询问源玩家+源牌+目标玩家,通过 移动牌 atom 完成场上牌移动。
//   - 跳过判定/弃牌:仅弃牌 + 跳过,无附加效果。
//
// 标/界共享:可跳阶段守卫、询问/弃牌骨架、跳阶段收尾、摸牌偷牌与出牌移动附加效果、
//   respond 处理均由本文件导出,界巧变.ts 导入复用。requestType / localVars key /
//   询问标题均以技能名(巧变|界巧变)为前缀派生,两版行为逐字一致。
//
// 关键点:
//   - 每个阶段独立发动,无次数限制(只要每阶段有手牌可弃)
//   - 出牌阶段移动的牌支持:手牌/装备/判定区 → 手牌/装备
//     (装备→装备 需 slot 不冲突;判定区→手牌 视为"移回手牌")
import type {
  AtomBeforeContext,
  AtomOfName,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  PlayerState,
  Skill,
  GameView,
} from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { registerAction, registerBeforeHook, hasBlockingPending } from '../core/skill';
import { skipPhase } from '../rules/skip-phase';
import { pickRandom } from '../util/rng';
import { defineConfirmAction, firstCardId } from '../util/skillRuntime';

const SKILL_NAME = '巧变';

/** 巧变系可跳过的阶段(回合开始/回合结束除外) */
export const SKIPPABLE_PHASES = ['判定', '摸牌', '出牌', '弃牌'] as const;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_NAME,
    description:
      '弃一张手牌跳过阶段:摸牌阶段可从至多两名其他角色各获得一张手牌;出牌阶段可移动场上的一张牌',
  };
}

/** 取玩家"场上"的牌(手牌+装备+判定区)——用于出牌阶段移动的源牌选择 */
function fieldCardIds(state: GameState, player: number): string[] {
  const p = state.players[player];
  if (!p) return [];
  const hand = [...p.hand];
  const equip = Object.values(p.equipment).filter((id): id is string => !!id);
  const judge = p.pendingTricks.map((t) => t.card.id);
  return [...hand, ...equip, ...judge];
}

/**
 * 把 srcPlayer 场上的 srcCardId 移动到 destPlayer 场上。
 * 自动按 srcCardId 所在区域 + 目标位置选择合适的转移方式:
 *   - 装备牌且目标装备槽空闲 → 直接移到目标装备区(通过 移动牌 + 装备 atom)
 *   - 否则统一移到目标手牌(包括判定区牌移回手牌)
 */
async function moveFieldCard(
  state: GameState,
  srcPlayer: number,
  srcCardId: string,
  destPlayer: number,
): Promise<void> {
  if (srcPlayer === destPlayer) return; // 同一玩家:无意义
  const srcP = state.players[srcPlayer];
  if (!srcP) return;
  const card = state.cardMap[srcCardId];
  if (!card) return;

  // 判定区牌:先从判定区移除,再以 获得方式给目标(此时不在 hand/equip,filter no-op)
  const judgeTrick = srcP.pendingTricks.find((t) => t.card.id === srcCardId);
  if (judgeTrick) {
    await applyAtom(state, {
      type: '移除延时锦囊',
      player: srcPlayer,
      trickName: judgeTrick.name,
    });
    await applyAtom(state, {
      type: '获得',
      player: destPlayer,
      cardId: srcCardId,
      from: srcPlayer,
    });
    return;
  }

  // 装备牌:目标对应装备槽空闲 → 通过 移动牌(手牌区)转移到目标手牌(简化:
  //   不直接换装备槽,因 装备 atom 会触发技能加载等副作用,且目标可能已有同槽装备)。
  //   实际规则允许换装备,这里统一进目标手牌(规则 FAQ:任意合法位置,手牌是合法位置)。
  // 手牌/装备 → 目标手牌(获得 atom 自动处理 hand/equip 的 filter)
  await applyAtom(state, {
    type: '获得',
    player: destPlayer,
    cardId: srcCardId,
    from: srcPlayer,
  });
}

// ── 标/界巧变共享(界巧变.ts 导入复用) ─────────────────────────

/**
 * 「阶段开始」before hook 通用守卫:是自己回合的可跳过阶段(判定/摸牌/出牌/弃牌)、
 * 存活且无阻塞 pending 时,返回该阶段与玩家状态;否则返回 null。
 */
export function skippablePhaseOf(
  ctx: AtomBeforeContext<AtomOfName<'阶段开始'>>,
  ownerId: number,
): { phase: string; self: PlayerState } | null {
  const atom = ctx.atom;
  if (atom.type !== '阶段开始') return null;
  if (atom.player !== ownerId) return null;
  if (ctx.state.currentPlayerIndex !== ownerId) return null;
  const phase = atom.phase;
  if (!SKIPPABLE_PHASES.includes(phase as (typeof SKIPPABLE_PHASES)[number])) return null;

  const self = ctx.state.players[ownerId];
  if (!self?.alive) return null;
  if (hasBlockingPending(ctx.state)) return null;
  return { phase, self };
}

/** 询问是否发动(skillName/confirm 询问),返回玩家是否确认发动 */
export async function askConfirmToSkipPhase(
  ctx: AtomBeforeContext<AtomOfName<'阶段开始'>>,
  ownerId: number,
  skillName: string,
  title: string,
): Promise<boolean> {
  const confirmedKey = `${skillName}/confirmed`;
  delete ctx.state.localVars[confirmedKey];
  await applyAtom(ctx.state, {
    type: '请求回应',
    requestType: `${skillName}/confirm`,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title,
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 10,
  });
  return ctx.state.localVars[confirmedKey] === true;
}

/** 选要弃的手牌(skillName/discard 询问),返回所选牌 id(未选返回 undefined) */
export async function askDiscardCardForSkip(
  ctx: AtomBeforeContext<AtomOfName<'阶段开始'>>,
  ownerId: number,
  skillName: string,
  phase: string,
): Promise<string | undefined> {
  const discardKey = `${skillName}/discardCardId`;
  delete ctx.state.localVars[discardKey];
  await applyAtom(ctx.state, {
    type: '请求回应',
    requestType: `${skillName}/discard`,
    target: ownerId,
    prompt: {
      type: 'distribute',
      mode: 'select',
      title: `${skillName}:选择一张手牌弃置以跳过${phase}阶段`,
      source: 'hand',
      minTotal: 1,
      maxTotal: 1,
    },
    timeout: 15,
  });
  const discardCardId = ctx.state.localVars[discardKey] as string | undefined;
  delete ctx.state.localVars[discardKey];
  return discardCardId;
}

/**
 * 跳过阶段收尾骨架(同神速/兵粮寸断):入结算帧执行 body,finally 弹帧,
 * 然后推进「阶段结束」并返回 cancel,跳过当前阶段。
 */
export async function skipPhaseInFrame(
  state: GameState,
  ownerId: number,
  phase: string,
  frameName: string,
  frameParams: Record<string, Json>,
  body: () => Promise<void>,
): Promise<HookResult> {
  await pushFrame(state, frameName, ownerId, frameParams);
  try {
    await body();
  } finally {
    await popFrame(state);
  }
  // 跳过当前阶段(直接型):阶段结束(phase)+ cancel
  return skipPhase(state, { player: ownerId, phase });
}

/** 跳过摸牌阶段的附加效果:从至多两名其他角色各获得一张随机手牌(不展示,与突袭一致) */
async function stealHandCardOnSkipDraw(
  ctx: AtomBeforeContext<AtomOfName<'阶段开始'>>,
  ownerId: number,
  skillName: string,
): Promise<void> {
  const stealTargetsKey = `${skillName}/stealTargets`;
  const candidates = ctx.state.players.filter(
    (p) => p.alive && p.index !== ownerId && p.hand.length > 0,
  );
  if (candidates.length > 0) {
    delete ctx.state.localVars[stealTargetsKey];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: `${skillName}/steal-targets`,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: `${skillName}:选择至多两名其他角色(各获得其一张手牌)`,
        min: 0,
        max: Math.min(2, candidates.length),
        filter: (_view: GameView, t: number) =>
          t !== ownerId &&
          ctx.state.players[t]?.alive === true &&
          (ctx.state.players[t]?.hand.length ?? 0) > 0,
      },
      timeout: 20,
    });
    const targets = (ctx.state.localVars[stealTargetsKey] as number[] | undefined) ?? [];
    delete ctx.state.localVars[stealTargetsKey];
    for (const t of targets.slice(0, 2)) {
      const target = ctx.state.players[t];
      if (!target?.alive || target.hand.length === 0) continue;
      // 手牌不公开:盲取一张随机手牌(与突袭一致,不展示)
      const cardId = pickRandom(ctx.state, target.hand)!;
      await applyAtom(ctx.state, {
        type: '获得',
        player: ownerId,
        cardId,
        from: t,
      });
    }
  }
}

/** 跳过出牌阶段的附加效果:移动场上的一张牌(源玩家 → 源牌 → 目标玩家) */
async function moveFieldCardOnSkipPlay(
  ctx: AtomBeforeContext<AtomOfName<'阶段开始'>>,
  ownerId: number,
  skillName: string,
): Promise<void> {
  const sourcePlayerKey = `${skillName}/moveSourcePlayer`;
  const sourceCardKey = `${skillName}/moveSourceCardId`;
  const destPlayerKey = `${skillName}/moveDestPlayer`;
  const playersWithCards = ctx.state.players.filter(
    (p) => p.alive && fieldCardIds(ctx.state, p.index).length > 0,
  );
  if (playersWithCards.length > 0) {
    // 步骤 1:选源玩家
    delete ctx.state.localVars[sourcePlayerKey];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: `${skillName}/move-source-player`,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: `${skillName}:选择源玩家(从其场上选一张牌移动)`,
        min: 1,
        max: 1,
        filter: (_view: GameView, t: number) =>
          ctx.state.players[t]?.alive === true &&
          fieldCardIds(ctx.state, t).length > 0,
      },
      timeout: 15,
    });
    const srcPlayer = ctx.state.localVars[sourcePlayerKey] as number | undefined;
    delete ctx.state.localVars[sourcePlayerKey];
    if (typeof srcPlayer !== 'number') {
      // 无选择 → 跳过附加效果,但仍跳过出牌阶段(已弃牌/已扣资源)
    } else {
      // 步骤 2:选源牌
      const srcCards = fieldCardIds(ctx.state, srcPlayer);
      delete ctx.state.localVars[sourceCardKey];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: `${skillName}/move-source-card`,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: `${skillName}:选择 ${ctx.state.players[srcPlayer]?.name ?? `P${srcPlayer}`} 场上的一张牌移动`,
          cardIds: srcCards,
          minTotal: 1,
          maxTotal: 1,
        },
        timeout: 15,
      });
      const srcCardId = ctx.state.localVars[sourceCardKey] as string | undefined;
      delete ctx.state.localVars[sourceCardKey];
      if (typeof srcCardId === 'string' && srcCards.includes(srcCardId)) {
        // 步骤 3:选目标玩家
        delete ctx.state.localVars[destPlayerKey];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: `${skillName}/move-dest-player`,
          target: ownerId,
          prompt: {
            type: 'choosePlayer',
            title: `${skillName}:选择目标玩家(将牌移到其场上)`,
            min: 1,
            max: 1,
            filter: (_view: GameView, t: number) =>
              ctx.state.players[t]?.alive === true,
          },
          timeout: 15,
        });
        const destPlayer = ctx.state.localVars[destPlayerKey] as number | undefined;
        delete ctx.state.localVars[destPlayerKey];
        if (typeof destPlayer === 'number') {
          await moveFieldCard(ctx.state, srcPlayer, srcCardId, destPlayer);
        }
      }
    }
  }
}

/** 跳过阶段的附加效果(标/界共用):摸牌→偷牌;出牌→移动场上牌;判定/弃牌→无 */
export async function runSkipPhaseBonus(
  ctx: AtomBeforeContext<AtomOfName<'阶段开始'>>,
  ownerId: number,
  skillName: string,
  phase: string,
): Promise<void> {
  if (phase === '摸牌') {
    await stealHandCardOnSkipDraw(ctx, ownerId, skillName);
  } else if (phase === '出牌') {
    await moveFieldCardOnSkipPlay(ctx, ownerId, skillName);
  }
  // 判定/弃牌 阶段:仅弃牌跳过,无附加效果
}

/** 巧变系 respond 认可的 requestType 全集(界版在此基础上追加 `${skillName}/mode`) */
export function qiaobianRequestTypes(skillName: string): string[] {
  return [
    `${skillName}/confirm`,
    `${skillName}/discard`,
    `${skillName}/steal-targets`,
    `${skillName}/move-source-player`,
    `${skillName}/move-source-card`,
    `${skillName}/move-dest-player`,
  ];
}

/** 巧变系 respond 执行:把各询问回应写入 localVars(标/界共用;界版 mode 询问各自处理) */
export function handleQiaobianRespond(
  st: GameState,
  ownerId: number,
  skillName: string,
  params: Record<string, Json>,
): void {
  const slot = st.pendingSlots.get(ownerId);
  const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
  if (rt === `${skillName}/confirm`) {
    st.localVars[`${skillName}/confirmed`] = params.choice === true;
    return;
  }
  if (rt === `${skillName}/discard`) {
    const id = firstCardId(params);
    if (id) st.localVars[`${skillName}/discardCardId`] = id;
    return;
  }
  if (rt === `${skillName}/steal-targets`) {
    const targets = params.targets as number[] | undefined;
    if (Array.isArray(targets)) st.localVars[`${skillName}/stealTargets`] = targets;
    return;
  }
  if (rt === `${skillName}/move-source-player`) {
    const t =
      (params.targets as number[] | undefined)?.[0] ??
      (typeof params.target === 'number' ? params.target : undefined);
    if (typeof t === 'number') st.localVars[`${skillName}/moveSourcePlayer`] = t;
    return;
  }
  if (rt === `${skillName}/move-source-card`) {
    const id = firstCardId(params);
    if (id) st.localVars[`${skillName}/moveSourceCardId`] = id;
    return;
  }
  if (rt === `${skillName}/move-dest-player`) {
    const t =
      (params.targets as number[] | undefined)?.[0] ??
      (typeof params.target === 'number' ? params.target : undefined);
    if (typeof t === 'number') st.localVars[`${skillName}/moveDestPlayer`] = t;
    return;
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:张郃本人对巧变各询问的回应 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (!qiaobianRequestTypes(SKILL_NAME).includes(rt)) {
        return `当前不是${SKILL_NAME}询问`;
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      handleQiaobianRespond(st, ownerId, SKILL_NAME, params);
    },
  );

  // ── 阶段开始 before hook:可跳过阶段的主逻辑 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const target = skippablePhaseOf(ctx, ownerId);
      if (!target) return;
      const { phase, self } = target;
      if (self.hand.length === 0) return; // 无手牌可弃,无法发动

      // 询问是否发动巧变跳过此阶段
      const confirmed = await askConfirmToSkipPhase(
        ctx,
        ownerId,
        SKILL_NAME,
        `是否发动${SKILL_NAME}?(弃一张手牌跳过${phase}阶段)`,
      );
      if (!confirmed) return; // 不发动 → 阶段正常进行

      // 选要弃的手牌
      const discardCardId = await askDiscardCardForSkip(ctx, ownerId, SKILL_NAME, phase);
      if (!discardCardId || !self.hand.includes(discardCardId)) {
        return; // 无效选择 → 阶段正常进行
      }

      return skipPhaseInFrame(
        ctx.state,
        ownerId,
        phase,
        SKILL_NAME,
        { phase, discardCardId },
        async () => {
          // 弃置手牌
          await applyAtom(ctx.state, {
            type: '弃置',
            player: ownerId,
            cardIds: [discardCardId],
            voluntary: true,
          });

          // 按阶段附加效果
          await runSkipPhaseBonus(ctx, ownerId, SKILL_NAME, phase);
        },
      );
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  defineConfirmAction(api, 'respond', {
    label: SKILL_NAME,
    title: '是否发动巧变?',
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
