// src/server/auth/store.ts — 用户账号与登录会话存储(Drizzle + PGLite)。
// 纯数据访问层:无 HTTP 概念,路由层(authRoutes.ts)负责 Cookie/CORS。
// DB 句柄来自 dbStore 单例(与 roomStore 共用);未初始化时调用返回错误结果。
import { and, eq, lt } from 'drizzle-orm';
import { users, sessions, type UserRow } from '../../db/schema';
import { getSharedDb } from '../dbStore';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  generateUserId,
} from './password';

/** 会话有效期:30 天。 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 对外安全的用户信息(不含密码哈希)。 */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  provider: string;
  hasPassword: boolean;
  githubLinked: boolean;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    provider: row.provider,
    hasPassword: row.passwordHash !== null,
    githubLinked: row.githubId !== null,
  };
}

/** 用户名规则:2-24 位,字母/数字/下划线/中文/连字符;存储前小写规范化。 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  const u = normalizeUsername(raw);
  return u.length >= 2 && u.length <= 24 && /^[\w\u4e00-\u9fa5-]+$/.test(u);
}

export function isValidPassword(raw: string): boolean {
  return typeof raw === 'string' && raw.length >= 6 && raw.length <= 72;
}

export type CreateUserResult =
  | { ok: true; user: PublicUser }
  | { ok: false; error: '用户名不合法' | '密码不合法' | '用户名已存在' | '数据库未初始化' };

/** 注册本地账号(用户名+密码)。 */
export async function createUser(
  usernameRaw: string,
  password: string,
): Promise<CreateUserResult> {
  if (!isValidUsername(usernameRaw)) return { ok: false, error: '用户名不合法' };
  if (!isValidPassword(password)) return { ok: false, error: '密码不合法' };
  const db = getSharedDb();
  if (!db) return { ok: false, error: '数据库未初始化' };
  const username = normalizeUsername(usernameRaw);
  const existing = await db.db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existing.length > 0) return { ok: false, error: '用户名已存在' };
  const now = Date.now();
  const inserted = await db.db
    .insert(users)
    .values({
      id: generateUserId(),
      username,
      passwordHash: await hashPassword(password),
      displayName: usernameRaw.trim(),
      provider: 'local',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { ok: true, user: toPublic(inserted[0]) };
}

export type VerifyLoginResult =
  | { ok: true; user: PublicUser }
  | { ok: false; error: '用户名或密码错误' | '数据库未初始化' };

/** 校验用户名密码登录。 */
export async function verifyLogin(
  usernameRaw: string,
  password: string,
): Promise<VerifyLoginResult> {
  const db = getSharedDb();
  if (!db) return { ok: false, error: '数据库未初始化' };
  const username = normalizeUsername(usernameRaw);
  const rows = await db.db.select().from(users).where(eq(users.username, username)).limit(1);
  const row = rows[0];
  // 账号不存在也跑一次哈希,避免响应时间差泄露账号存在性
  const ok = await verifyPassword(password, row?.passwordHash ?? await hashPassword('dummy'));
  if (!row || !ok) return { ok: false, error: '用户名或密码错误' };
  return { ok: true, user: toPublic(row) };
}

/** 创建登录会话,返回 token(调用方写入 HttpOnly Cookie)。 */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: number } | null> {
  const db = getSharedDb();
  if (!db) return null;
  const now = Date.now();
  const token = generateSessionToken();
  const expiresAt = now + SESSION_TTL_MS;
  await db.db.insert(sessions).values({ token, userId, createdAt: now, expiresAt });
  return { token, expiresAt };
}

/** 按 token 解析会话用户;过期/不存在返回 null。 */
export async function getUserByToken(token: string | undefined | null): Promise<PublicUser | null> {
  const db = getSharedDb();
  if (!db || !token) return null;
  const rows = await db.db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    await deleteSession(token);
    return null;
  }
  return toPublic(row.user);
}

/** 删除会话(登出)。 */
export async function deleteSession(token: string | undefined | null): Promise<void> {
  const db = getSharedDb();
  if (!db || !token) return;
  await db.db.delete(sessions).where(eq(sessions.token, token));
}

/** 清理过期会话(启动/定期调用均可)。 */
export async function pruneExpiredSessions(): Promise<void> {
  const db = getSharedDb();
  if (!db) return;
  await db.db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
}

// ── GitHub OAuth ──

