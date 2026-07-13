// src/db/schema.ts — Drizzle 房间元数据表定义。
// 仅普通房间(normal)写入 DB;快速房间(quick)纯内存,不持久化。
import { boolean, integer, jsonb, pgTable, text, bigint } from 'drizzle-orm/pg-core';
import type { RoomConfig } from '../server/protocol';

/** 房间元数据表。roomType='normal' 才写入;quick 仅内存。 */
export const rooms = pgTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** 'normal' = 持久化,不自动销毁不自动换主; 'quick' = 纯内存(不写入 DB) */
  roomType: text('room_type').notNull(),
  isDebug: boolean('is_debug').notNull().default(false),
  maxPlayers: integer('max_players').notNull(),
  hostId: text('host_id'),
  /** '等待中' | '进行中' | '已结束' */
  status: text('status').notNull(),
  config: jsonb('config').notNull().$type<RoomConfig>(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export type RoomRow = typeof rooms.$inferSelect;
export type RoomInsert = typeof rooms.$inferInsert;
