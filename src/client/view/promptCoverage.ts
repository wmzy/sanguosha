// src/client/view/promptCoverage.ts
// 浏览器侧 prompt 处理覆盖表(契约表,由 tests/client/prompt-coverage.test.ts 校验)。
//
// 为什么存在:引擎声明了 N 种 prompt 类型(type/prompt.ts 的 PROMPT_TYPES),
// 浏览器与无头各自维护处理分支——历史 bug(反间 chooseSuit / 观星 arrange)都是
// 「新增 prompt 类型后某一侧漏实现」。本表声明为 Record<PromptType, string>:
// 新增 prompt 类型时本文件编译报错,必须在此登记处理位置(并在对应分支实现)。
import type { PromptType } from '../../engine/types';

/** prompt 类型 → 浏览器侧处理位置(改实现时同步更新描述)。 */
export const BROWSER_PROMPTS: Record<PromptType, string> = {
  useCard: 'AwaitingPrompt 提示 + CenterActionBar 打出',
  selectTarget: 'usePlayInteraction 选目标态 + CenterActionBar',
  useCardAndTarget: 'AwaitingPrompt 提示 + usePlayInteraction 选目标',
  confirm: 'AwaitingPrompt confirm 分支',
  distribute: 'usePlayInteraction/distribute.ts + GameView 外部候选区',
  choosePlayer: 'AwaitingPrompt choosePlayer 分支',
  chooseCharacter: '选将面板(useCharSelect / 选将询问)',
  pickProcessingCard: 'AwaitingPrompt pickProcessingCard 分支',
  chooseSuit: 'AwaitingPrompt chooseSuit 分支(四花色按钮)',
  chooseOption: 'AwaitingPrompt chooseOption 分支',
  pickTargetCard: 'AwaitingPrompt pickTargetCard 分支',
};
