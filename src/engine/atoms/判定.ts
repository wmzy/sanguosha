// 判定:从牌堆顶翻一张到处理区(亮出判定牌)。
// 技能 after hooks(八卦阵/乐不思蜀等)从处理区读判定牌花色。
// atom.afterHooks 结束后把判定牌从处理区移入弃牌堆。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
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
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '判定',
      player: atom.player,
      judgeType: atom.judgeType,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  effect: { sound: 'judge', animation: 'flip', blockUntilDone: true, duration: 1800 },
  applyView(view: GameView) {
    // apply: deck → processing (shift); afterHooks: processing → discardPile (splice+push)
    // applyView 对应: deckCount - 1, processing net-zero(apply 加 + afterHooks 减 = 不变), discardPileCount + 1
    // ⚠️ 不能 processing.pop()——判定可能嵌套在其他 atom 的 hook 中(如八卦阵),processing
    // 最后一张未必是判定牌。apply+afterHooks 净效果 = processing 不变。
    if (!view.zones) return;
    view.zones.deckCount = Math.max(0, view.zones.deckCount - 1);
    view.zones.discardPileCount += 1;
  },
  toViewLog(event) {
    return { player: event.player as number, text: `判定 ${event.judgeType ?? ''}` };
  },
};

registerAtom(判定);