export type UpsertGithubUserResult =
  | { ok: true; user: PublicUser; created: boolean }
  | { ok: false; error: '数据库未初始化' };

/** GitHub OAuth 登录:按 githubId 查找;不存在则建新账号。
 *  已有本地账号绑定同一 githubId 时直接复用(users.githubId 唯一)。 */
export async function upsertGithubUser(profile: {
  githubId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}): Promise<UpsertGithubUserResult> {
  const db = getSharedDb();
  if (!db) return { ok: false, error: '数据库未初始化' };
  const now = Date.now();
  const byGithub = await db.db.select().from(users).where(eq(users.githubId, profile.githubId)).limit(1);
  if (byGithub[0]) {
    // 刷新头像/昵称(GitHub 侧可能变更)
    const updated = await db.db
      .update(users)
      .set({ displayName: profile.displayName, avatarUrl: profile.avatarUrl, updatedAt: now })
      .where(eq(users.id, byGithub[0].id))
      .returning();
    return { ok: true, user: toPublic(updated[0]), created: false };
  }
  // 生成唯一 username:GitHub login 冲突时追加数字后缀
  let base = normalizeUsername(profile.username).replace(/[^\w\u4e00-\u9fa5-]/g, '') || 'github';
  if (base.length < 2) base = `gh-${base}`;
  let username = base;
  for (let i = 0; ; i++) {
    const taken = await db.db.select().from(users).where(eq(users.username, username)).limit(1);
    if (taken.length === 0) break;
    username = `${base.slice(0, 20)}-${i + 1}`;
  }
  const inserted = await db.db
    .insert(users)
    .values({
      id: generateUserId(),
      username,
      passwordHash: null,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      provider: 'github',
      githubId: profile.githubId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { ok: true, user: toPublic(inserted[0]), created: true };
}

/** 把 GitHub 绑定到已有本地账号(同 githubId 已被其他账号占用时失败)。 */
export async function linkGithubToUser(
  userId: string,
  profile: { githubId: string; displayName: string; avatarUrl: string | null },
): Promise<PublicUser | null> {
  const db = getSharedDb();
  if (!db) return null;
  const taken = await db.db.select().from(users).where(eq(users.githubId, profile.githubId)).limit(1);
  if (taken[0] && taken[0].id !== userId) return null;
  const updated = await db.db
    .update(users)
    .set({
      githubId: profile.githubId,
      avatarUrl: profile.avatarUrl,
      updatedAt: Date.now(),
    })
    .where(and(eq(users.id, userId)))
    .returning();
  return updated[0] ? toPublic(updated[0]) : null;
}

/** 昵称规则:1-24 位,不含空白与控制字符(展示名,允许比 username 宽松的中英混排)。 */
export function isValidDisplayName(raw: string): boolean {
  const t = raw.trim();
  return t.length >= 1 && t.length <= 24 && !/\s/.test(t);
}

/** 修改昵称(个人页)。返回更新后的公开信息;昵称不合法/用户不存在返回 null。 */
export async function updateDisplayName(
  userId: string,
  displayName: string,
): Promise<PublicUser | null> {
  if (!isValidDisplayName(displayName)) return null;
  const db = getSharedDb();
  if (!db) return null;
  const updated = await db.db
    .update(users)
    .set({ displayName: displayName.trim(), updatedAt: Date.now() })
    .where(eq(users.id, userId))
    .returning();
  return updated[0] ? toPublic(updated[0]) : null;
}

/** 修改密码(个人页)。oldPassword 校验失败返回 '旧密码错误'。 */
export type ChangePasswordResult =
  | { ok: true; user: PublicUser }
  | { ok: false; error: '旧密码错误' | '密码不合法' | '无密码可改' | '数据库未初始化' | '用户不存在' };

export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const db = getSharedDb();
  if (!db) return { ok: false, error: '数据库未初始化' };
  const rows = await db.db.select().from(users).where(eq(users.id, userId)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: '用户不存在' };
  if (!row.passwordHash) return { ok: false, error: '无密码可改' };
  const oldOk = await verifyPassword(oldPassword, row.passwordHash);
  if (!oldOk) return { ok: false, error: '旧密码错误' };
  if (!isValidPassword(newPassword)) return { ok: false, error: '密码不合法' };
  const updated = await db.db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: Date.now() })
    .where(eq(users.id, userId))
    .returning();
  return { ok: true, user: toPublic(updated[0]) };
}
