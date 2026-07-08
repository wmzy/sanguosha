// 驱虎(荀彧·主动技):出牌阶段限一次,你可以与一名角色拼点:
//   若你赢,该角色对其攻击范围内另一名角色造成 1 点伤害;
//   若你没赢,该角色对你造成 1 点伤害。
//
// 拼点规则:A=1(最小),2-10=面值,J=11,Q=12,K=13。点数大者赢,相等算"没赢"。
// 拼点双方各出一张手牌,拼点后两张牌进入弃牌堆。
//
// 设计要点:
//   - 目标需要 respond 选择拼点牌。但 respond action 默认只注册在技能 owner(荀彧)身上,
//     目标(其他玩家)无法 dispatch。因此本技能在 onInit 时为所有玩家注册 respond action,
//     validate 严格检查 pending requestType,非驱虎 pending 时拒绝(无副作用)。
//   - 每回合限一次:用 player.vars['驱虎/usedThisTurn'] + 回合用量 atom 同步 view。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction } from '../skill';
import { inAttackRange } from '../distance';

/** 拼点牌点数:A=1, 2-10=面值, J=11, Q=12, K=13 */
function rankValue(rank: string): number {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '驱虎',
    description: '出牌阶段限一次,与一名角色拼点:赢则该角色对其攻击范围内另一角色造成1伤害,没赢则其对你造成1伤害',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── use action:荀彧主动发动驱虎 ──────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (state.phase !== '出牌') return '只能在出牌阶段发动';
      if (state.players[ownerId].vars['驱虎/usedThisTurn']) return '本回合已使用过驱虎';
      const self = state.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const cardId = params.cardId as string;
      if (typeof cardId !== 'string') return '需要选择拼点牌';
      if (!self.hand.includes(cardId)) return '拼点牌不在手牌中';
      const target = params.target as number;
      if (typeof target !== 'number') return '需要选择拼点目标';
      if (target === ownerId) return '不能与自己拼点';
      const targetPlayer = state.players[target];
      if (!targetPlayer?.alive) return '目标不存在或已死亡';
      if (targetPlayer.hand.length === 0) return '目标没有手牌,无法拼点';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const initiatorCardId = params.cardId as string;
      const target = params.target as number;

      // 限一次标记:在第一个 await 前设置,防 dispatch 重入(参考制衡)
      state.players[from].vars['驱虎/usedThisTurn'] = true;
      await applyAtom(state, {
        type: '回合用量',
        player: from,
        key: '驱虎/usedThisTurn',
        value: true,
      });

      await pushFrame(state, '驱虎', from, { ...params });

      const initiatorCard = state.cardMap[initiatorCardId];
      const initiatorValue = initiatorCard ? rankValue(initiatorCard.rank) : 0;

      // 1) 荀彧的拼点牌进处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId: initiatorCardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // 2) 询问目标出拼点牌
      delete state.localVars['驱虎/targetCard'];
      await applyAtom(state, {
        type: '请求回应',
        requestType: '驱虎/拼点',
        target,
        prompt: {
          type: 'useCard',
          title: `驱虎:与 ${state.players[from].name} 拼点,请出一张手牌`,
          cardFilter: { min: 1, max: 1 },
        },
        timeout: 30,
      });

      const targetCardId = state.localVars['驱虎/targetCard'] as string | undefined;
      delete state.localVars['驱虎/targetCard'];

      // 目标未出牌(超时等):视为没赢,荀彧受伤。但仍需清理处理区。
      let targetValue = 0;
      let targetCardObj: Card | undefined;
      if (targetCardId && state.players[target].hand.includes(targetCardId)) {
        targetCardObj = state.cardMap[targetCardId];
        targetValue = targetCardObj ? rankValue(targetCardObj.rank) : 0;
        await applyAtom(state, {
          type: '移动牌',
          cardId: targetCardId,
          from: { zone: '手牌', player: target },
          to: { zone: '处理区' },
        });
      }

      // 3) 拼点事件标记(前端动画/音效;applyView 把两张牌从处理区移入弃牌堆视图)
      await applyAtom(state, {
        type: '拼点',
        initiator: from,
        target,
        initiatorCard: initiatorCardId,
        targetCard: targetCardId ?? '',
      });

      // 4) 拼点 atom 的 apply 已把两张牌从处理区移入弃牌堆(后端 + 视图对称)。
      //    此处不再手动 splice/push,避免与 apply 重复操作。

      // 5) 结算输赢
      const win = initiatorValue > targetValue;
      if (win) {
        // 荀彧赢:目标对其攻击范围内另一名角色造成 1 点伤害(荀彧选目标)
        // 检查目标的攻击范围内是否有可选角色
        const candidates = state.players
          .filter(
            (p) => p.alive && p.index !== target && inAttackRange(state, target, p.index),
          )
          .map((p) => p.index);

        if (candidates.length === 0) {
          // 目标攻击范围内无其他角色,无法造成伤害,驱虎结算结束
          await popFrame(state);
          return;
        }

        delete state.localVars['驱虎/victim'];
        await applyAtom(state, {
          type: '请求回应',
          requestType: '驱虎/选目标',
          target: from,
          prompt: {
            type: 'choosePlayer',
            title: `驱虎:选择 ${state.players[target].name} 攻击范围内的一名角色,其将受到1点伤害`,
            min: 1,
            max: 1,
            filter: () => true, // 后端 validate 已校验;前端用 activeWhen 控制
          },
          timeout: 30,
        });

        const victim = state.localVars['驱虎/victim'] as number | undefined;
        delete state.localVars['驱虎/victim'];
        if (typeof victim === 'number' && state.players[victim]?.alive && victim !== target) {
          if (inAttackRange(state, target, victim)) {
            await applyAtom(state, {
              type: '造成伤害',
              target: victim,
              source: target,
              amount: 1,
            });
          }
        }
      } else {
        // 荀彧没赢(输或平):目标对荀彧造成 1 点伤害
        await applyAtom(state, {
          type: '造成伤害',
          target: from,
          source: target,
          amount: 1,
        });
      }

      await popFrame(state);
    },
  );

  // ─── respond action:为所有玩家注册 ────────────────────────
  // 目标(其他玩家)需要 respond 选拼点牌;荀彧赢后荀彧自己也要 respond 选伤害目标。
  // 默认 respond 只注册在 owner(荀彧)上,目标无法 dispatch,故此处为每个玩家注册。
  // validate 严格检查 pending requestType,非驱虎 pending 一律拒绝(无副作用)。
  for (const p of state.players) {
    const pid = p.index;
    registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as unknown as Record<string, unknown>;
        if (atom.type !== '请求回应') return '当前不需要回应';
        const reqType = atom.requestType as string;
        if (reqType === '驱虎/拼点') {
          // 目标出拼点牌:校验 cardId 在手牌中
          const cardId = params.cardId as string;
          if (typeof cardId !== 'string') return '请选择一张拼点牌';
          if (!st.players[pid].hand.includes(cardId)) return '拼点牌不在手牌中';
          return null;
        }
        if (reqType === '驱虎/选目标') {
          // 仅荀彧(ownerId)可选目标;且必须是合法目标
          if (pid !== ownerId) return '只有驱虎发动者可以选择目标';
          const victim = params.target as number;
          if (typeof victim !== 'number') return '请选择一名目标';
          return null;
        }
        return '当前不是驱虎回应';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return;
        const atom = slot.atom as unknown as Record<string, unknown>;
        const reqType = atom.requestType as string;
        if (reqType === '驱虎/拼点') {
          st.localVars['驱虎/targetCard'] = params.cardId;
        } else if (reqType === '驱虎/选目标') {
          st.localVars['驱虎/victim'] = params.target;
        }
      },
    );
  }

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '驱虎',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '驱虎:选择一张拼点牌和一名目标',
      cardFilter: { min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) => {
          const me = view.currentPlayerIndex;
          if (t === me) return false;
          const tp = view.players[t];
          if (!tp) return false;
          return tp.alive !== false && (tp.handCount ?? 0) > 0;
        },
      },
    },
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) &&
      !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.['驱虎/usedThisTurn'] &&
      (ctx.view.players[ctx.perspectiveIdx]?.hand?.length ?? 0) > 0,
  });

  // respond(拼点牌选择 / 伤害目标选择):前端通过 pending prompt 渲染,
  // 此处声明让前端识别为驱虎回应。
  api.defineAction('respond', {
    label: '驱虎',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '驱虎:请出一张拼点牌',
      cardFilter: { min: 1, max: 1 },
    },
  });
}
