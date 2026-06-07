// src/utils/rotatePlayers.ts — 玩家座位旋转工具
//
// T10 拆分：从 DebugPlayerList 抽出，DebugLobby 也需要它（首次连上后
// 初始化 playerOrder；切换 perspective 时调用）。单独成文件避免
// react-refresh "only export components" 警告。

export function rotatePlayers(names: string[], startName: string): string[] {
  const idx = names.indexOf(startName);
  if (idx <= 0) return names;
  return [...names.slice(idx), ...names.slice(0, idx)];
}
