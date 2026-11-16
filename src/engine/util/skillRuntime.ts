// src/engine/util/skillRuntime.ts — 技能运行期共享小助手(桶文件)。
// 原 922 行单文件按内聚拆至 skillRuntime/ 子目录,本文件只 re-export:
// 所有 `from '../util/skillRuntime'`(及 cards/ 的 '../../util/skillRuntime')导入
// 路径不变、零调用方改动。SkillMicro + SkillRespond 共享本模块(改导出名前先协调)。
// 已迁出的同类样板:runVirtualSlash → skills/cards/_virtualSlash.ts(util 不得反向
// 依赖 skills 层);slotOf → util/equip-slot.ts;玩家状态判定族 → util/player-query.ts。
//
// 分组(见各子文件头部注释):
//   transform.ts — 转化技五件套工厂(registerTransformAction/mountTransformAction)+
//                  影子卡 id 构造/还原(shadowCardId/effectiveCardId);
//   respond.ts   — pending 询问与 respond 样板(requireRequestType/registerConfirmRespond/
//                  askConfirm/askResponse/currentRequestType/hasNullifyWindow/
//                  registerRespondForAllSeats);
//   hooks.ts     — hook 守卫工厂(registerOnOwnSlashDodged/registerOnDamagedAsTarget/
//                  registerPhaseStartHook);
//   misc.ts      — 出牌时机判定(engineCanPlayNow/engineCanPlayNowReason)、被询问杀窗口
//                  (isAskedKillSlot/viewAskedKill)、params 选牌归一(normalizeCardIds/
//                  firstCardId)、confirm 型 defineAction(defineConfirmAction)。
export * from './skillRuntime/transform';
export * from './skillRuntime/respond';
export * from './skillRuntime/hooks';
export * from './skillRuntime/misc';
