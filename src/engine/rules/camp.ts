// 阵营规则:身份 → 阵营 的唯一映射(身份局/1v1 通用)。
// 服务端 gameHistory(历史条目胜负判定)与前端 GameResultOverlay(结算面板)共用;
// 此前两端各持一份副本(if 版/switch 版),注释互认同步,现收敛于此。
// 保持零运行时依赖(不得 import 技能/规则包模块)——客户端 bundle 直接引入时
// 不应因此拉入引擎技能系统。

/** 阵营:主公与忠臣同属主公方 */
export type Camp = '主公方' | '反贼' | '内奸';

/** 身份 → 阵营;未知/未揭晓身份 → null */
export function identityCamp(identity: string | undefined): Camp | null {
  if (identity === '主公' || identity === '忠臣') return '主公方';
  if (identity === '反贼') return '反贼';
  if (identity === '内奸') return '内奸';
  return null;
}
