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
// 跳过阶段手法(同神速/兵粮寸断):applyAtom(阶段结束, 当前阶段) 推进到下一阶段,
// 然后 cancel 当前 阶段开始 atom。
//
// 关键点:
//   - 每个阶段独立发动,无次数限制(只要每阶段有手牌可弃)
//   - 出牌阶段移动的牌支持:手牌/装备/判定区 → 手牌/装备
//     (装备→装备 需 slot 不冲突;判定区→手牌 视为"移回手牌")
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
  GameView,
  EquipSlot,
} from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { registerAction, registerBeforeHook, hasBlockingPending } from '../core/skill';
import { skipPhase } from '../rules/skip-phase';
import { createRng } from '../util/rng';
import { hasSkillModule } from './registry';

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

function equipmentSlot(state: GameState, cardId: string): EquipSlot | undefined {
  const subtype = state.cardMap[cardId]?.subtype;
  return ({ 武器: '武器', 防具: '防具', 进攻马: '进攻马', 防御马: '防御马', 宝物: '宝物' } as const)[subtype as '武器' | '防具' | '进攻马' | '防御马' | '宝物'];
}

function canMoveTo(state: GameState, srcPlayer: number, cardId: string, destPlayer: number): boolean {
  if (srcPlayer === destPlayer) return false;
  const card = state.cardMap[cardId];
  const source = state.players[srcPlayer];
  const target = state.players[destPlayer];
  if (!card || !source || !target?.alive) return false;
  const slot = equipmentSlot(state, cardId);
  if (slot && (target.equipment[slot] || target.vars[`决堰/废除:${slot}`] || target.vars[`雄乱/废除:${slot}`])) return false;
  if (card.trickSubtype === '延时锦囊' && (target.pendingTricks.some((entry) => entry.name === card.name) || target.vars['雄乱/废除:判定'])) return false;
  return true;
}

function hasMoveDestination(state: GameState, srcPlayer: number, cardId: string): boolean {
  return state.players.some((target) => canMoveTo(state, srcPlayer, cardId, target.index));
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '巧变',
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

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:张郃本人对巧变各询问的回应 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
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
      if (rt === MOVE_DEST_PLAYER_RT) {
        const source = st.localVars[MOVE_SOURCE_PLAYER_KEY] as number | undefined;
        const cardId = st.localVars[MOVE_SOURCE_CARD_KEY] as string | undefined;
        const target = (params.targets as number[] | undefined)?.[0] ?? params.target;
        if (typeof source !== 'number' || typeof cardId !== 'string' || typeof target !== 'number' || !canMoveTo(st, source, cardId, target)) {
          return '该玩家没有对应的合法场区';
        }
      }
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
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const phase = atom.phase;
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
          voluntary: true,
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
              // 手牌不公开:盲取一张随机手牌(与突袭一致,不展示)
              const rng = createRng(ctx.state.rngSeed);
              const idx = rng.nextInt(target.hand.length);
              ctx.state.rngSeed = rng.getState();
              const cardId = target.hand[idx];
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
            (p) => p.alive && fieldCardIds(ctx.state, p.index).some((id) => hasMoveDestination(ctx.state, p.index, id)),
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
                  fieldCardIds(ctx.state, t).some((id) => hasMoveDestination(ctx.state, t, id)),
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
              ctx.state.localVars[MOVE_SOURCE_PLAYER_KEY] = srcPlayer;
              // 步骤 2:选源牌
              const srcCards = fieldCardIds(ctx.state, srcPlayer).filter((id) => hasMoveDestination(ctx.state, srcPlayer, id));
              delete ctx.state.localVars[MOVE_SOURCE_CARD_KEY];
              await applyAtom(ctx.state, {
                type: '请求回应',
                requestType: MOVE_SOURCE_CARD_RT,
                target: ownerId,
                prompt: {
                  type: 'distribute',
                  mode: 'select',
                  title: `巧变:选择 ${ctx.state.players[srcPlayer]?.name ?? `P${srcPlayer}`} 场上的一张牌移动`,
                  cardIds: srcCards,
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
                ctx.state.localVars[MOVE_SOURCE_CARD_KEY] = srcCardId;
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
                      canMoveTo(ctx.state, srcPlayer, srcCardId, t),
                  },
                  timeout: 15,
                });
                const destPlayer = ctx.state.localVars[MOVE_DEST_PLAYER_KEY] as
                  | number
                  | undefined;
                delete ctx.state.localVars[MOVE_DEST_PLAYER_KEY];
                if (typeof destPlayer === 'number') {
                  if (canMoveTo(ctx.state, srcPlayer, srcCardId, destPlayer)) {
                    await moveFieldCard(ctx.state, srcPlayer, srcCardId, destPlayer);
                  }
                }
                delete ctx.state.localVars[MOVE_SOURCE_PLAYER_KEY];
                delete ctx.state.localVars[MOVE_SOURCE_CARD_KEY];
              }
            }
          }
        }
        // 判定/弃牌 阶段:仅弃牌跳过,无附加效果
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
 * 按来源区域移动:手牌进入目标手牌、装备进入目标同类空装备栏、延时锦囊进入合法判定区。
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
  if (card.trickSubtype === '延时锦囊') {
    if (judgeTrick) {
      await applyAtom(state, { type: '移除延时锦囊', player: srcPlayer, trickName: judgeTrick.name });
    } else {
      await applyAtom(state, { type: '移动牌', cardId: srcCardId, from: { zone: '手牌', player: srcPlayer }, to: { zone: '弃牌堆' } });
    }
    await applyAtom(state, {
      type: '添加延时锦囊',
      player: destPlayer,
      trick: judgeTrick ?? { name: card.name, source: srcPlayer, card },
    });
    return;
  }

  const slot = equipmentSlot(state, srcCardId);
  if (slot) {
    const wasEquipped = Object.values(srcP.equipment).includes(srcCardId);
    if (wasEquipped && card.name && hasSkillModule(card.name)) {
      await applyAtom(state, { type: '移除技能', player: srcPlayer, skillId: card.name });
    }
    await applyAtom(state, { type: '获得', player: destPlayer, cardId: srcCardId, from: srcPlayer });
    await applyAtom(state, { type: '装备', player: destPlayer, cardId: srcCardId });
    if (card.name && hasSkillModule(card.name)) {
      await applyAtom(state, { type: '添加技能', player: destPlayer, skillId: card.name });
    }
    return;
  }
  // 手牌进入目标手牌。
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
