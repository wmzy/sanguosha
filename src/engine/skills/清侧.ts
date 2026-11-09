import type { FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { hasBlockingPending, registerAction } from '../core/skill';
import { runPickTargetCardPanel } from '../flows/pick-card-panel';
import { PICK_RESULT_KEY } from '../rules/vars-keys';
import { RONG_CARDS_KEY, RONG_PREFIX } from './征荣';

const PICK_RONG_RT = '清侧/移去荣';
const PICK_CARD_RT = '清侧/弃牌';
const PICK_TARGET_RT = '清侧/选目标';
const RONG_KEY = '清侧/所选荣';
const TARGET_KEY = '清侧/所选目标';

function hasFieldCard(state: GameState, target: number): boolean {
  const player = state.players[target];
  return !!player && (Object.values(player.equipment).some(Boolean) || player.pendingTricks.length > 0);
}

function rongMarks(state: GameState, ownerId: number) {
  return state.players[ownerId].marks.filter((mark) => mark.id.startsWith(RONG_PREFIX));
}

function eligibleTargets(state: GameState): number[] {
  return state.players.filter((player) => player.alive && hasFieldCard(state, player.index)).map((player) => player.index);
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '清侧',
    description: '出牌阶段，你可以移去一张荣，然后弃置场上的一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const unloadRespond = registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st, params) => {
      const slot = st.pendingSlots.get(ownerId);
      const atom = slot?.atom as { type?: string; requestType?: string } | undefined;
      if (atom?.type !== '请求回应' || ![PICK_TARGET_RT, PICK_RONG_RT, PICK_CARD_RT].includes(atom.requestType ?? '')) return '当前不是清侧选择';
      if (atom.requestType === PICK_TARGET_RT) {
        const target = (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
        if (typeof target !== 'number' || !eligibleTargets(st).includes(target)) return '请选择一名有装备或判定区牌的存活角色';
        return null;
      }
      if (atom.requestType === PICK_RONG_RT) {
        const selected = params.cardIds as string[] | undefined;
        if (!Array.isArray(selected) || selected.length !== 1) return '请选择一张荣';
        const mark = rongMarks(st, ownerId).find((item) =>
          (item.payload as { cardId?: string } | undefined)?.cardId === selected[0]);
        const stored = st.players[ownerId].vars[RONG_CARDS_KEY] as string[] | undefined;
        if (!mark || !(stored?.includes(selected[0]) || st.zones.discardPile.includes(selected[0]))) return '此牌不是当前可移去的荣';
        return null;
      }
      if (params.zone === 'equipment' || params.zone === 'judge') {
        if (typeof params.cardId !== 'string') return '请选择一张牌';
      } else return 'zone required';
      return null;
    },
    async (st, params) => {
      const slot = st.pendingSlots.get(ownerId);
      const requestType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (requestType === PICK_TARGET_RT) {
        const target = (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
        if (typeof target === 'number') st.localVars[TARGET_KEY] = target;
      } else if (requestType === PICK_RONG_RT) st.localVars[RONG_KEY] = (params.cardIds as string[])[0];
      else st.localVars[PICK_RESULT_KEY] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: null,
        };
    },
  );

  const unloadUse = registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st, _params) => {
      if (st.currentPlayerIndex !== ownerId || st.phase !== '出牌' || hasBlockingPending(st)) return '仅能在自己的出牌阶段使用';
      if (!st.players[ownerId]?.alive || rongMarks(st, ownerId).length === 0) return '没有可移去的荣';
      if (eligibleTargets(st).length === 0) return '场上没有可弃置的装备区或判定区牌';
      return null;
    },
    async (st) => {
      delete st.localVars[TARGET_KEY];
      await applyAtom(st, {
        type: '请求回应', requestType: PICK_TARGET_RT, target: ownerId,
        prompt: {
          type: 'choosePlayer', title: '清侧:选择一名有装备区或判定区牌的角色',
          min: 1, max: 1, candidates: eligibleTargets(st),
        },
        defaultChoice: eligibleTargets(st)[0] as unknown as Json, timeout: 20,
      });
      const target = st.localVars[TARGET_KEY] as number | undefined;
      delete st.localVars[TARGET_KEY];
      if (typeof target !== 'number' || !eligibleTargets(st).includes(target)) return;
      const candidates = rongMarks(st, ownerId).map((mark) => (mark.payload as { cardId?: string } | undefined)?.cardId)
        .filter((id): id is string => typeof id === 'string' && (
          (st.players[ownerId].vars[RONG_CARDS_KEY] as string[] | undefined)?.includes(id) === true ||
          st.zones.discardPile.includes(id)
        ));
      await applyAtom(st, {
        type: '请求回应', requestType: PICK_RONG_RT, target: ownerId,
        prompt: {
          type: 'distribute', mode: 'select', title: '清侧:选择要移去的荣', cardIds: candidates,
          minTotal: 1, maxTotal: 1,
        },
        defaultChoice: candidates[0] ? [candidates[0]] : [], timeout: 20,
      });
      const cardId = st.localVars[RONG_KEY] as string | undefined;
      delete st.localVars[RONG_KEY];
      const mark = rongMarks(st, ownerId).find((item) =>
        (item.payload as { cardId?: string } | undefined)?.cardId === cardId);
      if (!mark || !cardId) return;
      await applyAtom(st, { type: '去标记', player: ownerId, markId: mark.id });
      if (cardId && (st.players[ownerId].vars[RONG_CARDS_KEY] as string[] | undefined)?.includes(cardId)) {
        await applyAtom(st, { type: '移动暂存牌', player: ownerId, varsKey: RONG_CARDS_KEY, cardId, to: '弃牌堆' });
      }

      await runPickTargetCardPanel(st, ownerId, target, st.players[target], {
        mode: 'discard',
        requestType: PICK_CARD_RT,
        title: '清侧：弃置场上一张牌',
        includeJudge: true,
        includeHand: false,
      });
    },
  );
  return () => { unloadRespond(); unloadUse(); };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '清侧',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动清侧？',
      confirmLabel: '发动',
      cancelLabel: '取消',
    },
    activeWhen: ({ view, perspectiveIdx }) =>
      perspectiveIdx === view.currentPlayerIndex && view.phase === '出牌' && !view.pending &&
      view.players[perspectiveIdx]?.marks.some((mark) => mark.id.startsWith(RONG_PREFIX)) === true &&
      view.players.some((player) => player.alive &&
        (Object.values(player.equipment).some(Boolean) || (player.pendingTricks?.length ?? 0) > 0)),
  });
}

const module: SkillModule = { createSkill, onInit, onMount };
export default module;
