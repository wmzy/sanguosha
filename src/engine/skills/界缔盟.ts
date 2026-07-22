// 界缔盟(界鲁肃·吴·界限突破):出牌阶段限一次，
//   你可以令两名其他角色交换手牌（两者手牌数之差不大于你的牌数量），
//   若如此做，出牌阶段结束时，你弃置X张牌（X为这两名角色手牌数之差）。
//
// 官方文本(hero/485 逐字):
//   "出牌阶段限一次，你可以令两名其他角色交换手牌（两者手牌数之差不大于你的牌数量），
//    若如此做，出牌阶段结束时，你弃置X张牌（X为这两名角色手牌数之差）。"
//
// 与标缔盟三处实质差异:
//   1. 前置条件:两者手牌数差 ≤ 鲁肃的牌数(手牌+装备)
//   2. 结算顺序:先交换手牌,后弃牌(标版是先弃后换)
//   3. 弃牌时机:出牌阶段结束时延迟弃(标版是交换前立即弃)
//
// 实现:
//   use action: 选两名角色 → 校验差值 ≤ 鲁肃牌数 → 立即交换手牌 → 记录 X
//   阶段结束 after hook: 出牌阶段结束时,鲁肃弃 X 张牌(X=交换时记录的手牌数差)
//
// 命名:文件名/loader key/character name = '界缔盟';内部 Skill.name = '缔盟'。
import type {
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, registerAfterHook, hasBlockingPending, type SkillModule } from '../skill';

const TARGET_RT = '界缔盟/target';
const DISCARD_RT = '界缔盟/discard';
const TARGET_KEY = '界缔盟/targets';
const DISCARD_KEY = '界缔盟/discardCards';
/** 出牌阶段结束时待弃牌数(X)。localVars: 鲁肃座次 → 弃牌数 */
const PENDING_DISCARD_KEY = '界缔盟/待弃数';
/** localVars: 出牌阶段结束时弃牌的归属者(鲁肃座次) */
const PENDING_OWNER_KEY = '界缔盟/待弃归属';

const DISPLAY_NAME = '缔盟';
const activeCheck = activeUnlessUsedThisTurn('界缔盟');

/** 鲁肃的总牌数(手牌+装备) */
function totalCardCount(state: GameState, player: number): number {
  const p = state.players[player];
  if (!p) return 0;
  const handCount = p.hand.length;
  const equipCount = Object.values(p.equipment).filter(
    (id): id is string => typeof id === 'string',
  ).length;
  return handCount + equipCount;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次,令两名角色交换手牌(差不大于你的牌数),出牌阶段结束时弃X张牌(X为手牌数差)',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use action:鲁肃主动发动界缔盟 ──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, _params: Record<string, Json>): string | null => {
        if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
        if (st.phase !== '出牌') return '只能在出牌阶段发动';
        if (hasBlockingPending(st)) return '当前有未完成的询问';
        if (usedThisTurn(st, ownerId, '界缔盟')) return '本回合已使用过缔盟';
        const self = st.players[ownerId];
        if (!self?.alive) return '角色不可用';
        const others = st.players.filter((p) => p.alive && p.index !== ownerId);
        if (others.length < 2) return '需要至少两名其他角色';
        return null;
      },
      async (st: GameState, _params: Record<string, Json>): Promise<void> => {
        await markOncePerTurn(st, ownerId, '界缔盟');
        await pushFrame(st, '界缔盟', ownerId, {});

        // 1) 询问鲁肃选两名其他角色
        delete st.localVars[TARGET_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: TARGET_RT,
          target: ownerId,
          prompt: {
            type: 'choosePlayer',
            title: '缔盟:选择两名其他角色交换手牌(差不大于你的牌数)',
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
          return;
        }
        const [A, B] = targets;
        if (!st.players[A]?.alive || !st.players[B]?.alive) {
          await popFrame(st);
          return;
        }

        // 2) 校验前置条件:两者手牌数差 ≤ 鲁肃的牌数(手牌+装备)
        const diff = Math.abs(st.players[A].hand.length - st.players[B].hand.length);
        const myCards = totalCardCount(st, ownerId);
        if (diff > myCards) {
          await popFrame(st);
          return; // 差值超过鲁肃牌数,不执行
        }

        // 3) 界版:先交换手牌(不等弃牌)
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

        // 4) 记录延迟弃牌:X=手牌数差,出牌阶段结束时弃
        if (diff > 0) {
          st.localVars[PENDING_DISCARD_KEY] = diff;
          st.localVars[PENDING_OWNER_KEY] = ownerId;
        }

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
        const slot = st.pendingSlots.get(ownerId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        const rt = atom['requestType'] as string;
        if (rt !== TARGET_RT && rt !== DISCARD_RT) return '当前不是界缔盟询问';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(ownerId);
        const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
        if (rt === TARGET_RT) {
          const targets = params.targets as number[] | undefined;
          if (Array.isArray(targets) && targets.length === 2) {
            st.localVars[TARGET_KEY] = targets;
          }
        } else if (rt === DISCARD_RT) {
          const ids = params.cardIds as string[] | undefined;
          if (Array.isArray(ids)) st.localVars[DISCARD_KEY] = ids;
        }
      },
    ),
  );

  // ── 阶段结束 after hook:出牌阶段结束时,鲁肃弃 X 张牌 ──
  unloaders.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '阶段结束',
      async (ctx): Promise<void> => {
        const atom = ctx.atom;
        if (atom.phase !== '出牌') return;
        if (atom.player !== ownerId) return;

        const st = ctx.state;
        const pendingX = st.localVars[PENDING_DISCARD_KEY] as number | undefined;
        const pendingOwner = st.localVars[PENDING_OWNER_KEY] as number | undefined;
        if (typeof pendingX !== 'number' || pendingOwner !== ownerId) return;
        // 清除标记(无论是否成功弃牌)
        delete st.localVars[PENDING_DISCARD_KEY];
        delete st.localVars[PENDING_OWNER_KEY];

        if (!st.players[ownerId]?.alive) return;
        const actualDiscard = Math.min(pendingX, st.players[ownerId].hand.length);
        if (actualDiscard <= 0) return;

        delete st.localVars[DISCARD_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: DISCARD_RT,
          target: ownerId,
          prompt: {
            type: 'useCard',
            title: `缔盟:出牌阶段结束,弃置 ${actualDiscard} 张牌`,
            cardFilter: { filter: () => true, min: actualDiscard, max: actualDiscard },
          },
          timeout: 30,
        });
        const discardCards = st.localVars[DISCARD_KEY] as string[] | undefined;
        delete st.localVars[DISCARD_KEY];
        if (discardCards && discardCards.length > 0) {
          await applyAtom(st, { type: '弃置', player: ownerId, cardIds: discardCards });
        }
      },
    ),
  );

  return () => unloaders.forEach((fn) => fn());
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '缔盟:选择两名其他角色交换手牌',
      confirmLabel: '发动',
      cancelLabel: '取消',
    },
    activeWhen: (ctx) => activeCheck(ctx),
  });

  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: DISPLAY_NAME,
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
