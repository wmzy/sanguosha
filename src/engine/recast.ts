// 重铸通用 helper。
//
// 「重铸」= 弃置一张牌 + 摸一张。是多个技能共享的通用机制，不是铁索连环/某张牌的专利：
//   - 铁索连环牌本身可重铸（recast action）
//   - 连环/界连环：梅花手牌当铁索连环重铸（recycle action）
//   - 界燕语：重铸【杀】（recycle action）
//   - 界将驰：选项②重铸一张手牌
// 此前每处各自手写 applyAtom(弃置)+applyAtom(摸牌)，重复且易漂移，集中到本 helper。
//
// 调用方职责：action 注册、合法性校验、frame 包装（如需结算帧归属/日志）。
// 本 helper 仅做实质的「弃牌+摸一张」，不含 frame——是否包 frame 由调用方决定
// （铁索连环/连环/界连环/界燕语 用 pushFrame 包装做日志归属，界将驰在 hook 内直接调用不包 frame）。
import type { GameState } from './types';
import { applyAtom } from './index';

/** 重铸一张牌：弃置此牌并摸一张。 */
export async function recastCard(
  state: GameState,
  player: number,
  cardId: string,
): Promise<void> {
  await applyAtom(state, { type: '弃置', player, cardIds: [cardId], voluntary: true });
  await applyAtom(state, { type: '摸牌', player, count: 1 });
}
