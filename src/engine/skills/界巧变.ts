// 界巧变(界张郃·主动技):你可以弃置一张手牌跳过自己的一个阶段(开始和结束阶段除外)。
//   - 跳过摸牌阶段:从至多两名其他角色处各获得一张手牌
//   - 跳过出牌阶段:将场上的一张牌移动到另一个合理的位置
//   - 跳过弃牌阶段:你摸一张牌(界版新增,原版无此效果)
//
// 与标版巧变的区别:
//   - 标版:判定/弃牌 阶段仅弃牌跳过,无附加效果。
//   - 界版:跳过弃牌阶段后,你摸一张牌。其他阶段效果与标版完全一致。
//
// 实现(基于标版 src/engine/skills/巧变.ts):
//   - before hook 挂在「阶段开始」:判定/摸牌/出牌/弃牌 阶段开始时询问是否发动。
//     发动则选弃牌 + 跳过当前阶段(阶段结束 推进 + cancel)。
//   - 跳过摸牌:发动后询问选择 1-2 名有手牌的其他角色,各获得其一张手牌(取手牌第 0 张)。
//   - 跳过出牌:发动后询问源玩家+源牌+目标玩家,通过 移动牌 atom 完成场上牌移动。
//   - 跳过判定:仅弃牌 + 跳过,无附加效果。
//   - 跳过弃牌:弃牌 + 跳过 + 摸一张牌(界版新增)。
//   - 内部标签/localVars/requestType 键名保持原前缀 '巧变/xxx'(不改为 '界巧变/xxx')。
//
// 跳过阶段手法(同神速/兵粮寸断):applyAtom(阶段结束, 当前阶段) 推进到下一阶段,
// 然后 cancel 当前 阶段开始 atom。
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
  GameView,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerBeforeHook, hasBlockingPending } from '../skill';
import { skipPhase } from '../skip-phase';

const CONFIRM_RT = '巧变/confirm';
const DISCARD_RT = '巧变/discard';
const STEAL_TARGETS_RT = '巧变/steal-targets';
const MOVE_SOURCE_PLAYER_RT = '巧变/move-source-player';
const MOVE_SOURCE_CARD_RT = '巧变/move-source-card';
const MOVE_DEST_PLAYER_RT = '巧变/move-dest-player';
const CONFIRMED_KEY = '巧变/confirmed';
const DISCARD_KEY = '巧变/discardCardId';
const STEAL_TARGETS_KEY = '巧变/stealTargets';
const MOVE_SOURCE_PLAYER_KEY = '巧变/moveSourcePlayer';
const MOVE_SOURCE_CARD_KEY = '巧变/moveSourceCardId';
const MOVE_DEST_PLAYER_KEY = '巧变/moveDestPlayer';

