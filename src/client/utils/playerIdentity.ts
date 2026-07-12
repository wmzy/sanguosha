// src/client/utils/playerIdentity.ts — 玩家身份(localStorage 持久化)
//
// 无登录系统下的轻量身份方案:玩家进入房间前需设置一个昵称作为 playerId。
// playerId 透传到服务端所有房间操作(create/join/spectate/debug)。
// 不传则由服务端自动生成(见 rest.ts generatePlayerId)。

const STORAGE_KEY = 'sgs:playerId';

/** 读取已设置的玩家身份;未设置返回 null。 */
export function getPlayerId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 是否已设置玩家身份。 */
export function hasPlayerId(): boolean {
  return getPlayerId() !== null;
}

/** 设置玩家身份(去空白,空串忽略)。 */
export function setPlayerId(id: string): void {
  const trimmed = id.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    /* localStorage 不可用时静默 */
  }
}

/** 清除玩家身份。 */
export function clearPlayerId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* */
  }
}
