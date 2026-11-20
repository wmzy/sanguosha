// server/http.ts — HTTP 请求体读取/字段提取的零依赖叶子助手。
// 供 routes/ 各路由文件与 auth/routes.ts 共用;本文件不得
// import room/session 等业务模块,保持依赖方向 routes→叶子、auth→叶子。
import type { Context } from 'hono';

/** 读取 JSON body;缺失/解析失败回退空对象(与原 rest.ts 各路由内联写法一致)。 */
export async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

/** 提取可选字符串字段(缺失/类型不符回退空串)。 */
export function optString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
