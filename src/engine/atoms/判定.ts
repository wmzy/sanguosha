// 判定:从牌堆顶翻一张到处理区(亮出判定牌)。
// 技能 after hooks(八卦阵/乐不思蜀等)从处理区读判定牌花色。
// atom.afterHooks 结束后把判定牌从处理区移入弃牌堆。
//
// 前端展示:判定牌是公开信息,toViewEvents 携带 card+cardId。
// 判定牌在处理区“停留几秒”的视觉效果由前端 useDebugMultiConnection hook 负责
// (在收到判定事件后临时把判定牌加入 view.zones.processing 展示,几秒后移除),
// 不在 applyView 中处理——保持 applyView 与 buildView 一致。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { runJudgeModifiers } from '../create-engine';

export const 判定: AtomDefinition<{ player: number; judgeType: string }> = {
  type: '判定',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state) {
    // 牌堆顶翻一张到栈顶结算帧的牌区(亮出判定牌)
    if (state.zones.deck.length === 0) return;
    const topCardId = state.zones.deck.shift()!;
    const frame = state.settlementStack[state.settlementStack.length - 1];
    if (frame) frame.cards.push(topCardId);
    else state.zones.processing.push(topCardId);
  },
  afterHooks(state) {
    // 所有技能 after hooks 读完判定牌后,把判定牌从结算帧移入弃牌堆
    const frame = state.settlementStack[state.settlementStack.length - 1];
    const cards = frame ? frame.cards : state.zones.processing;
    const idx = cards.length - 1;
    if (idx < 0) return;
    const cardId = cards.splice(idx, 1)[0];
    state.zones.discardPile.push(cardId);
  },
  toViewEvents(state, atom): ViewEventSplit {
    // 判定牌是公开信息:所有玩家都能看到花色点数+牌名
    const topCardId = state.zones.deck[0];
    const card = topCardId ? state.cardMap[topCardId] : undefined;
    // 待判定牌:判定区同名延时锦囊(乐不思蜀/闪电/兵粮寸断)。
    // toViewEvents 在 apply 之前调用,判定区牌尚未被 after-hook 移除。
    // 技能判定(八卦阵/铁骑等)判定区无同名牌 → 不携带 pendingCard。
    const pendingTrick = state.players[atom.player]?.pendingTricks.find(
      (t) => t.name === atom.judgeType,
    );
    const view: ViewEvent = {
      type: '判定',
      player: atom.player,
      judgeType: atom.judgeType,
      // 携带判定牌信息:cardId 供前端 processing 区追踪,card 供日志/overlay 展示
      ...(card
        ? { cardId: topCardId, card: { name: card.name, suit: card.suit, rank: card.rank } }
        : {}),
      // 待判定牌(延时锦囊)牌面:供前端浮窗与判定结果并排展示
      ...(pendingTrick
        ? {
            pendingCard: {
              name: pendingTrick.card.name,
              suit: pendingTrick.card.suit,
              rank: pendingTrick.card.rank,
            },
          }
        : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  effect: { sound: 'judge', animation: 'flip', blockUntilDone: true, duration: 1800 },
  /** 改判阶段:apply(翻判定牌)+广播之后、技能 after hooks(闪电/兵粮寸断等消费方)
   *  读取判定牌之前。逆时针从判定目标起逐个询问鬼才/鬼道是否替换判定牌。
   *  改判直接 mutate 结算帧顶牌(代替/换走),改判完成后消费方读到的是最终牌。 */
  async afterApply(state) {
    await runJudgeModifiers(state);
  },
  applyView(view: GameView, _event: ViewEvent) {
    // 后端 apply+afterHooks 净效果: deck -1, processing 不变(进后出), discardPile +1。
    // applyView 对应净效果: deckCount -1, discardPileCount +1, processing 不变。
    // ⚠️ 不能 processing.pop()——判定可能嵌套在其他 atom 的 hook 中(如八卦阵),processing
    // 最后一张未必是判定牌。apply+afterHooks 净效果 = processing 不变。
    // 判定牌在处理区的“停留几秒”展示由前端 useDebugMultiConnection hook 负责(展示层),
    // 不在此处(数据层)处理——保持 applyView 与 buildView 一致。
    if (!view.zones) return;
    view.zones.deckCount = Math.max(0, view.zones.deckCount - 1);
    view.zones.discardPileCount += 1;
  },
  toViewLog(event) {
    const card = event.card as { name?: string; suit?: string; rank?: string } | undefined;
    const judgeType = event.judgeType ?? '';
    if (card) {
      return {
        player: event.player as number,
        text: `判定(${judgeType}):${card.suit ?? ''}${card.rank ?? ''} ${card.name ?? ''}`,
      };
    }
    return { player: event.player as number, text: `判定(${judgeType})` };
  },
};

registerAtom(判定);
