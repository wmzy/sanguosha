// 再起(孟获·主动技):摸牌阶段,若你已受伤,你可以放弃摸牌并展示牌堆顶X张牌
// (X为你已损失体力值+1),每有一张红桃回复1点体力,然后弃掉这些红桃牌,
// 将其余的牌收入手牌。
//
// 模式:摸牌阶段开始时(阶段开始 before hook)询问是否发动;
//   发动 → 取牌堆顶X张到处理区(展示) → 红桃牌:每张回复1点+弃置;非红桃:入手 → 跳过默认摸牌;
//   不发动 / 未受伤 → 走默认摸牌(摸2张)。
//
// 跳过默认摸牌的手法同突袭/兵粮寸断:applyAtom(阶段结束, 摸牌) 推进到出牌,
//   再 return {kind:'cancel'} 取消本次 阶段开始(摸牌)。
//
// 展示机制:把X张牌从牌堆顶移到处理区(公开可见),结算后:
//   - 红桃牌:弃置(处理区→弃牌堆)+ 回复体力
//   - 非红桃牌:获得(处理区→手牌)
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';

const TRIGGER_RT = '再起/trigger';
const TRIGGERED_KEY = '再起/triggered';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '再起',
    description: '摸牌阶段,若已受伤,可放弃摸牌,展示牌堆顶X张(X=已损失体力+1),红桃回血弃置,其余入门',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 trigger(confirm) 询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState, _params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== TRIGGER_RT) return '当前不是再起回应';
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      s.localVars[TRIGGERED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // 阶段开始(摸牌) before:询问是否再起,发动则展示+结算+跳过默认摸牌
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '摸牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 发动条件:已受伤(当前体力 < 体力上限)
      const lostHealth = self.maxHealth - self.health;
      if (lostHealth <= 0) return; // 未受伤 → 默认摸牌

      // 牌堆不足 → 无法展示 → 默认摸牌
      if (ctx.state.zones.deck.length === 0) return;

      // 官方:X 为你已损失体力值 + 1
      const x = Math.min(lostHealth + 1, ctx.state.zones.deck.length);

      // 询问是否发动再起
      delete ctx.state.localVars[TRIGGERED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动再起?(放弃摸牌,展示牌堆顶${x}张,红桃回血,其余入手)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[TRIGGERED_KEY] !== true) return; // 不发动 → 默认摸牌
      const shownCardIds: string[] = [];
      for (let i = 0; i < x; i++) {
        const topCardId = ctx.state.zones.deck[ctx.state.zones.deck.length - 1];
        if (!topCardId) break;
        // 移到处理区(展示)
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: topCardId,
          from: { zone: '牌堆' },
          to: { zone: '处理区' },
        });
        shownCardIds.push(topCardId);
      }

      if (shownCardIds.length === 0) {
        // 无牌可展示 → 回退默认摸牌(不 cancel)
        return;
      }

      // 结算:红桃 → 回复1点+弃置;非红桃 → 入手
      for (const cardId of shownCardIds) {
        const card = ctx.state.cardMap[cardId];
        if (!card) continue;
        if (card.suit === '♥') {
          // 红桃:回复1点体力(不超过上限) + 弃置
          const self2 = ctx.state.players[ownerId];
          if (self2.health < self2.maxHealth) {
            await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
          }
          await applyAtom(ctx.state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        } else {
          // 非红桃:入手
          await applyAtom(ctx.state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '手牌', player: ownerId },
          });
        }
      }

      // 清理处理区残留(安全兜底)
      const remaining = frameCards(ctx.state).filter((id) => shownCardIds.includes(id));
      for (const id of remaining) {
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: id,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }

      // 跳过默认摸牌:推进到出牌阶段,并 cancel 本次摸牌阶段开始
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '摸牌' });
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '再起',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动再起?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
