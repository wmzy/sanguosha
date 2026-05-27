// server/utils.ts
let 玩家计数 = 0;

export function generatePlayerId(): string {
  玩家计数++;
  return `player_${玩家计数}_${Date.now()}`;
}
