// src/client/utils/debugTelemetry.ts
// Debug 遥测:非侵入采集前端运行时数据(控制台日志 / WS 消息流 / DOM 快照 / 用户操作)。
//
// 设计原则:只读旁路——不触碰游戏渲染状态树、不改 WS 连接行为、不影响正常逻辑。
// 仅 debug 模式安装(installTelemetry),离开时卸载(uninstallTelemetry)。
// 快照触发时 collectTelemetry() 返回全部 ring buffer 数据,随 POST 发送到后端。
//
// 采集内容:
//   1. console.error / console.warn / window.onerror / unhandledrejection → 控制台日志
//   2. WS 收发消息 → WS 消息流(排查事件顺序/丢失/reject)
//   3. 用户操作(出牌/视角切换/整理手牌) → 用户操作时间线
//   4. DOM 快照(#root outerHTML) → React 实际渲染的结构

const MAX_CONSOLE = 300;
const MAX_WS = 500;
const MAX_ACTIONS = 200;

// ─── 数据类型 ───

export interface ConsoleEntry {
  time: number;
  level: 'error' | 'warn';
  message: string;
}

export interface WsEntry {
  time: number;
  seat: number;
  dir: 'in' | 'out';
  msg: unknown;
}

export interface ActionEntry {
  time: number;
  kind:
    | 'action'
    | 'reorder'
    | 'perspective'
    | 'ready'
    | 'start_game'
    | 'restart_game'
    | 'update_config';
  detail: unknown;
}

export interface TelemetryData {
  consoleLog: ConsoleEntry[];
  wsMessages: WsEntry[];
  userActions: ActionEntry[];
  domHtml: string;
  capturedAt: number;
  viewport: { width: number; height: number };
  url: string;
}

// ─── ring buffer 状态(模块级单例) ───

let installed = false;
let consoleBuffer: ConsoleEntry[] = [];
let wsBuffer: WsEntry[] = [];
let actionBuffer: ActionEntry[] = [];

let origConsoleError: ((...args: unknown[]) => void) | null = null;
let origConsoleWarn: ((...args: unknown[]) => void) | null = null;

// ─── 内部工具 ───

function resetBuffers(): void {
  consoleBuffer = [];
  wsBuffer = [];
  actionBuffer = [];
}

function pushConsole(level: 'error' | 'warn', message: string): void {
  consoleBuffer.push({ time: Date.now(), level, message });
  if (consoleBuffer.length > MAX_CONSOLE) consoleBuffer.shift();
}

/** 把任意值转成可读字符串。Error 保留完整 stack。 */
function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    const stack = arg.stack ?? '';
    return stack ? `${arg.name}: ${arg.message}\n${stack}` : `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  try {
    return JSON.stringify(arg);
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

function handleWindowError(e: ErrorEvent): void {
  const loc = e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : '';
  pushConsole('error', `window.onerror: ${e.message}${loc}`);
}

function handleRejection(e: PromiseRejectionEvent): void {
  const reason =
    e.reason instanceof Error
      ? `${e.reason.message}\n${e.reason.stack ?? ''}`
      : formatArg(e.reason);
  pushConsole('error', `unhandledrejection: ${reason}`);
}

// ─── 公开 API ───

/** 安装遥测:劫持 console.error/warn + 注册全局异常监听。幂等。 */
export function installTelemetry(): void {
  if (installed) return;
  installed = true;
  resetBuffers();

  // 保存原生引用(用 bind 确保 this 正确)
  origConsoleError = console.error.bind(console);
  origConsoleWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    pushConsole('error', args.map(formatArg).join(' '));
    origConsoleError!(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushConsole('warn', args.map(formatArg).join(' '));
    origConsoleWarn!(...args);
  };

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleRejection);
}

/** 卸载遥测:恢复 console + 移除监听 + 清空 buffer。幂等。 */
export function uninstallTelemetry(): void {
  if (!installed) return;
  installed = false;
  if (origConsoleError) console.error = origConsoleError;
  if (origConsoleWarn) console.warn = origConsoleWarn;
  origConsoleError = null;
  origConsoleWarn = null;
  window.removeEventListener('error', handleWindowError);
  window.removeEventListener('unhandledrejection', handleRejection);
  resetBuffers();
}

/** 记录一条 WS 收/发消息。仅 installed 时生效。 */
export function logWsMessage(seat: number, dir: 'in' | 'out', msg: unknown): void {
  if (!installed) return;
  wsBuffer.push({ time: Date.now(), seat, dir, msg });
  if (wsBuffer.length > MAX_WS) wsBuffer.shift();
}

/** 记录一条用户操作。仅 installed 时生效。 */
export function logUserAction(
  kind:
    | 'action'
    | 'reorder'
    | 'perspective'
    | 'ready'
    | 'start_game'
    | 'restart_game'
    | 'update_config',
  detail: unknown,
): void {
  if (!installed) return;
  actionBuffer.push({ time: Date.now(), kind, detail });
  if (actionBuffer.length > MAX_ACTIONS) actionBuffer.shift();
}

/** 采集全部遥测数据快照(ring buffer 浅拷贝 + DOM outerHTML)。 */
export function collectTelemetry(): TelemetryData {
  const root = document.getElementById('root');
  return {
    consoleLog: [...consoleBuffer],
    wsMessages: [...wsBuffer],
    userActions: [...actionBuffer],
    domHtml: root ? root.outerHTML : '<!-- #root not found -->',
    capturedAt: Date.now(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: window.location.href,
  };
}
