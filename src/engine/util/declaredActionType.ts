// 声明型技能的 actionType 前缀约定(单一事实来源)。
//
// 背景:界渐营/界矫诏/界蛊惑 这类「玩家声明一个牌名」的技能,客户端(浏览器技能按钮 /
// 无头枚举)无法凭空提供 params.outputName / params.declaredName —— 故把「声明」编码进
// actionType(`${前缀}${牌名}`,如 `transform:杀` / `use:桃`),每个声明牌名注册一个
// action:用户点哪个按钮 = 声明哪张牌,preceding 与主 action 一一对应。
//
// 消费方:
//   - 引擎技能注册:skills/界渐营.ts、skills/界矫诏.ts(transform:)、skills/界蛊惑.ts(use:)
//   - 客户端识别:src/client/utils/gameViewHelpers.ts 以 TRANSFORM_ACTION_PREFIX 前缀
//     判定非替代动作(isNonAltActionType)。修改字面量须两端同步。
export const TRANSFORM_ACTION_PREFIX = 'transform:';
export const USE_ACTION_PREFIX = 'use:';