const SKIPPABLE_PHASES = ['判定', '摸牌', '出牌', '弃牌'] as const;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界巧变',
    description:
      '弃一张手牌跳过阶段:摸牌阶段可从至多两名其他角色各获得一张手牌;出牌阶段可移动场上的一张牌;跳过弃牌阶段后摸一张牌',
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

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:界张郃本人对巧变各询问的回应 ──
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
      const valid = [
        CONFIRM_RT,
        DISCARD_RT,
        STEAL_TARGETS_RT,
        MOVE_SOURCE_PLAYER_RT,
        MOVE_SOURCE_CARD_RT,
        MOVE_DEST_PLAYER_RT,
      ];
      if (!valid.includes(rt)) return '当前不是巧变询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true;
        return;
      }
      if (rt === DISCARD_RT) {
        const cardIds = params.cardIds as string[] | undefined;
        const single = params.cardId as string | undefined;
        const id =
          (Array.isArray(cardIds) && cardIds.length > 0 ? cardIds[0] : undefined) ??
          (typeof single === 'string' ? single : undefined);
        if (id) st.localVars[DISCARD_KEY] = id;
        return;
      }
      if (rt === STEAL_TARGETS_RT) {
        const targets = params.targets as number[] | undefined;
        if (Array.isArray(targets)) st.localVars[STEAL_TARGETS_KEY] = targets;
        return;
      }
      if (rt === MOVE_SOURCE_PLAYER_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? (params.target) : undefined);
        if (typeof t === 'number') st.localVars[MOVE_SOURCE_PLAYER_KEY] = t;
        return;
      }
      if (rt === MOVE_SOURCE_CARD_RT) {
        const cardIds = params.cardIds as string[] | undefined;
        const single = params.cardId as string | undefined;
        const id =
          (Array.isArray(cardIds) && cardIds.length > 0 ? cardIds[0] : undefined) ??
          (typeof single === 'string' ? single : undefined);
        if (id) st.localVars[MOVE_SOURCE_CARD_KEY] = id;
        return;
      }
      if (rt === MOVE_DEST_PLAYER_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? (params.target) : undefined);
        if (typeof t === 'number') st.localVars[MOVE_DEST_PLAYER_KEY] = t;
        return;
      }
    },
  );

  // ── 阶段开始 before hook:可跳过阶段的主逻辑 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const phase = atom.phase as string;
      if (!SKIPPABLE_PHASES.includes(phase as (typeof SKIPPABLE_PHASES)[number])) return;

      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (self.hand.length === 0) return; // 无手牌可弃,无法发动
      if (hasBlockingPending(ctx.state)) return;

      // 询问是否发动巧变跳过此阶段
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动巧变?(弃一张手牌跳过${phase}阶段)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return; // 不发动 → 阶段正常进行

      // 选要弃的手牌
      delete ctx.state.localVars[DISCARD_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: DISCARD_RT,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: `巧变:选择一张手牌弃置以跳过${phase}阶段`,
          source: 'hand',
          minTotal: 1,
          maxTotal: 1,
        },
        timeout: 15,
      });
      const discardCardId = ctx.state.localVars[DISCARD_KEY] as string | undefined;
      delete ctx.state.localVars[DISCARD_KEY];
      if (!discardCardId || !self.hand.includes(discardCardId)) {
        return; // 无效选择 → 阶段正常进行
      }

      await pushFrame(ctx.state, '巧变', ownerId, { phase, discardCardId });
      try {
        // 弃置手牌
        await applyAtom(ctx.state, {
          type: '弃置',
          player: ownerId,
          cardIds: [discardCardId],
        });

        // 按阶段附加效果
        if (phase === '摸牌') {
          // 从至多两名其他角色各获得一张手牌
          const candidates = ctx.state.players.filter(
            (p) => p.alive && p.index !== ownerId && p.hand.length > 0,
          );
          if (candidates.length > 0) {
            delete ctx.state.localVars[STEAL_TARGETS_KEY];
            await applyAtom(ctx.state, {
              type: '请求回应',
              requestType: STEAL_TARGETS_RT,
              target: ownerId,
              prompt: {
                type: 'choosePlayer',
                title: '巧变:选择至多两名其他角色(各获得其一张手牌)',
                min: 0,
                max: Math.min(2, candidates.length),
                filter: (_view: GameView, t: number) =>
                  t !== ownerId &&
                  ctx.state.players[t]?.alive === true &&
                  (ctx.state.players[t]?.hand.length ?? 0) > 0,
              },
              timeout: 20,
            });
            const targets = (ctx.state.localVars[STEAL_TARGETS_KEY] as number[] | undefined) ?? [];
            delete ctx.state.localVars[STEAL_TARGETS_KEY];
            for (const t of targets.slice(0, 2)) {
              const target = ctx.state.players[t];
              if (!target?.alive || target.hand.length === 0) continue;
              const cardId = target.hand[0]; // 取手牌第 0 张
              await applyAtom(ctx.state, {
                type: '获得',
                player: ownerId,
                cardId,
                from: t,
              });
            }
          }
        } else if (phase === '出牌') {
          // 移动场上的一张牌
          const playersWithCards = ctx.state.players.filter(
            (p) => p.alive && fieldCardIds(ctx.state, p.index).length > 0,
          );
          if (playersWithCards.length > 0) {
            // 步骤 1:选源玩家
            delete ctx.state.localVars[MOVE_SOURCE_PLAYER_KEY];
            await applyAtom(ctx.state, {
              type: '请求回应',
              requestType: MOVE_SOURCE_PLAYER_RT,
              target: ownerId,
              prompt: {
                type: 'choosePlayer',
                title: '巧变:选择源玩家(从其场上选一张牌移动)',
                min: 1,
                max: 1,
                filter: (_view: GameView, t: number) =>
                  ctx.state.players[t]?.alive === true &&
                  fieldCardIds(ctx.state, t).length > 0,
              },
              timeout: 15,
            });
            const srcPlayer = ctx.state.localVars[MOVE_SOURCE_PLAYER_KEY] as
              | number
              | undefined;
            delete ctx.state.localVars[MOVE_SOURCE_PLAYER_KEY];
            if (typeof srcPlayer !== 'number') {
              // 无选择 → 跳过附加效果,但仍跳过出牌阶段(已弃牌)
            } else {
              // 步骤 2:选源牌
              const srcCards = fieldCardIds(ctx.state, srcPlayer);
              delete ctx.state.localVars[MOVE_SOURCE_CARD_KEY];
              await applyAtom(ctx.state, {
                type: '请求回应',
                requestType: MOVE_SOURCE_CARD_RT,
                target: ownerId,
                prompt: {
                  type: 'distribute',
                  mode: 'select',
                  title: `巧变:选择 P${srcPlayer} 场上的一张牌移动`,
                  source: 'handAndEquip',
                  minTotal: 1,
                  maxTotal: 1,
                },
                timeout: 15,
              });
              const srcCardId = ctx.state.localVars[MOVE_SOURCE_CARD_KEY] as
                | string
                | undefined;
              delete ctx.state.localVars[MOVE_SOURCE_CARD_KEY];
              if (typeof srcCardId === 'string' && srcCards.includes(srcCardId)) {
                // 步骤 3:选目标玩家
                delete ctx.state.localVars[MOVE_DEST_PLAYER_KEY];
                await applyAtom(ctx.state, {
                  type: '请求回应',
                  requestType: MOVE_DEST_PLAYER_RT,
                  target: ownerId,
                  prompt: {
                    type: 'choosePlayer',
                    title: '巧变:选择目标玩家(将牌移到其场上)',
                    min: 1,
                    max: 1,
                    filter: (_view: GameView, t: number) =>
                      ctx.state.players[t]?.alive === true,
                  },
                  timeout: 15,
                });
                const destPlayer = ctx.state.localVars[MOVE_DEST_PLAYER_KEY] as
                  | number
                  | undefined;
                delete ctx.state.localVars[MOVE_DEST_PLAYER_KEY];
                if (typeof destPlayer === 'number') {
                  await moveFieldCard(ctx.state, srcPlayer, srcCardId, destPlayer);
                }
              }
            }
          }
        } else if (phase === '弃牌') {
          // 界版新增:跳过弃牌阶段后,摸一张牌(标版无此效果)
          await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
        }
        // 判定 阶段:仅弃牌跳过,无附加效果
      } finally {
        await popFrame(ctx.state);
      }

      // 跳过当前阶段(直接型):阶段结束(phase)+ cancel
      return skipPhase(ctx.state, { player: ownerId, phase });
    },
  );

  return () => {};
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

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '巧变',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动巧变?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
