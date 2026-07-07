// 反间(周瑜·吴·主动技):出牌阶段，你可以令一名其他角色选择一种花色，
// 然后获得你的一张手牌并展示之，若此牌与所选花色不同，该角色受到1点伤害。
//
// 流程(主动技):
//   1. use action:出牌阶段对一名其他存活角色使用(限一次/回合,需有手牌)
//   2. 目标选花色(请求回应 requestType='反间/选花色',prompt=chooseSuit)
//   3. 周瑜随机一张手牌 → 目标手牌(移动牌)
//   4. 比对花色:不同 → 目标受 1 点伤害(造成伤害)
//
// 关键点:
//   - 目标选花色需目标玩家 respond,而反间只注册在周瑜座次。
//     引擎 dispatch 按 (skillId, message.ownerId, actionType) 精确查 action,
//     因此把 'respond' action 注册到每个座次(以 skillId='反间' 隔离)。
//   - 随机选牌用 state.rngSeed 派生 RNG(推进后写回),保证重放确定性。
//   - 每回合限一次:反间/usedThisTurn(后缀约定,回合结束 atom 自动清空)。
//   - "展示之":牌移动到目标手牌(目标可见其牌面);花色比对在引擎内完成。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { createRng } from '../../shared/rng';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

const SUIT_REQUEST = '反间/选花色';
const SUIT_KEY = '反间/suit';
const USED_KEY = '反间/usedThisTurn';
const SUITS = ['♠', '♥', '♣', '♦'] as const;
const TIMEOUT_DEFAULT_SUIT = '♠';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '反间',
    description: '出牌阶段，令一名其他角色猜一种花色，获得你的一张手牌并展示，猜错则受1点伤害',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use action:出牌阶段对一名其他存活角色使用 ──────────────
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
      if (self.vars[USED_KEY]) return '本回合已使用过反间';
      if (self.hand.length === 0) return '需要有手牌才能发动反间';
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length !== 1) return '需要指定一名目标';
      const target = targets[0];
      if (target === ownerId) return '不能对自己使用反间';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不合法';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = (params.targets as number[])[0];
      await pushFrame(st, '反间', from, { ...params });

      // 限一次标记:在第一个 await 前设置,防 dispatch 重入(参考制衡)
      st.players[from].vars[USED_KEY] = true;
      await applyAtom(st, { type: '回合用量', player: from, key: USED_KEY, value: true });

      // ── 目标选花色 ──
      delete st.localVars[SUIT_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: SUIT_REQUEST,
        target,
        prompt: {
          type: 'chooseSuit',
          title: '反间:选择一种花色(猜对则不受伤害，猜错受1点伤害)',
        },
        defaultChoice: TIMEOUT_DEFAULT_SUIT,
        timeout: 30,
      });
      let chosenSuit = st.localVars[SUIT_KEY] as string | undefined;
      if (!chosenSuit || !(SUITS as readonly string[]).includes(chosenSuit)) {
        // 超时/非法 → 默认 ♠(描述未指定超时行为,此处选择不放弃猜测机会)
        chosenSuit = TIMEOUT_DEFAULT_SUIT;
      }

      // ── 周瑜随机一张手牌 → 目标手牌 ──
      const self = st.players[from];
      if (!self || !self.alive || self.hand.length === 0) {
        await popFrame(st);
        return;
      }
      const rng = createRng(st.rngSeed);
      const idx = rng.nextInt(self.hand.length);
      st.rngSeed = rng.getState();
      const cardId = self.hand[idx];

      await applyAtom(st, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '手牌', player: target },
      });

      // ── 比对花色:不同 → 目标受 1 点伤害 ──
      const card = st.cardMap[cardId];
      const targetPlayer = st.players[target];
      if (card && card.suit !== chosenSuit && targetPlayer?.alive) {
        await applyAtom(st, {
          type: '造成伤害',
          target,
          amount: 1,
          source: from,
        });
      }

      await popFrame(st);
    },
  );

  // ── respond:目标选花色(注册到每个座次,目标可能是任意玩家)──
  // dispatch 按 (skillId, ownerId, actionType) 查;各座次用独立闭包绑定 seatId,
  // 以 skillId='反间' 隔离,不与其他技能 respond 冲突。
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        if (atom['requestType'] !== SUIT_REQUEST) return '当前不是反间选花色';
        const suit = params.suit;
        if (typeof suit !== 'string' || !(SUITS as readonly string[]).includes(suit)) {
          return '需要选择 ♠/♥/♣/♦ 中的一种花色';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        st.localVars[SUIT_KEY] = params.suit as string;
      },
    );
    unloaders.push(u);
  }

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '反间',
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '反间:令一名其他角色猜花色',
      targetFilter: { min: 1, max: 1, filter: (_view, t) => t !== skill.ownerId },
    },
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) &&
      (ctx.view.players[ctx.perspectiveIdx]?.hand?.length ?? 0) > 0 &&
      !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[USED_KEY],
  });

  api.defineAction('respond', {
    label: '反间',
    style: 'danger',
    prompt: {
      type: 'chooseSuit',
      title: '反间:选择一种花色(猜对则不受伤害，猜错受1点伤害)',
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
