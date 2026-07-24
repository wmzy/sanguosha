// src/engine/rank-flow.ts
// 拼点两步化编排函数(对齐 flow-redesign.md 模块 G / rankcompare.md)。
//
// 将单 atom(拼点)模式升级为「编排函数 + 时机标记 atom」模式(与 runUseFlow /
// runDamageFlow / runDeathFlow / runMoveCardFlow 一致):
//   applyAtom(拼点扣置) → applyAtom(拼点亮出) → 确定结果 → 牌入弃牌堆 → applyAtom(拼点后)
//
// 关键约束(模块 G 范围):
//   - 新增编排函数 runRankCompareFlow + 三时机 atom 定义(拼点扣置/拼点亮出/拼点后)。
//   - 不修改旧「拼点」atom 定义——保留为兼容(未来若有未迁移调用方仍可用)。
//   - 全部拼点主路径(驱虎/界惴恐/天义/烈刃/界巧说/界陷阵)迁移至 runRankCompareFlow;
//     调用方原来自行移动两张牌到处理区,改为不移动——runRankCompareFlow 内部通过
//     拼点扣置 atom 处理移动,实现同时扣置、面朝下。
//   - 酣战/纵适 的拼点后效果 hook 从旧「拼点」atom 迁移至「拼点后」时机。
//
// 面朝下语义:
//   拼点扣置 的 toViewEvents 对非扣置者隐藏牌面(发起方只看到自己的牌,目标方只看到自己的,
//   其他人两张都看不到)。拼点亮出 向全员公开两张牌面。
//
// 死亡中拼点:
//   扣置与亮出之间不插入任何询问,无死亡窗口。若一方在选牌阶段死亡,调用方应自行检查存活
//   (编排函数前置保证双方手牌中持有拼点牌)。
import type { Card, GameState } from './types';
import { applyAtom } from './create-engine';

/** 拼点牌点数:A=1, 2-10=面值, J=11, Q=12, K=13(与各拼点技的 rankValue 一致)。
 *  card 为 undefined 时返回 0(编排函数前置保证牌存在,此处仅防御)。 */
export function getCardValue(card: Card | undefined): number {
  if (!card) return 0;
  const rank = card.rank;
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

/** 拼点两步化编排函数——对齐 rankcompare.md 四步。
 *
 *  时机1 拼点扣置:双方同时将一张手牌扣置入处理区(面朝下)。
 *    apply 把两张牌从手牌移入处理区;toViewEvents 对非扣置者隐藏牌面。
 *  时机2 拼点亮出:同时亮出(面朝上),向全员公开牌面。
 *  确定结果:initiator 点数严格大于 target = '赢';否则(≤)= '没赢'。
 *  牌入弃牌堆:两张拼点牌 处理区→弃牌堆(在 拼点后 之前——钩子读 discardPile 取牌)。
 *  时机3 拼点后:纯标记,after-hook 触发拼点后效果(酣战获杀/纵适获牌)。
 *
 *  调用方约定:initiatorCard 须在 initiator 手牌中、targetCard 须在 target 手牌中。
 *  返回拼点结果('赢'/'没赢'),供调用方分支结算。 */
export async function runRankCompareFlow(
  state: GameState,
  initiator: number,
  target: number,
  initiatorCard: string,
  targetCard: string,
): Promise<'赢' | '没赢'> {
  // 时机1:同时扣置(面朝下移入处理区)
  await applyAtom(state, {
    type: '拼点扣置',
    initiator,
    target,
    initiatorCard,
    targetCard,
  });

  // 时机2:同时亮出(公开牌面)
  await applyAtom(state, {
    type: '拼点亮出',
    initiator,
    target,
    initiatorCard,
    targetCard,
  });

  // 确定结果(严格大于才算赢,相等算没赢)
  const initVal = getCardValue(state.cardMap[initiatorCard]);
  const targetVal = getCardValue(state.cardMap[targetCard]);
  const result: '赢' | '没赢' = initVal > targetVal ? '赢' : '没赢';

  // 牌入弃牌堆(在 拼点后 之前发出——与旧「拼点」atom 的 after-hook 时机一致:
  // 酣战获杀/纵适获牌 等钩子读 discardPile 取牌,须先入弃牌堆)
  await applyAtom(state, {
    type: '移动牌',
    cardId: initiatorCard,
    from: { zone: '处理区' },
    to: { zone: '弃牌堆' },
  });
  await applyAtom(state, {
    type: '移动牌',
    cardId: targetCard,
    from: { zone: '处理区' },
    to: { zone: '弃牌堆' },
  });

  // 时机3:拼点后(after-hook 触发拼点后效果:酣战获杀/纵适获牌)
  await applyAtom(state, {
    type: '拼点后',
    initiator,
    target,
    initiatorCard,
    targetCard,
    result,
  });

  return result;
}
