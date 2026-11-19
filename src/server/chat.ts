// server/chat.ts — 聊天子域(配额校验/历史维护),自 room.ts 切出。
// 状态(chatUsage/chatHistory)仍是 Room 的字段(随房间生命周期,房间销毁即回收);
// 本模块只承载操作函数,经 getRoom(roomId) 定位房间,与房间成员语义零耦合。
// 与 room.ts 构成函数体级依赖环:本模块顶层不执行任何访问 room 绑定的语句,
// 运行时安全(与原 registry↔room 的顶层执行环不同)。room.ts re-export 保持
// sse.ts/routes/tests 从 './room' 导入的既有路径不变。
import { getRoom } from './room';

/** 聊天验证结果。 */
export interface ChatValidation {
  ok: boolean;
  error?: string;
  /** 发送后本局剩余次数（null=无限） */
  remaining?: number | null;
}

const CHAT_HISTORY_LIMIT = 50;
const MINUTE_MS = 60_000;

/** 清理过期的每分钟时间戳（滑动窗口）。 */
function pruneTimestamps(timestamps: number[], now: number): number[] {
  const cutoff = now - MINUTE_MS;
  return timestamps.filter((t) => t >= cutoff);
}

/** 验证并记录一条聊天消息。 */
export function addChatMessage(
  roomId: string,
  playerId: string,
  text: string,
): ChatValidation {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: '房间不存在' };

  const chat = room.config.chat;
  if (!chat.enabled) return { ok: false, error: '聊天已关闭' };
  // 聊天仅在游戏中可用(非大厅/结算阶段)
  if (room.status !== '进行中') return { ok: false, error: '聊天仅在游戏中可用' };

  // 白名单校验
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: '消息不能为空' };

  if (chat.whitelistOnly && !chat.whitelist.includes(trimmed)) {
    return { ok: false, error: '只能发送白名单内的消息' };
  }

  // 字数校验
  if (chat.maxChars > 0 && trimmed.length > chat.maxChars) {
    return { ok: false, error: `每条消息最多 ${chat.maxChars} 字` };
  }

  const now = Date.now();
  let usage = room.chatUsage.get(playerId);
  if (!usage) {
    usage = { total: 0, timestamps: [] };
    room.chatUsage.set(playerId, usage);
  }

  // 每局上限
  if (chat.maxPerGame > 0 && usage.total >= chat.maxPerGame) {
    return { ok: false, error: `本局消息上限 ${chat.maxPerGame} 条已用尽` };
  }

  // 每分钟上限（滑动窗口）
  if (chat.maxPerMinute > 0) {
    usage.timestamps = pruneTimestamps(usage.timestamps, now);
    if (usage.timestamps.length >= chat.maxPerMinute) {
      return { ok: false, error: `每分钟最多 ${chat.maxPerMinute} 条` };
    }
  }

  // 记录用量
  usage.total++;
  usage.timestamps.push(now);

  // 确定座次（从座位表派生，保证与座次顺序一致）
  const seatIndex = room.seats.indexOf(playerId);
  if (seatIndex < 0) return { ok: false, error: '不在房间中' };

  // 存入历史
  const entry = { playerId, seatIndex, text: trimmed, timestamp: now };
  room.chatHistory.push(entry);
  if (room.chatHistory.length > CHAT_HISTORY_LIMIT) {
    room.chatHistory.shift();
  }

  const remaining = chat.maxPerGame > 0 ? chat.maxPerGame - usage.total : null;
  return { ok: true, remaining };
}

/** 获取聊天历史（供重连）。 */
export function getChatHistory(roomId: string): Array<{
  playerId: string;
  seatIndex: number;
  text: string;
  timestamp: number;
}> {
  const room = getRoom(roomId);
  return room ? [...room.chatHistory] : [];
}

/** 重置聊天用量（开局/重开时调用）。 */
export function resetChatUsage(roomId: string): void {
  const room = getRoom(roomId);
  if (room) {
    room.chatUsage.clear();
    room.chatHistory = [];
  }
}
