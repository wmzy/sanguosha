// src/client/hooks/normalizeJoinError.ts
// 连接/加入失败的错误文案归一:房间已不存在(404 或文案命中)优先给统一文案,
// 其余错误走 normalizeHgcError(Error.message / String(err))。
// 由 useMultiplayerRoom 与 useDebugMultiConnection 共用,避免两 hook 相互 import。
import { isRoomNotFound } from '../utils/roomErrors';
import { normalizeHgcError } from './useHgcPlayback';

export function normalizeJoinError(err: unknown): string {
  return isRoomNotFound(err) ? '房间已不存在或已关闭' : normalizeHgcError(err);
}
