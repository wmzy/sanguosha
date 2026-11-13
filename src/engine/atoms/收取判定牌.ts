// 收取判定牌:技能把处理区(结算帧牌区)里的判定牌收走,记入技能自己的存放处
// (如 屯田/界屯田 把判定牌作为"田"记在 marks 的 payload.cardId 上)。
//
// 为什么需要独立 atom:「移动牌」只表达牌在标准牌区(手牌/牌堆/弃牌堆/处理区)之间的移动,
//   而"田"这类牌被移出游戏——只存在于 cardMap + 技能 vars/marks 中,不落任何标准区
//   (急袭把田当顺手牵羊打出时才由影子卡 shadowOf 还原进弃牌堆)。直接 mutate
//   frame.cards 会漏掉视图投影:前端 view.zones.processing / settlementStack 仍显示
//   这张已被收走的判定牌,与权威 buildView 永久漂移。
//
// 与「判定」atom 对称:判定 把牌从牌堆顶翻入处理区(applyView 同步 processing),
//   本 atom 把判定牌移出处理区(applyView 同步 processing),两端都有 view 通道。
//
// 校验:牌必须存在且当前确实在结算帧牌区(防止消费方重复收取 / 收到已入弃牌堆的牌)。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { broadcast } from './_helpers';
import { frameCards } from '../core/frame';

export const 收取判定牌: AtomDefinition<{ player: number; cardId: string }> = {
  type: '收取判定牌',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    if (!frameCards(state).includes(atom.cardId)) return `card ${atom.cardId} 不在处理区`;
    return null;
  },
  apply(state, atom) {
    const frame = state.settlementStack[state.settlementStack.length - 1];
    const cards = frame ? frame.cards : state.zones.processing;
    const idx = cards.indexOf(atom.cardId);
    if (idx >= 0) cards.splice(idx, 1);
  },
  toViewEvents(_state, atom): ViewEventSplit {
    // 判定牌是公开信息:所有玩家都看到它离开处理区(收走方由技能自行播报)
    const view: ViewEvent = {
      type: '收取判定牌',
      player: atom.player,
      cardId: atom.cardId,
    };
    return broadcast(view);
  },
  applyView(view, event) {
    const cardId = event.cardId as string | undefined;
    if (!cardId) return;
    const f = view.settlementStack[view.settlementStack.length - 1];
    if (f) f.cards = f.cards.filter((id) => id !== cardId);
    if (view.zones) view.zones.processing = view.zones.processing.filter((id) => id !== cardId);
  },
};
