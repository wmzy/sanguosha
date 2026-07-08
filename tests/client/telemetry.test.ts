// @vitest-environment jsdom
// tests/client/telemetry.test.ts
// debugTelemetry 模块单元测试:验证 ring buffer / 全局异常捕获 / DOM 采集 / 安装卸载幂等。
//
// 放置说明:debugTelemetry 是前端纯工具模块(非 skill、非 integration),现有无对应目录,
// 故新建 tests/client/telemetry.test.ts。若后续前端工具测试增多,可合并到 tests/client/ 下。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  installTelemetry,
  uninstallTelemetry,
  logWsMessage,
  logUserAction,
  collectTelemetry,
} from '../../src/client/utils/debugTelemetry';

describe('debugTelemetry', () => {
  beforeEach(() => {
    uninstallTelemetry();
  });

  afterEach(() => {
    uninstallTelemetry();
  });

  it('install 前调用 logWsMessage 不采集数据', () => {
    logWsMessage(0, 'in', { type: 'event' });
    const data = collectTelemetry();
    expect(data.wsMessages).toHaveLength(0);
  });

  it('install 后 logWsMessage 正常入 buffer', () => {
    installTelemetry();
    logWsMessage(0, 'in', { type: 'event', seq: 1 });
    logWsMessage(1, 'out', { type: 'action' });
    const data = collectTelemetry();
    expect(data.wsMessages).toHaveLength(2);
    expect(data.wsMessages[0]).toMatchObject({ seat: 0, dir: 'in' });
    expect(data.wsMessages[1]).toMatchObject({ seat: 1, dir: 'out' });
  });

  it('install 后 logUserAction 正常入 buffer', () => {
    installTelemetry();
    logUserAction('action', { skillId: '杀' });
    logUserAction('perspective', 2);
    const data = collectTelemetry();
    expect(data.userActions).toHaveLength(2);
    expect(data.userActions[0].kind).toBe('action');
    expect(data.userActions[1].kind).toBe('perspective');
  });

  it('ring buffer 超限自动丢弃旧条目', () => {
    installTelemetry();
    // 超过 MAX_WS=500
    for (let i = 0; i < 550; i++) {
      logWsMessage(0, 'in', { seq: i });
    }
    const data = collectTelemetry();
    expect(data.wsMessages).toHaveLength(500);
    // 最早的条目已被丢弃,buffer 从 seq=50 开始
    expect((data.wsMessages[0].msg as { seq: number }).seq).toBe(50);
  });

  it('collectTelemetry 采集 DOM outerHTML', () => {
    // jsdom 环境默认无 #root,需手动创建
    let root = document.getElementById('root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'root';
      document.body.appendChild(root);
    }
    root.innerHTML = '<div class="test-dom">hello</div>';
    installTelemetry();
    const data = collectTelemetry();
    expect(data.domHtml).toContain('test-dom');
    expect(data.domHtml).toContain('hello');
    // 清理
    document.body.removeChild(root);
  });

  it('collectTelemetry 采集 viewport 和 url', () => {
    installTelemetry();
    const data = collectTelemetry();
    expect(data.viewport).toHaveProperty('width');
    expect(data.viewport).toHaveProperty('height');
    expect(typeof data.url).toBe('string');
  });

  it('uninstall 后 console.error 恢复原行为且不再采集', () => {
    installTelemetry();
    console.error('test error');
    let data = collectTelemetry();
    expect(data.consoleLog).toHaveLength(1);
    expect(data.consoleLog[0].message).toContain('test error');

    uninstallTelemetry();
    console.error('after uninstall');
    data = collectTelemetry();
    // uninstall 清空了 buffer,且不再采集新的
    expect(data.consoleLog).toHaveLength(0);
  });

  it('install/uninstall 幂等:重复调用不报错', () => {
    installTelemetry();
    installTelemetry();
    expect(collectTelemetry().consoleLog).toHaveLength(0);

    uninstallTelemetry();
    uninstallTelemetry();
    // uninstall 后 logWsMessage 无效(已卸载)
    logWsMessage(0, 'in', {});
    expect(collectTelemetry().wsMessages).toHaveLength(0);
  });

  it('uninstall 后重新 install 重新开始采集', () => {
    installTelemetry();
    logWsMessage(0, 'in', { first: true });
    uninstallTelemetry();

    installTelemetry();
    logWsMessage(1, 'out', { second: true });
    const data = collectTelemetry();
    // 只有一条(重新 install 后 buffer 已重置)
    expect(data.wsMessages).toHaveLength(1);
    expect((data.wsMessages[0].msg as { second: boolean }).second).toBe(true);
  });

  it('collectTelemetry 返回的是浅拷贝(不暴露内部 buffer)', () => {
    installTelemetry();
    logWsMessage(0, 'in', { seq: 1 });
    const data1 = collectTelemetry();
    // 再加一条
    logWsMessage(0, 'in', { seq: 2 });
    // data1 不应受影响(浅拷贝)
    expect(data1.wsMessages).toHaveLength(1);
    const data2 = collectTelemetry();
    expect(data2.wsMessages).toHaveLength(2);
  });
});
