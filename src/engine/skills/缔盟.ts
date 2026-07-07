// 缔盟(鲁肃·吴·主动技):出牌阶段，你可以选择两名其他角色，
// 弃置等同于这两名角色手牌数差的牌，然后交换他们的手牌。每回合限一次。
//
// 流程(主动技,后端驱动交互):
//   1. use action:出牌阶段发动(限一次)
//   2. 请求回应(choosePlayer min2/max2):鲁肃选两名其他存活角色 A、B
//   3. diff = |A.hand.length - B.hand.length|
//   4. 若 diff > 0:请求回应(useCard):鲁肃弃 diff 张手牌(不足则弃光)
//   5. 交换 A、B 手牌:记录双方手牌,逐张移动牌(移动牌 atom)
//
// 关键点:
//   - 鲁肃弃牌(不是目标弃牌),弃牌数 = 两人手牌数差的绝对值
//   - 交换后两人的手牌数不变,只是内容互换
//   - 限一次/回合:缔盟/usedThisTurn,回合用量 atom 同步到 view
//   - 限一次标记必须在第一个 await 前设置,防 dispatch 重入(同制衡/结姻)
import type { FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

const TARGET_RT = '缔盟/target'; // 鲁肃:选两名目标
const DISCARD_RT = '缔盟/discard'; // 鲁肃:选弃牌
const USED_KEY = '缔盟/usedThisTurn';
const TARGET_KEY = '缔盟/targets';
const DISCARD_KEY = '缔盟/discardCards';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '缔盟',
    description:
      '出牌阶段限一次,选择两名其他角色,弃置等同于他们手牌数差的牌,然后交换他们的手牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use action:鲁肃主动发动缔盟 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, _params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (st.players[ownerId].vars[USED_KEY]) return '本回合已使用过缔盟';
      const self = st.players[ownerId];
      if (!self?.alive) return '角色不可用';
      // 至少两名其他存活角色
      const others = st.players.filter((p) => p.alive && p.index !== ownerId);
      if (others.length < 2) return '需要至少两名其他角色';
      return null;
    },
    async (st: GameState, _params: Record<string, Json>): Promise<void> => {
      // [时序修复] 限一次标记必须在第一个 await 之前设置,防 dispatch 重入(同制衡/结姻)
      st.players[ownerId].vars[USED_KEY] = true;
      await applyAtom(st, {
        type: '回合用量',
        player: ownerId,
        key: USED_KEY,
        value: true,
      });

      await pushFrame(st, '缔盟', ownerId, {});

      // 1) 询问鲁肃选两名其他角色
      delete st.localVars[TARGET_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '缔盟:选择两名其他角色交换手牌',
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
        return; // 未选或超时
      }
      const [A, B] = targets;
      if (!st.players[A]?.alive || !st.players[B]?.alive) {
        await popFrame(st);
        return;
      }

      // 2) 计算手牌数差,鲁肃弃等量牌
      const diff = Math.abs(st.players[A].hand.length - st.players[B].hand.length);
      const actualDiscard = Math.min(diff, st.players[ownerId].hand.length);
      if (actualDiscard > 0) {
        delete st.localVars[DISCARD_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: DISCARD_RT,
          target: ownerId,
          prompt: {
            type: 'useCard',
            title: `缔盟:弃置 ${actualDiscard} 张牌`,
            cardFilter: { filter: () => true, min: actualDiscard, max: actualDiscard },
          },
          timeout: 30,
        });
        const discardCards = st.localVars[DISCARD_KEY] as string[] | undefined;
        delete st.localVars[DISCARD_KEY];
        if (discardCards && discardCards.length > 0) {
          await applyAtom(st, { type: '弃置', player: ownerId, cardIds: discardCards });
        }
      }

      // 3) 交换 A、B 手牌:记录原始手牌,逐张移动(移动牌 atom)
      //    先把 A 的牌移到 B,再把 B 的原始牌移到 A,完成交换
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

      await popFrame(st);
    },
  );

  // ── respond action:处理 target/discard 询问 ──
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
      if (rt !== TARGET_RT && rt !== DISCARD_RT) return '当前不是缔盟询问';
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
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '缔盟',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '缔盟:选择两名其他角色交换手牌',
      confirmLabel: '发动',
      cancelLabel: '取消',
    },
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) &&
      !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[USED_KEY],
  });

  api.defineAction('respond', {
    label: '缔盟',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '缔盟',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
