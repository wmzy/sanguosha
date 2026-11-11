// 判定:从牌堆顶翻一张到结算帧牌区(亮出判定牌)。纯翻牌操作,无改判/消费/清理逻辑。
// 改判(鬼才/鬼道)→ 判定牌生效前.afterApply(runJudgeModifiers);
// 消费(天妒/洛神/屯田/闪电/乐不思蜀 等)→ 判定牌生效后 after-hook;
// 清理(判定牌入弃牌堆)及结果回传 → runJudgeFlow 末尾。
// 上述时机由 judge-flow.ts 的 runJudgeFlow 编排,本 atom 仅做翻牌。
//
// 前端展示:判定牌是公开信息,toViewEvents 携带 card+cardId。
// applyView 与 apply 对称:deckCount -1 + 判定牌进 processing/帧牌区;
// 判定牌离开处理区由后续 atom 投影(移动牌 / 收取判定牌),本 atom 不预支弃牌堆计数。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { bindJudgeCard } from '../flows/judge';
import { drawFromTop, peekTop } from '../core/deck';

export const 判定: AtomDefinition<{ player: number; judgeType: string }> = {
  type: '判定',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    // 牌堆顶翻一张到栈顶结算帧的牌区(亮出判定牌)
    // 方向约定:牌堆顶 = deck 末尾(与 摸牌/置创牌/整理牌堆 一致,见 引擎架构.md)。
    const topCardId = drawFromTop(state);
    if (!topCardId) return; // 牌堆为空:不翻牌
    const frame = state.settlementStack[state.settlementStack.length - 1];
    const cards = frame ? frame.cards : state.zones.processing;
    cards.push(topCardId);
    bindJudgeCard(atom, topCardId, cards);
  },
  toViewEvents(state, atom): ViewEventSplit {
    // 判定牌是公开信息:所有玩家都能看到花色点数+牌名
    // (toViewEvents 在 apply 之前调用,peek 方向须与 apply 的 pop 一致:牌堆顶 = 末尾)
    const topCardId = peekTop(state);
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
  effect: { sound: 'flip', animation: 'flip', blockUntilDone: true, duration: 1800 },
  applyView(view, _event) {
    // 与 apply 对称:牌堆 -1,判定牌进结算帧牌区(processing)。
    // 判定牌离开处理区的两条路径都有 atom 投影:
    //   · 入弃牌堆 / 被天妒·双雄·落英 拿走 / 被鬼才·鬼道 改判替换 → 「移动牌」;
    //   · 被屯田·界屯田 收作"田" → 「收取判定牌」。
    // 故此处**不得**预支 discardPileCount +1:判定牌被收走时它根本没进弃牌堆,
    // 预支会让增量视图的弃牌堆计数永久虚高 1(实测 屯田/双雄/天妒/界落英)。
    if (!view.zones) return;
    const cardId = (_event as { cardId?: string }).cardId;
    view.zones.deckCount = Math.max(0, view.zones.deckCount - 1);
    if (!cardId) return; // 牌堆为空:apply 早退,未翻牌
    const f = view.settlementStack[view.settlementStack.length - 1];
    if (f) f.cards.push(cardId);
    view.zones.processing.push(cardId);
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

