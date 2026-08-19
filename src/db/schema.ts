// src/db/schema.ts — Drizzle 表定义。
// 房间元数据:仅普通房间(normal)写入 DB;快速房间(quick)纯内存,不持久化。
// 用户认证:users(账号)+ sessions(登录会话)。
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
  /** 进房密码哈希(scrypt);null=无密码。永不存明文、永不下发客户端。 */
  passwordHash: text('password_hash'),
  /** 成员显示名:userId → 昵称(重启恢复房间成员名单用) */
  playerNames: jsonb('player_names').notNull().default({}).$type<Record<string, string>>(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** 用户账号表。provider='local'(用户名密码)或 'github'(OAuth);同账号可同时有密码与 GitHub 绑定。 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  /** 登录名,唯一,小写规范化 */
  username: text('username').notNull().unique(),
  /** scrypt 哈希;OAuth-only 账号为 null */
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  /** 'local' | 'github'(首次登录来源) */
  provider: text('provider').notNull(),
  /** GitHub 数字 id(唯一);非 GitHub 账号为 null */
  githubId: text('github_id').unique(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** 登录会话表。token 为 48 字节随机 hex,HttpOnly Cookie 携带;过期即失效。 */
export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
});

export type RoomRow = typeof rooms.$inferSelect;
export type RoomInsert = typeof rooms.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
