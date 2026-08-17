// src/server/auth/password.ts — 密码哈希(纯函数,无 DB/无模块级可变状态)。
// scrypt(N=16384,r=8,p=1,dklen=64) + 16B 随机盐,格式 `salt:hash`(hex)。
// Node 内置 crypto,无第三方依赖;verify 使用 timingSafeEqual 防时序攻击。
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;
const SALT_LEN = 16;

/** 哈希明文密码 → `salt:hash`(hex)。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** 校验明文密码与 `salt:hash` 是否匹配。格式非法/长度不符返回 false(不抛)。 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const sep = stored.indexOf(':');
  if (sep <= 0) return false;
  const saltHex = stored.slice(0, sep);
  const hashHex = stored.slice(sep + 1);
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scrypt(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** 生成登录会话 token(48 字节随机 hex)。 */
export function generateSessionToken(): string {
  return randomBytes(48).toString('hex');
}

/** 生成用户 id(前缀 u + 16 字节随机 hex)。 */
export function generateUserId(): string {
  return `u${randomBytes(16).toString('hex')}`;
}
