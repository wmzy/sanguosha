// src/client/headless/promptCoverage.ts
// 无头/AI 侧 prompt 处理覆盖表(契约表,由 tests/client/prompt-coverage.test.ts 校验)。
//
// 与 BROWSER_PROMPTS 对称:availableActions.ts 的 appendRespondActions /
// enumerateDistributeActions 按 prompt 类型分支;新增类型时本表编译报错,
// 防止 AI 侧落入「兜底空 params → 引擎恒拒 → 超时」。
import type { PromptType } from '../../engine/types';

/** prompt 类型 → 无头侧处理位置(改实现时同步更新描述)。 */
export const HEADLESS_PROMPTS: Record<PromptType, string> = {
  useCard: 'availableActions 卡牌回应枚举',
  selectTarget: 'availableActions 目标候选枚举',
  useCardAndTarget: 'availableActions 选牌 + 目标枚举',
  confirm: 'availableActions confirm 分支',
  distribute: 'availableActions distribute 分支(select/topBottom/allocate)',
  choosePlayer: 'availableActions choosePlayer 分支',
  chooseCharacter: 'availableActions 选将询问分支',
  pickProcessingCard: 'availableActions pickProcessingCard 分支',
  chooseSuit: 'availableActions chooseSuit 分支(四花色)',
  chooseOption: 'availableActions chooseOption 分支',
  pickTargetCard: 'availableActions pickTargetCard 分支',
};
