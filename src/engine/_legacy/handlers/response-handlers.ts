// @ts-nocheck
// engine/handlers/response-handlers.ts — 响应窗口处理（向后兼容 shim）
//
// 实现已拆分到 `engine/handlers/response/` 子模块。
// 旧 import 路径（`from './response-handlers'`）通过此 re-export 保持工作。

export {
  resolveResponse,
  resolveKillResponse,
  resolveAoeResponse,
  executeAoeResume,
  startAoeTargetWuxie,
  resolveDuelResponse,
  resolveTrickResponse,
  executeTrickEffect,
  createConcurrentTrickResponse,
  resolveDyingResponse,
  resolveSelectCard,
} from './response';
