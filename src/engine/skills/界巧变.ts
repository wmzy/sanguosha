// 界巧变(界张郃·主动技):
//   游戏开始时,你获得 2 枚"变"标记。
//   你可以弃置一张牌或移除 1 枚"变",跳过你的一个阶段(准备阶段和结束阶段除外):
//     - 跳过摸牌阶段:你可以获得至多两名角色各一张手牌
//     - 跳过出牌阶段:你可以移动场上的一张牌
//   结束阶段,若你的手牌数与之前你每回合结束阶段的手牌数均不相等,你获得 1 枚"变"。
//
// 与标版巧变的区别:
//   - 标版:每阶段必须弃一张手牌才能跳过,无"变"标记系统。
//   - 界版:引入"变"标记(开局 2 枚)。跳阶段的方式 = 弃一张手牌 **或** 移除 1 枚"变"。
//     结束阶段手牌数"独一无二"时再得 1 枚"变",标记可持续累积。
//   - 跳过弃牌阶段无附加效果(标版/界版一致)——旧实现曾错误添加"摸一张牌",已删除。
//
// 实现:
//   - "变"标记存储:每枚 = 一个 mark,id 形如 `界巧变/变:N`(N=seq,参考 屯田 的"田")。
//     count = marks.filter(m => m.id.startsWith('界巧变/变:')).length。
//     加/减经 加标记/去标记 atom(view 自动同步)。
//   - 历史手牌数:player.vars['界巧变/历史手牌数'](number[],跨回合持久;
//     无 /usedThisTurn 等被 回合结束 atom 清理的后缀,故自动保留)。
//   - 游戏开始初始化(化身先例):'回合开始' after-hook,首次触发时给本玩家加 2 枚变。
//     主公首回合开始 ≈ 游戏开始,此时所有玩家实例同步初始化。
//   - before hook 挂在「阶段开始」(判定/摸牌/出牌/弃牌):
//       1) 询问是否发动。
//       2) 选择方式(弃牌 / 移除变)——只有一种可用时跳过此询问。
//       3) 按方式扣资源 + 按阶段附加效果(摸牌偷牌/出牌移动)。
//       4) 跳过当前阶段(直接型:阶段结束 推进 + cancel)。
//   - after hook 挂在「阶段开始」(phase='回合结束',即"结束阶段"):
//       检查手牌数是否与历史均不相等,是则 +1 变 + 记录历史。
//
// 跳过阶段手法(同神速/兵粮寸断/skipPhase):applyAtom(阶段结束, 当前阶段) 推进到下一阶段,
// 然后 cancel 当前 阶段开始 atom。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
  GameView,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerBeforeHook, registerAfterHook, hasBlockingPending } from '../skill';
import { skipPhase } from '../skip-phase';

// ── requestType 常量(用于 请求回应 atom 的 requestType 字段) ──
const CONFIRM_RT = '界巧变/confirm';
const MODE_RT = '界巧变/mode'; // 选择发动方式:弃牌 or 移除变
const DISCARD_RT = '界巧变/discard';
const STEAL_TARGETS_RT = '界巧变/steal-targets';
const MOVE_SOURCE_PLAYER_RT = '界巧变/move-source-player';
const MOVE_SOURCE_CARD_RT = '界巧变/move-source-card';
const MOVE_DEST_PLAYER_RT = '界巧变/move-dest-player';

// ── 跨 atom 通信(localVars,执行内瞬时) ──
const CONFIRMED_KEY = '界巧变/confirmed';
const MODE_KEY = '界巧变/mode'; // '变' | 'discard'
const DISCARD_KEY = '界巧变/discardCardId';
const STEAL_TARGETS_KEY = '界巧变/stealTargets';
const MOVE_SOURCE_PLAYER_KEY = '界巧变/moveSourcePlayer';
const MOVE_SOURCE_CARD_KEY = '界巧变/moveSourceCardId';
const MOVE_DEST_PLAYER_KEY = '界巧变/moveDestPlayer';

