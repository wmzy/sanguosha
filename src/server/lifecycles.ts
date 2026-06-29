// server/lifecycles.ts
// 集中管理所有模块级 Map 和资源的清理
import { createLogger } from './logger';

const log = createLogger('lifecycles');

type Cleanup = () => void | Promise<void>;
type Resource = { name: string; ref: unknown; cleanup: Cleanup };

const resources = new Map<string, Resource>();

/**
 * 注册一个资源用于统一清理
 * @param name 资源唯一名称
 * @param ref 资源引用（仅用于标识，不做深拷贝）
 * @param cleanup 清理函数（可选，默认只从注册表移除）
 */
export function register(name: string, ref: unknown, cleanup?: Cleanup): void {
  const existing = resources.get(name);
  if (existing) {
    log.warn(`资源 ${name} 重复注册，覆盖之前的注册`);
  }
  resources.set(name, {
    name,
    ref,
    cleanup:
      cleanup ??
      (() => {
        resources.delete(name);
      }),
  });
}

/**
 * 注销一个资源并立即调用其清理函数
 */
export async function unregister(name: string): Promise<void> {
  const resource = resources.get(name);
  if (!resource) return;
  try {
    await resource.cleanup();
  } catch (err) {
    log.error(`注销资源 ${name} 失败`, { error: String(err) });
  }
  resources.delete(name);
}

/**
 * 统一清理所有注册的资源
 * 在 graceful shutdown 流程中调用
 */
export async function shutdownAll(): Promise<void> {
  log.info(`开始清理 ${resources.size} 个注册资源`);
  const errors: Array<{ name: string; error: unknown }> = [];

  for (const resource of resources.values()) {
    try {
      await resource.cleanup();
    } catch (err) {
      errors.push({ name: resource.name, error: err });
    }
  }

  resources.clear();

  if (errors.length > 0) {
    log.error('部分资源清理失败', { failed: errors.map((e) => e.name) });
  } else {
    log.info('所有注册资源已清理');
  }
}

/**
 * 获取当前注册的资源数量（用于测试和监控）
 */
export function getResourceCount(): number {
  return resources.size;
}

/**
 * 重置注册表（仅供测试使用）
 */
export function _resetForTests(): void {
  resources.clear();
}
