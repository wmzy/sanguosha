// 天义(太史慈·吴·主动技):出牌阶段限一次,你可以与一名角色拼点:
//   若你赢,本回合你攻击范围无限、可额外使用一张【杀】、使用【杀】时可额外指定一个目标;
//   若你没赢,你不能使用【杀】直到回合结束。
//
// 拼点规则(与驱虎/烈刃一致):A=1(最小),2-10=面值,J=11,Q=12,K=13。
// 点数大者赢,相等算"没赢"。拼点双方各出一张手牌,拼点后两张牌进入弃牌堆。
//
// 三项赢效果实现(均挂在 turn.vars,回合结束自动清空):
//   1. 攻击范围无限:turn.vars['天义/win']=发起者座次;distance.ts 的 inAttackRange 据此放行。
//   2. 可额外使用一张杀:注册 slashMaxProvider,win 时贡献 +1(slash-quota 提供者模式)。
//   3. 使用杀时可额外指定一个目标:杀.validate 不限目标数(参考方天画戟),配合"攻击范围无限"
//      天然成立——一张杀可对任意两名存活角色生效。
//
// 输的效果:
//   - turn.vars['天义/lost']=发起者座次;注册 slashBlocker 返回 true → canSlash=false →
//     杀.use 的 validate 拒绝("出杀次数已达上限")。无论是否装连弩都禁杀(规则:本回合不能用杀)。
//
// 限一次:player.vars['天义/usedThisTurn'](后缀约定,回合结束 atom 自动清空)。
// 目标需 respond 选拼点牌——respond action 为所有玩家注册(validate 严格校验 pending requestType)。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction } from '../skill';
import { registerSlashMaxProvider, registerSlashBlocker } from '../slash-quota';

