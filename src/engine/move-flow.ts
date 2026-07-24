// src/engine/move-flow.ts
// 移动牌编排函数(对齐 flow-redesign.md 模块 F / move.md)。
//
// 将单 atom(移动牌)模式升级为「编排函数 + 时机标记 atom」模式(与 runUseFlow /
// runDamageFlow / runDeathFlow 一致):
//   applyAtom(移动到目标区域前) → applyAtom(移动牌) → applyAtom(移动到目标区域后)
//   → 牌堆耗尽自动重洗
//
// 关键约束(模块 F 范围):
//   - 新增编排函数 + 时机 atom 定义(runMoveCardFlow / 移动到目标区域前·后)。
//   - 不迁移所有调用点:use-card/play-card/各 card-effect/各 skill 内部的「手牌→处理区」
//     等移动保持 applyAtom(移动牌)——这些移动无 before/after 时机技能需要,且调用点极多。
//   - 只迁移有「失去原因」语义的关键路径(弃置/获得/给予):这些 atom 在 afterApply 中
//     发出 移动到目标区域后 时机 atom(reason 透传),为连营/落英/屯田等技能提供统一 hook 点。
//     (弃置/获得 仍保留各自 apply + view 事件:ZoneLoc 不含「装备」区域,且这些 atom 的
//      view 事件含信息分级,直接路由到 移动牌 会破坏视图同步——故采用 afterApply 发时机标记。)
//
// before-hook modify to 的传递:
//   移动到目标区域前 的 afterApply 把折叠后的最终 to 写入 state.localVars[MOVE_TO_KEY],
//   编排函数据此读取修正后的目标区域,作为实质 移动牌 的 to。
//
// 牌堆耗尽自动重洗(移动后通用规则):
//   移动后若 牌堆为空且弃牌堆有牌,触发 重洗。与 摸牌 内部的 planDraw 重洗互补——
//   摸牌 路径自带重洗,runMoveCardFlow 的重洗覆盖非摸牌路径(如牌堆顶被取走后耗尽)。
import type { GameState, MoveReason, ZoneLoc } from './types';
import { applyAtom } from './create-engine';
import { MOVE_TO_KEY } from './atoms/move-timing';

/** 牌堆空但弃牌堆有牌时,弃牌堆随机置入牌堆(标准三国杀规则)。 */
async function checkAndReshuffleIfNeeded(state: GameState): Promise<void> {
  if (state.zones.deck.length === 0 && state.zones.discardPile.length > 0) {
    await applyAtom(state, { type: '重洗' });
  }
}

/** 移动牌编排函数——对齐 move.md 两时机 + 牌堆耗尽重洗。
 *
 *  时机1 移动到目标区域前:纵玄/章武② 可改变目标区域(before-hook modify to)
 *  实质移动 移动牌:底层搬运 atom(apply 直接搬运,无 hook 时机)
 *  时机2 移动到目标区域后:连营/伤逝/落英/屯田 等「失去牌」技能(after-hook,按 reason 区分)
 *  牌堆耗尽重洗:移动后若牌堆空且弃牌堆有牌,触发 重洗
 *
 *  reason 为失去原因(弃置/获得/给予 等迁移路径透传;其余移动为 undefined)。
 *  cardId 必须存在于 state.cardMap(validate 前置保证)。 */
export async function runMoveCardFlow(
  state: GameState,
  cardId: string,
  from: ZoneLoc,
  to: ZoneLoc,
  reason?: MoveReason,
): Promise<void> {
  // 时机1:移动到目标区域前(纵玄/章武② 可改变目标区域)
  state.localVars[MOVE_TO_KEY] = to;
  await applyAtom(state, { type: '移动到目标区域前', cardId, from, to, reason });
  const finalTo = (state.localVars[MOVE_TO_KEY] as ZoneLoc) ?? to;

  // 实质移动
  await applyAtom(state, { type: '移动牌', cardId, from, to: finalTo });

  // 时机2:移动到目标区域后(连营/伤逝/落英/屯田)
  await applyAtom(state, { type: '移动到目标区域后', cardId, from, to: finalTo, reason });

  // 牌堆耗尽自动重洗(移动后通用规则,覆盖非摸牌路径)
  await checkAndReshuffleIfNeeded(state);
}
