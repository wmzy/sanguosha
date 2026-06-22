// 判定:从牌堆顶翻一张到处理区(亮出判定牌)。
// 技能 after hooks(八卦阵/乐不思蜀等)从处理区读判定牌花色。
// atom.afterHooks 结束后把判定牌从处理区移入弃牌堆。
import type { AtomDefinition, GameView } from '../types';
import { registerAtom } from '../atom';

export const 判定: AtomDefinition<{ player: number; judgeType: string }> = {
  type: '判定',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state) {
    // 牌堆顶翻一张到处理区(亮出判定牌)
    if (state.zones.deck.length === 0) return;
    const topCardId = state.zones.deck.shift()!;
    state.zones.processing.push(topCardId);
  },
  afterHooks(state) {
    // 所有技能 after hooks 读完判定牌后,把处理区顶部的判定牌移入弃牌堆
    const idx = state.zones.processing.length - 1;
    if (idx < 0) return;
    const cardId = state.zones.processing.splice(idx, 1)[0];
    state.zones.discardPile.push(cardId);
  },
  effect: { sound: 'judge', animation: 'flip', blockUntilDone: true, duration: 1800 },
  applyView(view: GameView) {
    // fallback event 不含 cardId,只能 best-effort:从处理区弹出顶部一张(atom 刚放进去的那张)并 +1 弃牌堆计数
    if (!view.zones) return;
    if (view.zones.processing.length > 0) {
      view.zones.processing.pop();
    }
    view.zones.discardPileCount += 1;
  },
};

registerAtom(判定);
