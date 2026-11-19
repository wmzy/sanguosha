// core/processing-zone.ts — 处理区(结算帧 cards + zones.processing)牌的离场原语。
//
// 处理区里的牌离开必须走「移动牌」atom 才有视图投影(与 core/judge-zone.ts 同理,
// 参见 CLAUDE.md「判定流程的牌移动必须经 atom」):该 atom 的 applyView 把牌从
// settlementStack 帧与 processing 列表移除,并在 to=弃牌堆 时令 discardPileCount +1
// (ephemeral 结算临时牌不加计数)。绕过 atom 内联搬运会让增量视图与 buildView
// 永久漂移(弃牌堆计数虚高 / 处理区残留)。
//
// 本原语不做任何守卫——牌是否仍在处理区、是否虚拟使用等前置判断由调用点自持
// (use-card 各收尾分支的 frameCards 守卫、judge 流程的稳定结果引用守卫)。
import type { GameState } from '../types';
import { applyAtom } from './apply';

/** 无条件把处理区里的牌置入弃牌堆(使用结算收尾 / 判定牌清理·改判替换)。
 *  调用方负责守卫:牌可能已被技能收走/替代而不在处理区。 */
export async function discardProcessingCard(state: GameState, cardId: string): Promise<void> {
  await applyAtom(state, {
    type: '移动牌',
    cardId,
    from: { zone: '处理区' },
    to: { zone: '弃牌堆' },
  });
}
