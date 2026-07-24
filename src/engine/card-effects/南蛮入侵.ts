// 南蛮入侵 CardEffect — 普通锦囊·南蛮入侵的使用结算。
//
// resolve（逐目标）：询问无懈可击 → 询问杀 → 检查处理区 → 伤害。
// target.kind='allOthers': 所有其他角色（从下家开始按座次）。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { runDamageFlow } from '../damage-flow';
import { consumePlayedSlashes } from '../card-effect/play-card';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 南蛮入侵的逐目标结算：询问杀 → 统一清理打出杀 → 伤害 */
async function resolveBarbarianInvasion(ctx: ResolveCtx): Promise<void> {
  const { state, source, target, cardId } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理

  await applyAtom(state, { type: '询问杀', target, source });
  // 统一清理：处理区内打出的杀移入弃牌堆；返回空 = 目标未出杀
  const kills = await consumePlayedSlashes(state);
  if (kills.length === 0) {
    // 没出杀：受伤害
    if (!state.players[target]?.alive) return;
    await runDamageFlow(state, source, target, 1, cardId);
  }
}

const barbarianInvasionEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'allOthers' },
  resolve: resolveBarbarianInvasion,
  prompt: {
    type: 'useCard',
    title: '南蛮入侵',
    cardFilter: { filter: (c: Card) => c.name === '南蛮入侵', min: 1, max: 1 },
  } as ActionPrompt,
  label: '南蛮入侵',
  style: 'danger',
};

registerCardEffect('南蛮入侵', barbarianInvasionEffect);