/** 拼点牌点数:A=1, 2-10=面值, J=11, Q=12, K=13 */
function rankValue(rank: string): number {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

const USED_KEY = '天义/usedThisTurn';
const TARGET_CARD_KEY = '天义/targetCard';
const PD_RT = '天义/拼点';
const WIN_VAR = '天义/win';
const LOST_VAR = '天义/lost';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '天义',
    description:
      '出牌阶段限一次,与一名角色拼点:赢则本回合攻击范围无限、可额外使用一张杀、杀可额外指定一个目标;没赢则本回合不能使用杀',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── 出杀上限提供者:拼点赢后本回合 +1(可额外使用一张杀)──
  const unloadProvider = registerSlashMaxProvider(
    state,
    ownerId,
    (st: GameState, player: number) => (st.turn.vars[WIN_VAR] === player ? 1 : 0),
  );

  // ─── 出杀阻断器:拼点没赢后本回合禁杀(不能使用杀)──
  const unloadBlocker = registerSlashBlocker(
    state,
    ownerId,
    (st: GameState, player: number) => st.turn.vars[LOST_VAR] === player,
  );

  // ─── use action:太史慈主动发动天义 ────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (st.players[ownerId].vars[USED_KEY]) return '本回合已使用过天义';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const cardId = params.cardId as string;
      if (typeof cardId !== 'string') return '需要选择一张拼点牌';
      if (!self.hand.includes(cardId)) return '拼点牌不在手牌中';
      const target = params.target as number;
      if (typeof target !== 'number') return '需要选择拼点目标';
      if (target === ownerId) return '不能与自己拼点';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不存在或已死亡';
      if (targetPlayer.hand.length === 0) return '目标没有手牌,无法拼点';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const initiatorCardId = params.cardId as string;
      const target = params.target as number;

      // 限一次标记:在第一个 await 前设置,防 dispatch 重入(参考制衡/驱虎)
      st.players[from].vars[USED_KEY] = true;
      await applyAtom(st, { type: '回合用量', player: from, key: USED_KEY, value: true });

      await pushFrame(st, '天义', from, { ...params });

      const initiatorCard = st.cardMap[initiatorCardId];
      const initiatorValue = initiatorCard ? rankValue(initiatorCard.rank) : 0;

      // 1) 太史慈的拼点牌进处理区
      await applyAtom(st, {
        type: '移动牌',
        cardId: initiatorCardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // 2) 询问目标出拼点牌
      delete st.localVars[TARGET_CARD_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: PD_RT,
        target,
        prompt: {
          type: 'useCard',
          title: `天义:与 ${st.players[from].name} 拼点,请出一张手牌`,
          cardFilter: { min: 1, max: 1 },
        },
        timeout: 30,
      });

      const targetCardId = st.localVars[TARGET_CARD_KEY] as string | undefined;
      delete st.localVars[TARGET_CARD_KEY];

      // 目标未出牌(超时等):视为没赢。但仍需清理处理区。
      let targetValue = 0;
      if (targetCardId && st.players[target].hand.includes(targetCardId)) {
        const targetCardObj: Card | undefined = st.cardMap[targetCardId];
        targetValue = targetCardObj ? rankValue(targetCardObj.rank) : 0;
        await applyAtom(st, {
          type: '移动牌',
          cardId: targetCardId,
          from: { zone: '手牌', player: target },
          to: { zone: '处理区' },
        });
      }

      // 3) 拼点事件标记(前端动画/音效;applyView 把两张牌从处理区移入弃牌堆视图)
      await applyAtom(st, {
        type: '拼点',
        initiator: from,
        target,
        initiatorCard: initiatorCardId,
        targetCard: targetCardId ?? '',
      });

      // 4) 拼点 atom 的 apply 已把两张牌从处理区移入弃牌堆(后端 + 视图对称)。
      //    此处不再手动 splice/push,避免与 apply 重复操作。

      // 5) 结算输赢:发起方点数严格大于目标 = 赢;否则(输或平)没赢
      const win = initiatorValue > targetValue;
      if (win) {
        // 赢:三项效果(攻击范围无限 / +1 杀 / 额外目标)统一由 turn.vars['天义/win'] 驱动
        st.turn.vars[WIN_VAR] = from;
        await applyAtom(st, { type: '回合用量', player: from, key: WIN_VAR, value: true });
      } else {
        // 没赢:本回合不能使用杀(由 slashBlocker 落实)
        st.turn.vars[LOST_VAR] = from;
        await applyAtom(st, { type: '回合用量', player: from, key: LOST_VAR, value: true });
      }

      await popFrame(st);
    },
  );

  // ─── respond action:为所有玩家注册 ────────────────────────
  // 目标(其他玩家)需要 respond 选拼点牌。默认 respond 只注册在 owner(太史慈)上,
  // 目标无法 dispatch,故此处为每个玩家注册。validate 严格检查 pending requestType,
  // 非天义 pending 一律拒绝(无副作用)。
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
        if (reqType !== PD_RT) return '当前不是天义回应';
        if ((atom.target as number) !== pid) return '不是问你的';
        const cardId = params.cardId as string;
        if (typeof cardId !== 'string') return '请选择一张拼点牌';
        if (!st.players[pid].hand.includes(cardId)) return '拼点牌不在手牌中';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return;
        const atom = slot.atom as unknown as Record<string, unknown>;
        if (atom.type !== '请求回应' || (atom.requestType as string) !== PD_RT) return;
        st.localVars[TARGET_CARD_KEY] = params.cardId;
      },
    );
  }

  // actions/hooks 随 state-bound 注册表自动清理;provider/blocker 是模块级集合,需显式卸载。
  return () => {
    unloadProvider();
    unloadBlocker();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '天义',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '天义:选择一张拼点牌和一名目标',
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
      !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[USED_KEY] &&
      (ctx.view.players[ctx.perspectiveIdx]?.hand?.length ?? 0) > 0,
  });

  // respond(拼点牌选择):前端通过 pending prompt 渲染,此处声明让前端识别为天义回应。
  api.defineAction('respond', {
    label: '天义',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '天义:请出一张拼点牌',
      cardFilter: { min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount };
