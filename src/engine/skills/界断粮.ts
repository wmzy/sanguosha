// 界断粮(界徐晃·主动技/转化):出牌阶段,你可以将一张黑色牌
//   当【兵粮寸断】使用;你对手牌数不小于你的角色使用【兵粮寸断】无距离限制。
//
// 与标版区别:标版只能将"黑色基本牌或装备牌"转化;界版扩展为"任意黑色牌"。
//   距离放松规则(手牌数不小于你 → 无距离限制)标版已有,界版保持。
//
// 实现策略(独立 use,同标版):
//   兵粮寸断.use 的距离校验硬编码 effectiveDistance<=1,无法承载"无距离限制"的放松规则。
//   且断粮转化的卡不是"兵粮寸断"卡(而是黑色牌)。故采用独立 use action:
//   validate 校验黑色牌 + 放松距离;execute 直接放置 name='兵粮寸断' 的延时锦囊。
//   判定/跳过摸牌阶段的效果由现有 兵粮寸断.ts 的 hooks 处理(它们只认 pendingTricks.name)。
//   无次数限制(描述明确)。
//
// 距离规则:
//   - 默认:目标须在距离 1 以内(与兵粮寸断一致)
//   - 放松:目标手牌数 >= 徐晃手牌数 → 无距离限制
import type { Card, GameView, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending } from '../skill';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';

const TRICK_NAME = '兵粮寸断';

/** 界断粮可用牌:任意黑色牌(♠/♣) */
function isDuanliangCard(card: Card | undefined): boolean {
  if (!card) return false;
  return card.color === '黑';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界断粮',
    description: '将一张黑色牌当【兵粮寸断】使用;对手牌数不小于你的角色无距离限制',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>): string | null => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      if (typeof params.cardId !== 'string') return '需要选择一张牌';
      if (typeof params.target !== 'number') return '需要选择目标';
      if (!self.hand.includes(params.cardId)) return '牌不在手牌中';
      if (!isDuanliangCard(state.cardMap[params.cardId])) return '需要黑色牌';
      const target = params.target;
      if (target === ownerId) return '不能对自己使用';
      const targetPlayer = state.players[target];
      if (!targetPlayer?.alive) return '目标不存在或已死亡';

      // 距离规则:默认 ≤1;目标手牌数 >= 自己手牌数时无距离限制
      const handGeq = targetPlayer.hand.length >= self.hand.length;
      const inRange = handGeq || effectiveDistance(state, ownerId, target) <= 1;

      const ok = myTurn && inActPhase && free && inRange;
      return ok ? null : '界断粮使用条件不满足';
    },
    async (state: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as number;
      await pushFrame(state, '界断粮', from, { ...params });

      // 卡牌进处理区(打出)
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // 放置延时锦囊:复用现有 兵粮寸断 的判定/跳过摸牌 hooks
      const trickCard: Card = state.cardMap[cardId] ?? {
        id: cardId,
        name: TRICK_NAME,
        suit: '♣',
        color: '黑',
        rank: 'A',
        type: '锦囊牌',
      };
      await applyAtom(state, {
        type: '添加延时锦囊',
        player: target,
        trick: { name: TRICK_NAME, source: from, card: trickCard },
      });

      // 使用卡进弃牌堆
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });

      await popFrame(state);
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '界断粮',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '界断粮:将黑色牌当兵粮寸断使用',
      cardFilter: { filter: (c: Card) => isDuanliangCard(c), min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 距离放松:目标手牌数 >= 自己 → 无限制;否则 ≤1
        filter: (view: GameView, t: number) => {
          const me = view.currentPlayerIndex;
          if (t === me) return false;
          const tp = view.players[t];
          if (!tp) return false;
          if (tp.alive === false) return false;
          const myHand = view.players[me]?.handCount ?? 0;
          if ((tp.handCount ?? 0) >= myHand) return true; // 无距离限制
          return viewEffectiveDistance(view.players, me, t) <= 1;
        },
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return (p.hand?.some((c) => isDuanliangCard(c)) ?? false);
    },
  });
}
