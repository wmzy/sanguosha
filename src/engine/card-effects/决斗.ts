// 决斗 CardEffect — 普通锦囊·决斗的使用结算。
//
// resolve: 询问无懈可击 → 决斗循环（双方轮流出杀，先不出者受 1 点伤害）。
// 成为目标由 runUseFlow 处理，resolve 不再重复。
//
// 注意：虚拟决斗（离间 等走 runUseFlow({virtual:true})）包含 成为目标，决斗 CardEffect.resolve
// 调用的是不含 成为目标 的 runDuelLoop。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { enforceDualKill } from '../skills/无双';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 决斗牌特有校验：不能对自己使用 */
function canUseDuel(
  _state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const targets = params.targets as number[];
  if (targets.length !== 1) return '决斗只能指定一名目标';
  if (targets[0] === ownerId) return '不能对自己使用决斗';
  return null;
}

/** 决斗循环（不含无懈）：目标先出杀，之后发起者出杀，轮流。 */
async function runDuelLoop(
  state: import('../types').GameState,
  from: number,
  target: number,
  cardId: string,
): Promise<void> {
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理，此处不再询问

  const MAX_ROUNDS = 100;
  let turn = 0; // 0=目标, 1=发起者
  let loser: number | null = null;
  let rounds = 0;
  while (loser === null) {
    if (rounds++ >= MAX_ROUNDS) {
      loser = turn === 0 ? target : from;
      break;
    }
    const current = turn === 0 ? target : from;
    await applyAtom(state, {
      type: '询问杀',
      target: current,
      source: turn === 0 ? from : target,
    });
    // 无双(吕布锁定技)：与你决斗的角色每次需连续打出两张杀
    await enforceDualKill(state, turn === 0 ? from : target, current);
    // 检查处理区：有杀牌 = 出了杀，移走它；没有 = 没出，输
    const killCardId = frameCards(state).find((id) => state.cardMap[id]?.name === '杀');
    if (killCardId) {
      await applyAtom(state, {
        type: '移动牌',
        cardId: killCardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      turn = turn === 0 ? 1 : 0;
    } else {
      loser = current;
    }
  }
  const winner = loser === target ? from : target;
  await applyAtom(state, {
    type: '造成伤害',
    target: loser,
    amount: 1,
    source: winner,
    cardId,
  });
}

/** 决斗的结算：无懈 → 决斗循环 */
async function resolveDuel(ctx: ResolveCtx): Promise<void> {
  const { state, source, target, cardId } = ctx;
  await runDuelLoop(state, source, target, cardId);
}

const duelEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'other', min: 1, max: 1 },
  canUse: canUseDuel,
  resolve: resolveDuel,
  prompt: {
    type: 'useCardAndTarget',
    title: '决斗',
    cardFilter: { filter: (c: Card) => c.name === '决斗', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  } as ActionPrompt,
  label: '决斗',
  style: 'danger',
};

registerCardEffect('决斗', duelEffect);
