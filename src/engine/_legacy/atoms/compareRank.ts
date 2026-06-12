// @ts-nocheck
// engine/atoms/compareRank.ts — 拼点比较原子（§6 P0 Task 4）
//
// compareRank 是 5 个拼点技能（驱虎/天义/制霸/烈刃/双雄）共用的基础原子。
// 双方各出一张手牌，比较点数：点数大者赢；点数相同由 seed RNG 决胜（确定性）。
// 结果通过 getResult() 注入 ctx.localVars.pindianWinner。
//
// 设计依据：docs/design/v3/0001-v3-redesign.md §4（拼点技能落地路径）

import type { GameState, Atom, Json } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';
import { createRng } from '../../shared/rng';
import { getRankValue } from '../pile-compare';

type CompareRankAtom = Extract<Atom, { type: '拼点' }>;

interface CompareResult {
  winner: string;
  aRank: number;
  bRank: number;
  tied: boolean;
}

/**
 * 根据双方手牌点数 + 当前 rng 状态计算拼点胜者。rng 仅在平局时消耗。
 * 重要：apply/toEvents 调用时 state.rngState 是 pre-apply 值；getResult
 * 在 apply 之后调用，此时 rngState 已被 apply 推进（平局 +1），需要用
 * rngState - 1 还原。isPostApply=true 表示 state 已是 post-apply。
 */
function resolveWinner(
  state: GameState,
  a: string,
  b: string,
  aCardId: string,
  bCardId: string,
  isPostApply = false,
): CompareResult {
  const aCard = state.cardMap[aCardId];
  const bCard = state.cardMap[bCardId];
  const aRank = aCard ? getRankValue(aCard.rank) : 0;
  const bRank = bCard ? getRankValue(bCard.rank) : 0;
  if (aRank > bRank) return { winner: a, aRank, bRank, tied: false };
  if (bRank > aRank) return { winner: b, aRank, bRank, tied: false };
  const seed = isPostApply ? state.rngState - 1 : state.rngState;
  const rng = createRng(seed);
  return {
    winner: rng.nextInt(2) === 0 ? a : b,
    aRank,
    bRank,
    tied: true,
  };
}

export function register() {
  registerAtom<CompareRankAtom>({
    type: '拼点',
    apply(state: GameState, atom: CompareRankAtom): GameState {
      const a = atom.a as string;
      const b = atom.b as string;
      const aCardId = atom.aCardId as string;
      const bCardId = atom.bCardId as string;
      const result = resolveWinner(state, a, b, aCardId, bCardId);
      // 双方面上选中的牌 → 手牌移除 + 弃牌堆
      let s = updatePlayer(state, a, (p) => ({
        hand: p.hand.filter((id) => id !== aCardId),
      }));
      s = updatePlayer(s, b, (p) => ({
        hand: p.hand.filter((id) => id !== bCardId),
      }));
      const newDiscard: string[] = [];
      if (!s.zones.discardPile.includes(aCardId)) newDiscard.push(aCardId);
      if (!s.zones.discardPile.includes(bCardId)) newDiscard.push(bCardId);
      return {
        ...s,
        zones: {
          ...s.zones,
          discardPile: [...s.zones.discardPile, ...newDiscard],
        },
        rngState: result.tied ? state.rngState + 1 : state.rngState,
      };
    },
    getResult(state: GameState, atom: CompareRankAtom): Record<string, Json> {
      const a = atom.a as string;
      const b = atom.b as string;
      const aCardId = atom.aCardId as string;
      const bCardId = atom.bCardId as string;
      const result = resolveWinner(state, a, b, aCardId, bCardId, true);
      return {
        pindianWinner: result.winner,
        pindianACard: aCardId,
        pindianBCard: bCardId,
        pindianARank: result.aRank,
        pindianBRank: result.bRank,
      };
    },
  });
}
