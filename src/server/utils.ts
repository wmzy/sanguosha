// server/utils.ts
import { register } from './resourceRegistry';

let playerCounter = 0;

register(
  '玩家计数',
  {
    get value() {
      return playerCounter;
    },
  },
  () => {
    playerCounter = 0;
  },
);

export function generatePlayerId(): string {
  playerCounter++;
  return `player_${playerCounter}_${Date.now()}`;
}
