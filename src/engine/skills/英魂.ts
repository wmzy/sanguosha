// 英魂(孙坚·主动技):回合开始阶段,若你已受伤,可令一名其他角色选择一项:
//   1.摸X张牌再弃一张牌;2.摸一张牌再弃X张牌(X为你已损失体力值)。每回合限一次。
//
// 模式:阶段开始(准备) before-hook 触发("准备"阶段即"回合开始阶段")。
//   准备阶段 → 已受伤(HP<上限) → 询问孙坚是否发动 → 选一名其他角色 →
//   该角色二选一(摸X弃1 / 摸1弃X) → 执行摸牌 + 目标自选弃牌。
//
// 关键点:
//   - X = 孙坚体力上限 - 当前体力值(已损失体力值)。
//   - 目标自己选弃哪些牌(标准规则:弃自己的牌由自己选)。
//   - 弃牌数 clamp 到目标当前手牌数(手牌不足时弃光)。
//   - "每回合限一次":准备阶段每回合仅由 回合管理 派发一次,phase+myTurn 三重门控,
//     无需额外计数标记。
//   - 目标可能是任意座次,故 respond action 注册到每个座次
//     (dispatch 按 skillId+ownerId+actionType 精确路由,以 skillId='英魂' 隔离)。
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';

const CONFIRM_RT = '英魂/confirm'; // 孙坚:是否发动
const TARGET_RT = '英魂/target'; // 孙坚:选目标
const OPTION_RT = '英魂/option'; // 目标:二选一
const DISCARD_RT = '英魂/discard'; // 目标:选弃牌

const CONFIRMED_KEY = '英魂/confirmed';
const TARGET_KEY = '英魂/target';
const OPTION_KEY = '英魂/option'; // 'opt1' | 'opt2'
const DISCARD_KEY = '英魂/discardCards';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '英魂',
    description:
      '回合开始阶段,若你已受伤,可令一名其他角色选择一项:摸X张牌再弃一张牌,或摸一张牌再弃X张牌(X为你已损失体力值)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:每个座次注册一份。孙坚座次处理 confirm/target;目标座次处理 option/discard。
  // 以 requestType 区分四种询问,互不冲突。
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, _params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        const rt = atom['requestType'] as string;
        if (
          rt !== CONFIRM_RT &&
          rt !== TARGET_RT &&
          rt !== OPTION_RT &&
          rt !== DISCARD_RT
        ) {
          return '当前不是英魂询问';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        const rt = (
          slot?.atom as unknown as { requestType?: string } | undefined
        )?.requestType;
        if (rt === CONFIRM_RT) {
          st.localVars[CONFIRMED_KEY] = params.choice === true;
        } else if (rt === TARGET_RT) {
          const t =
            (params.targets as number[] | undefined)?.[0] ??
            (typeof params.target === 'number'
              ? (params.target)
              : undefined);
          if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
        } else if (rt === OPTION_RT) {
          // choice===true → 选项1(摸X弃1);否则 → 选项2(摸1弃X)
          st.localVars[OPTION_KEY] = params.choice === true ? 'opt1' : 'opt2';
        } else if (rt === DISCARD_RT) {
          const ids = params.cardIds as string[] | undefined;
          if (Array.isArray(ids)) st.localVars[DISCARD_KEY] = ids;
        }
      },
    );
    unloaders.push(u);
  }

  // 阶段开始(准备) before:英魂主逻辑
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '准备') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      // 发动条件:已受伤(当前体力 < 体力上限)
      if (self.health >= self.maxHealth) return;
      // X = 已损失体力值
      const x = self.maxHealth - self.health;

      // 1) 询问是否发动
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动英魂?(令一名其他角色摸弃,X=${x})`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return;

      // 2) 选一名其他角色(存活且非自己)
      delete ctx.state.localVars[TARGET_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '英魂:选择一名其他角色',
          min: 1,
          max: 1,
          filter: (_view: GameView, t: number) =>
            t !== ownerId && ctx.state.players[t]?.alive === true,
        },
        timeout: 15,
      });
      const target = ctx.state.localVars[TARGET_KEY] as number | undefined;
      delete ctx.state.localVars[TARGET_KEY];
      if (typeof target !== 'number') return;
      if (!ctx.state.players[target]?.alive) return;

      // 3) 目标二选一(超时默认选项1)
      delete ctx.state.localVars[OPTION_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPTION_RT,
        target,
        prompt: {
          type: 'confirm',
          title: `英魂:选择一项(孙坚已损失 ${x} 体力)`,
          description: `选项1:摸${x}张牌再弃1张牌;选项2:摸1张牌再弃${x}张牌`,
          confirmLabel: `摸${x}弃1`,
          cancelLabel: `摸1弃${x}`,
        },
        defaultChoice: true,
        timeout: 15,
      });
      const option =
        (ctx.state.localVars[OPTION_KEY] as 'opt1' | 'opt2' | undefined) ?? 'opt1';
      delete ctx.state.localVars[OPTION_KEY];

      // 4) 执行:先摸后弃
      const drawCount = option === 'opt1' ? x : 1;
      const discardCount = option === 'opt1' ? 1 : x;
      if (drawCount > 0) {
        await applyAtom(ctx.state, { type: '摸牌', player: target, count: drawCount });
      }
      if (!ctx.state.players[target]?.alive) return; // 极端:摸牌触发死亡(无懈链等)

      // 弃牌:目标自选弃哪些牌,数量 clamp 到当前手牌
      const hand = ctx.state.players[target].hand;
      const actual = Math.min(discardCount, hand.length);
      if (actual <= 0) return;
      delete ctx.state.localVars[DISCARD_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: DISCARD_RT,
        target,
        prompt: {
          type: 'useCard',
          title: `英魂:弃 ${actual} 张牌`,
          cardFilter: { filter: () => true, min: actual, max: actual },
        },
        timeout: 20,
      });
      const discardCards = ctx.state.localVars[DISCARD_KEY] as string[] | undefined;
      delete ctx.state.localVars[DISCARD_KEY];
      if (discardCards && discardCards.length > 0) {
        await applyAtom(ctx.state, {
          type: '弃置',
          player: target,
          cardIds: discardCards,
        });
      }
    },
  );

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '英魂',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '英魂',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
