// 攻心(界吕蒙·吴·衍生技,由勤学获得;OL hero/306):
//   "出牌阶段限一次,你可以观看一名其他角色的手牌,然后你可以展示其中一张♥牌
//    并选择一项:1.弃置此牌;2.将此牌置于牌堆顶。"
//
// 流程(主动技,出牌阶段限一次):
//   1. use:选一名有手牌的其他角色。限一次标记(once-per-turn 工具)。
//   2. pickProcessingCard:列出目标手牌中的♥牌给吕蒙(观看=仅吕蒙可见)。
//      - 目标无♥牌:观看后直接结束(无可展示牌)。
//      - 吕蒙可选一张♥(展示)或放弃(pass/超时=不展示)。
//   3. 若选了♥:展示(公开牌面)→ 二选一:弃置(目标弃此牌) / 置牌堆顶(此牌→牌堆顶)。
//
// 关键点:
//   - 限一次:攻心/usedThisTurn(once-per-turn 工具)。
//   - 观看手牌:信息分级——pickProcessingCard 的 cards 只给发起者(target=ownerId)可见,
//     其他人仅看到"观看"事件,不见牌面(引擎 pending prompt 按 target 分发)。
//   - 置牌堆顶:牌堆顶=deck 末尾(摸牌 atom 从末尾抽 slice(-count)),故 移动牌 to '牌堆' 即置顶。
//   - 展示:复用「展示」atom 公开牌面(apply no-op,广播 cardId+牌面)。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

const PICK_REQUEST = '攻心/选牌';
const PICK_KEY = '攻心/cardId';
const CHOOSE_RT = '攻心/选效果';
const CHOICE_KEY = '攻心/effect';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '攻心',
    description:
      '出牌阶段限一次,观看一名其他角色手牌,可展示其中一张♥牌,弃置之或将之置于牌堆顶',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use action:出牌阶段选一名有手牌的其他角色 ──────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>) => {
      const self = st.players[ownerId];
      if (!self) return 'player not found';
      if (!self.alive) return '你已死亡';
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, '攻心')) return '本回合已使用过攻心';
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length !== 1) return '需要指定一名目标';
      const target = targets[0];
      if (target === ownerId) return '不能对自己使用攻心';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不合法';
      if (targetPlayer.hand.length === 0) return '目标没有手牌';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = (params.targets as number[])[0];
      await pushFrame(st, '攻心', from, { target });

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, from, '攻心');

      // ── 观看目标手牌中的♥牌(列给发起者)──
      const hearts = st.players[target].hand
        .map((id) => {
          const c = st.cardMap[id];
          if (!c || c.suit !== '♥') return null;
          return { cardId: id, cardName: c.name, suit: c.suit, rank: c.rank };
        })
        .filter(
          (c): c is { cardId: string; cardName: string; suit: '♥'; rank: string } =>
            c !== null,
        );

      // 无♥牌:观看后无可展示牌,直接结束(已计一次)
      if (hearts.length === 0) {
        await popFrame(st);
        return;
      }

      // ── 发起者选一张♥牌(展示)或放弃 ──
      delete st.localVars[PICK_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: PICK_REQUEST,
        target: from,
        prompt: {
          type: 'pickProcessingCard',
          title: '攻心:选择目标一张♥牌展示(放弃则不展示)',
          cards: hearts,
        },
        timeout: 30,
      });

      const pickedId = st.localVars[PICK_KEY] as string | undefined;
      delete st.localVars[PICK_KEY];
      // 放弃/超时(未选或已不在目标手牌)→ 不展示,结束
      if (!pickedId || !st.players[target]?.hand.includes(pickedId)) {
        await popFrame(st);
        return;
      }

      // ── 展示此♥牌(公开牌面)──
      await applyAtom(st, { type: '展示', player: target, cardId: pickedId });

      // ── 二选一:弃置 / 置牌堆顶 ──
      delete st.localVars[CHOICE_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CHOOSE_RT,
        target: from,
        prompt: {
          type: 'confirm',
          title: '攻心:弃置此♥牌,还是将之置于牌堆顶?',
          confirmLabel: '弃置',
          cancelLabel: '置牌堆顶',
        },
        defaultChoice: false,
        timeout: 30,
      });
      const effect = st.localVars[CHOICE_KEY] as string | undefined;
      delete st.localVars[CHOICE_KEY];

      if (effect === 'discard') {
        // 弃置:目标弃此牌
        if (st.players[target]?.hand.includes(pickedId)) {
          await applyAtom(st, { type: '弃置', player: target, cardIds: [pickedId] });
        }
      } else {
        // 置牌堆顶:此牌从目标手牌→牌堆顶(deck 末尾)
        if (st.players[target]?.hand.includes(pickedId)) {
          await applyAtom(st, {
            type: '移动牌',
            cardId: pickedId,
            from: { zone: '手牌', player: target },
            to: { zone: '牌堆' },
          });
        }
      }

      await popFrame(st);
    },
  );

  // ── respond:发起者选♥牌 ──
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
      if (rt === PICK_REQUEST) {
        const cardId = params.cardId as string | undefined;
        if (cardId !== undefined) {
          // 校验:必须在目标当前手牌中且为♥
          const frame = st.settlementStack[st.settlementStack.length - 1];
          const target = frame?.params['target'] as number | undefined;
          if (target === undefined || !st.players[target]?.hand.includes(cardId)) {
            return '该牌不在可选范围';
          }
          if (st.cardMap[cardId]?.suit !== '♥') return '只能选择♥牌';
        }
        // cardId 未传 = 放弃(不展示),合法
        return null;
      }
      if (rt === CHOOSE_RT) return null;
      return '当前不是攻心回应';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === PICK_REQUEST) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId === 'string') st.localVars[PICK_KEY] = cardId;
      } else if (rt === CHOOSE_RT) {
        // choice=true → 弃置;choice=false → 置牌堆顶
        st.localVars[CHOICE_KEY] = params.choice === true ? 'discard' : 'top';
      }
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '攻心',
    style: 'primary',
    prompt: {
      type: 'selectTarget',
      title: '攻心:观看一名其他角色的手牌',
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) => t !== skill.ownerId && (view.players[t]?.handCount ?? 0) > 0,
      },
    },
    activeWhen: (ctx) => {
      if (!activeUnlessUsedThisTurn('攻心')(ctx)) return false;
      // 需存在有手牌的其他存活角色
      return ctx.view.players.some(
        (other) => other.index !== skill.ownerId && other.alive && (other.handCount ?? 0) > 0,
      );
    },
  });

  api.defineAction('respond', {
    label: '攻心',
    style: 'primary',
    prompt: {
      type: 'pickProcessingCard',
      title: '攻心:选择目标一张♥牌展示',
      cards: [],
    },
  });

  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
