// server/utils.ts
import { register } from './lifecycles';

let 玩家计数 = 0;

register(
  '玩家计数',
  {
    get value() {
      return 玩家计数;
    },
  },
  () => {
    玩家计数 = 0;
  },
);

export function generatePlayerId(): string {
  玩家计数++;
  return `player_${玩家计数}_${Date.now()}`;
}