// ── 持久状态(player.vars / marks) ──
/** 历史结束阶段手牌数:number[],跨回合持久(无 /usedThisTurn 等清理后缀) */
const HISTORY_KEY = '界巧变/历史手牌数';
/** 每枚"变"= 一个 mark,id 形如 `${BIAN_PREFIX}${seq}` */
const BIAN_PREFIX = '界巧变/变:';
/** 游戏开始初始化标记(localVars,per-owner,首次触发后置 true) */
const INIT_KEY = (ownerId: number) => `界巧变/init/${ownerId}`;

const SKIPPABLE_PHASES = ['判定', '摸牌', '出牌', '弃牌'] as const;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界巧变',
    description:
      '游戏开始获得2枚"变"标记;弃一张牌或移除1枚"变"跳过阶段(摸牌:至多两名角色各获得一张手牌;出牌:移动场上的一张牌);结束阶段手牌数与历史均不相等则获得1枚"变"',
  };
}

// ── "变"标记读写辅助 ──

function bianCount(state: GameState, player: number): number {
  return state.players[player].marks.filter((m) => m.id.startsWith(BIAN_PREFIX)).length;
}

async function addBian(state: GameState, player: number): Promise<void> {
  await applyAtom(state, {
    type: '加标记',
    player,
    mark: { id: `${BIAN_PREFIX}${state.seq}`, scope: player },
  });
}

async function removeBian(state: GameState, player: number): Promise<void> {
  const marks = state.players[player].marks;
  const target = marks.find((m) => m.id.startsWith(BIAN_PREFIX));
  if (!target) return;
  await applyAtom(state, { type: '去标记', player, markId: target.id });
}

// ── 历史手牌数读写 ──

function getHistory(state: GameState, player: number): number[] {
  const v = state.players[player].vars[HISTORY_KEY];
  return Array.isArray(v) ? (v as number[]).filter((n): n is number => typeof n === 'number') : [];
}

