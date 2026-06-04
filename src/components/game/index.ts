// src/components/game/index.ts — game 子目录 barrel
//
// 导出 GameBoard 拆分出的子组件。供外部统一从 `./game` 引用。
// PlayerPanel / HandCards / ActionPanel / GameLog 仍位于 src/components/ 根目录。

export { Countdown, useCountdownSeconds } from './Countdown';
export { PlayerSeat, type PlayerSeatEntry } from './PlayerSeat';
export { GamePrompts, type PendingPromptData } from './Prompts';
export { GameHeader } from './GameHeader';
export { SeatingLayout } from './SeatingLayout';
export { SkillButtons } from './SkillButtons';
export { DebugPanel } from './DebugPanel';
export { HandCardsSection } from './HandCardsSection';
export { LogSection } from './LogSection';
export type { GameBoardData, PlayerEntry } from './GameBoardData';