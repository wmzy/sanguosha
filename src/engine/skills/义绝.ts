// 义绝(界关羽·蜀·主动技):出牌阶段，你可以弃置一张牌，然后令一名其他角色展示所有手牌，
// 你选择其中一张，其弃置此牌，然后若其弃置的牌不为♥，你摸一张牌。(每回合限一次)
//
// 流程(主动技):
//   1. use action:出牌阶段弃置一张手牌(代价) + 指定一名其他有手牌的角色(限一次/回合)
//   2. 目标展示所有手牌(通过 pickProcessingCard prompt 列出目标手牌明牌给发起者)
//   3. 发起者(义绝owner)选一张 → 请求回应 target=ownerId
//   4. 目标弃置选中牌(弃置 atom)
//   5. 若弃置牌花色≠♥ → 发起者摸一张牌(摸牌 atom)
//
// 关键点:
//   - 每回合限一次:义绝/usedThisTurn(once-per-turn 工具)
//   - "展示所有手牌":目标的全部手牌通过 pickProcessingCard prompt 明牌列出,发起者可见
//   - 选牌请求 target=ownerId(发起者选择),respond 注册在 ownerId 座次
//   - 超时兜底:选目标手牌第一张(不放弃拆牌机会)
//   - ♥检查:suit !== '♥' 才摸牌(♥不摸,非♥摸)
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

const PICK_REQUEST = '义绝/选牌';
const PICK_KEY = '义绝/cardId';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '义绝',
    description: '出牌阶段弃置一张牌,令一名其他角色展示手牌,你选一张其弃之,非♥你摸一张',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use action:出牌阶段弃牌(代价) + 指定目标 ──────────────
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
      if (usedThisTurn(st, ownerId, '义绝')) return '本回合已使用过义绝';
      // 代价牌:必须在手牌中
      const cardId = params.cardId as string | undefined;
      if (!cardId) return '请选择要弃置的牌';
      if (!self.hand.includes(cardId)) return '弃置的牌必须在手牌中';
      // 目标:其他存活角色且有手牌
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length !== 1) return '需要指定一名目标';
      const target = targets[0];
      if (target === ownerId) return '不能对自己使用义绝';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不合法';
      if (targetPlayer.hand.length === 0) return '目标没有手牌';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = (params.targets as number[])[0];
      const costCardId = params.cardId as string;
      await pushFrame(st, '义绝', from, { ...params });

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, from, '义绝');

      // ── 弃置代价牌 ──
      await applyAtom(st, { type: '弃置', player: from, cardIds: [costCardId] });

      // ── 目标展示所有手牌 + 发起者选一张 ──
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive || targetPlayer.hand.length === 0) {
        await popFrame(st);
        return;
      }

      const cards = targetPlayer.hand
        .map((id) => {
          const c = st.cardMap[id];
          if (!c) return null;
          return { cardId: id, cardName: c.name, suit: c.suit, rank: c.rank };
        })
        .filter(
          (c): c is { cardId: string; cardName: string; suit: Card['suit']; rank: string } =>
            c !== null,
        );

      delete st.localVars[PICK_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: PICK_REQUEST,
        target: from,
        prompt: {
          type: 'pickProcessingCard',
          title: '义绝:选择目标一张手牌弃置(♥则不摸牌,非♥则你摸一张)',
          cards,
        },
        timeout: 30,
      });

      // 读取发起者的选择(超时兜底:选目标手牌第一张,不放弃拆牌机会)
      let pickedId = st.localVars[PICK_KEY] as string | undefined;
      const targetHand = st.players[target]?.hand ?? [];
      if (!pickedId || !targetHand.includes(pickedId)) {
        pickedId = targetHand[0];
      }
      delete st.localVars[PICK_KEY];

      // ── 目标弃置选中牌 ──
      if (pickedId && targetHand.includes(pickedId)) {
        await applyAtom(st, { type: '弃置', player: target, cardIds: [pickedId] });

        // ── 若弃置牌花色≠♥,发起者摸一张 ──
        const card = st.cardMap[pickedId];
        if (card && card.suit !== '♥' && st.players[from]?.alive) {
          await applyAtom(st, { type: '摸牌', player: from, count: 1 });
        }
      }

      await popFrame(st);
    },
  );

  // ── respond:发起者选一张牌(注册在 ownerId 座次) ──
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
      if (atom['requestType'] !== PICK_REQUEST) return '当前不是义绝选牌';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return '请选择一张牌';
      // 从帧参数获取目标座次,校验 cardId 在目标当前手牌中
      const frame = st.settlementStack[st.settlementStack.length - 1];
      const targets = frame?.params['targets'] as number[] | undefined;
      const target = targets?.[0];
      if (target === undefined || !st.players[target]?.hand.includes(cardId)) {
        return '该牌不在可选范围';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[PICK_KEY] = params.cardId;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '义绝',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '义绝:弃置一张牌,令一名其他角色展示手牌',
      cardFilter: { min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) => t !== skill.ownerId && (view.players[t]?.handCount ?? 0) > 0,
      },
    },
    activeWhen: (ctx) => {
      if (!activeUnlessUsedThisTurn('义绝')(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 需要有手牌作为代价,且存在有手牌的其他存活角色
      const hasHand = (p.hand?.length ?? 0) > 0;
      if (!hasHand) return false;
      const hasTarget = ctx.view.players.some(
        (other) => other.index !== skill.ownerId && other.alive && (other.handCount ?? 0) > 0,
      );
      return hasTarget;
    },
  });

  api.defineAction('respond', {
    label: '义绝',
    style: 'danger',
    prompt: {
      type: 'pickProcessingCard',
      title: '义绝:选择目标一张手牌弃置',
      cards: [],
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
