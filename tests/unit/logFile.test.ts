import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GameLog } from '../../shared/log';
import { saveLog, loadLog } from '../../src/utils/logFile';

// Mock URL and document for saveLog
const mockClick = vi.fn();
const mockRevokeObjectURL = vi.fn();
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');

beforeEach(() => {
  vi.stubGlobal('URL', {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
  });
  vi.spyOn(document, 'createElement').mockReturnValue({
    href: '',
    download: '',
    click: mockClick,
  } as unknown as HTMLAnchorElement);
});

function makeGameLog(overrides?: Partial<GameLog>): GameLog {
  return {
    meta: {
      version: '1.0.0',
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['刘备', '曹操'],
      seed: 42,
    },
    serverOps: [{ seq: 1, timestamp: Date.now(), type: '游戏开始', data: {}, description: 'test' }],
    playerOps: {
      刘备: [{ seq: 1, timestamp: Date.now(), type: '摸牌', data: {}, description: '摸牌' }],
    },
    ...overrides,
  };
}

function makeFile(content: string): File {
  return new File([content], 'test.json', { type: 'application/json' });
}

describe('saveLog', () => {
  it('调用时不抛错', () => {
    const log = makeGameLog();
    expect(() => saveLog(log)).not.toThrow();
  });

  it('创建 blob 并触发下载', () => {
    const log = makeGameLog();
    saveLog(log);
    expect(mockCreateObjectURL).toHaveBeenCalledOnce();
    expect(mockClick).toHaveBeenCalledOnce();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('文件名包含 sanguosha-log- 前缀', () => {
    const log = makeGameLog();
    saveLog(log);
    const anchor = document.createElement('a') as unknown as { download: string };
    // The mock returns the same object, check the download set in saveLog
    expect(anchor.download).toMatch(/^sanguosha-log-\d+\.json$/);
  });
});

describe('loadLog', () => {
  it('解析合法 GameLog 返回对象', async () => {
    const log = makeGameLog();
    const file = makeFile(JSON.stringify(log));
    const result = await loadLog(file);
    expect(result.meta.version).toBe('1.0.0');
    expect(result.serverOps).toHaveLength(1);
    expect(result.playerOps['刘备']).toHaveLength(1);
  });

  it('缺少 meta 抛 Error', async () => {
    const file = makeFile(JSON.stringify({ serverOps: [], playerOps: {} }));
    await expect(loadLog(file)).rejects.toThrow('Invalid GameLog structure');
  });

  it('缺少 serverOps 抛 Error', async () => {
    const file = makeFile(JSON.stringify({ meta: { version: '1.0.0' }, playerOps: {} }));
    await expect(loadLog(file)).rejects.toThrow('Invalid GameLog structure');
  });

  it('缺少 playerOps 抛 Error', async () => {
    const file = makeFile(JSON.stringify({ meta: { version: '1.0.0' }, serverOps: [] }));
    await expect(loadLog(file)).rejects.toThrow('Invalid GameLog structure');
  });

  it('serverLog 可选字段允许省略', async () => {
    const log = makeGameLog();
    const file = makeFile(JSON.stringify(log));
    const result = await loadLog(file);
    expect(result.serverLog).toBeUndefined();
  });

  it('serverLog 存在时正确解析', async () => {
    const log = makeGameLog({
      serverLog: [{ id: 'evt-1', type: '摸牌', timestamp: Date.now(), payload: {} }],
    });
    const file = makeFile(JSON.stringify(log));
    const result = await loadLog(file);
    expect(result.serverLog).toHaveLength(1);
    expect(result.serverLog![0].id).toBe('evt-1');
  });

  it('无效 JSON 抛 Error', async () => {
    const file = makeFile('not json');
    await expect(loadLog(file)).rejects.toThrow();
  });
});

describe('saveLog/loadLog round-trip', () => {
  it('数据一致', async () => {
    const log = makeGameLog({
      serverLog: [{ id: 'evt-1', type: '游戏开始', timestamp: 1000, payload: { a: 1 } }],
    });
    const json = JSON.stringify(log, null, 2);
    const file = makeFile(json);
    const result = await loadLog(file);
    expect(result).toEqual(log);
  });
});