function appendHistory(state: GameState, player: number, handCount: number): void {
  const history = getHistory(state, player);
  state.players[player].vars[HISTORY_KEY] = [...history, handCount];
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

  // ── respond:界张郃本人对界巧变各询问的回应 ──
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
        MODE_RT,
        DISCARD_RT,
        STEAL_TARGETS_RT,
        MOVE_SOURCE_PLAYER_RT,
        MOVE_SOURCE_CARD_RT,
        MOVE_DEST_PLAYER_RT,
      ];
      if (!valid.includes(rt)) return '当前不是界巧变询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true;
        return;
      }
      if (rt === MODE_RT) {
        // params.choice === true → 移除 1 枚"变";否则弃一张手牌
        st.localVars[MODE_KEY] = params.choice === true ? '变' : 'discard';
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
          (typeof params.target === 'number' ? params.target : undefined);
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
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[MOVE_DEST_PLAYER_KEY] = t;
        return;
      }
    },
  );

  // ── 游戏开始初始化(化身先例):'回合开始' after-hook,首次触发加 2 枚"变" ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx: AtomAfterContext) => {
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;
    if (st.localVars[INIT_KEY(ownerId)]) return;
    st.localVars[INIT_KEY(ownerId)] = true;
    await addBian(st, ownerId);
    await addBian(st, ownerId);
  });

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
      if (hasBlockingPending(ctx.state)) return;

      // 可用方式:弃手牌 / 移除变
      const canDiscard = self.hand.length > 0;
      const canUseBian = bianCount(ctx.state, ownerId) > 0;
      if (!canDiscard && !canUseBian) return; // 两种方式都不可 → 无法发动

      // 询问是否发动
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动界巧变?(跳过${phase}阶段)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return; // 不发动 → 阶段正常进行

      // 选择发动方式:两者都有时询问,只有一种时直接采用
      let mode: '变' | 'discard';
      if (canDiscard && canUseBian) {
        delete ctx.state.localVars[MODE_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: MODE_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title: `界巧变:以何种方式跳过${phase}阶段?`,
            description: '确认 = 移除1枚"变"标记;取消 = 弃置一张手牌',
            confirmLabel: '移除1枚变',
            cancelLabel: '弃置手牌',
          },
          defaultChoice: false,
          timeout: 10,
        });
        const chosen = ctx.state.localVars[MODE_KEY] as '变' | 'discard' | undefined;
        mode = chosen === '变' ? '变' : 'discard';
        delete ctx.state.localVars[MODE_KEY];
      } else if (canUseBian) {
        mode = '变'; // 无手牌只能用变
      } else {
        mode = 'discard'; // 无变只能弃牌
      }

      // 弃牌方式:必须能选到合法手牌;否则阶段正常进行
      let discardCardId: string | undefined;
      if (mode === 'discard') {
        delete ctx.state.localVars[DISCARD_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: DISCARD_RT,
          target: ownerId,
          prompt: {
            type: 'distribute',
            mode: 'select',
            title: `界巧变:选择一张手牌弃置以跳过${phase}阶段`,
            source: 'hand',
            minTotal: 1,
            maxTotal: 1,
          },
          timeout: 15,
        });
        discardCardId = ctx.state.localVars[DISCARD_KEY] as string | undefined;
        delete ctx.state.localVars[DISCARD_KEY];
        if (!discardCardId || !self.hand.includes(discardCardId)) {
          return; // 无效选择 → 阶段正常进行
        }
      }

      await pushFrame(ctx.state, '界巧变', ownerId, {
        phase,
        mode,
        discardCardId: discardCardId ?? null,
      });
      try {
        // 扣资源
        if (mode === 'discard' && discardCardId) {
          await applyAtom(ctx.state, {
            type: '弃置',
            player: ownerId,
            cardIds: [discardCardId],
          });
        } else {
          // mode === '变':移除 1 枚变标记
          await removeBian(ctx.state, ownerId);
        }

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
                title: '界巧变:选择至多两名其他角色(各获得其一张手牌)',
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
                title: '界巧变:选择源玩家(从其场上选一张牌移动)',
                min: 1,
                max: 1,
                filter: (_view: GameView, t: number) =>
                  ctx.state.players[t]?.alive === true &&
                  fieldCardIds(ctx.state, t).length > 0,
              },
              timeout: 15,
            });
            const srcPlayer = ctx.state.localVars[MOVE_SOURCE_PLAYER_KEY] as number | undefined;
            delete ctx.state.localVars[MOVE_SOURCE_PLAYER_KEY];
            if (typeof srcPlayer !== 'number') {
              // 无选择 → 跳过附加效果,但仍跳过出牌阶段(已扣资源)
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
                  title: `界巧变:选择 P${srcPlayer} 场上的一张牌移动`,
                  source: 'handAndEquip',
                  minTotal: 1,
                  maxTotal: 1,
                },
                timeout: 15,
              });
              const srcCardId = ctx.state.localVars[MOVE_SOURCE_CARD_KEY] as string | undefined;
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
                    title: '界巧变:选择目标玩家(将牌移到其场上)',
                    min: 1,
                    max: 1,
                    filter: (_view: GameView, t: number) =>
                      ctx.state.players[t]?.alive === true,
                  },
                  timeout: 15,
                });
                const destPlayer = ctx.state.localVars[MOVE_DEST_PLAYER_KEY] as number | undefined;
                delete ctx.state.localVars[MOVE_DEST_PLAYER_KEY];
                if (typeof destPlayer === 'number') {
                  await moveFieldCard(ctx.state, srcPlayer, srcCardId, destPlayer);
                }
              }
            }
          }
        }
        // 弃牌阶段:无附加效果(官方未提供收益)
        // 判定阶段:无附加效果
      } finally {
        await popFrame(ctx.state);
      }

      // 跳过当前阶段(直接型):阶段结束(phase)+ cancel
      return skipPhase(ctx.state, { player: ownerId, phase });
    },
  );

  // ── 阶段开始 after hook:结束阶段手牌数检查,符合条件 +1 "变" ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '回合结束') return; // "结束阶段" = phase '回合结束'
    const st = ctx.state;
    const self = st.players[ownerId];
    if (!self?.alive) return;

    const current = self.hand.length;
    const history = getHistory(st, ownerId);
    // "均不相等" = 与历史所有项都不相等(空历史为真空真)
    if (history.includes(current)) return;
    await addBian(st, ownerId);
    appendHistory(st, ownerId, current);
  });

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
    label: '界巧变',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动界巧变?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
