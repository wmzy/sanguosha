// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveReplay, loadReplay, isReplayFile } from '../../src/client/replay/replayFile';
import type { ReplayFile } from '../../src/client/replay/types';

const mockClick = vi.fn();
const mockRevokeObjectURL = vi.fn();
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');

beforeEach(() => {
  mockClick.mockClear();
  mockRevokeObjectURL.mockClear();
  mockCreateObjectURL.mockClear();
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

function makeReplayFile(overrides?: Partial<ReplayFile>): ReplayFile {
  return {
    format: 'sanguosha-replay',
    version: 1,
    meta: { createdAt: 1000, playerCount: 2, characters: ['刘备', '曹操'] },
    seats: {
      0: {
        seatIndex: 0,
        playerName: '刘备',
        initialView: {
          viewer: 0,
          currentPlayerIndex: 0,
          phase: '出牌',
          turn: { round: 1, phase: '出牌', vars: {} },
          players: [],
          cardMap: {},
          pending: null,
          deadline: null,
          deadlineTotalMs: 0,
          log: [],
          settlementStack: [],
        },
        events: [{ seq: 0, time: 1000, event: { type: '摸牌' } }],
      },
    },
    ...overrides,
  };
}

function makeFile(content: string): File {
  return new File([content], 'test.json', { type: 'application/json' });
}

describe('saveReplay', () => {
  it('创建 blob 并触发下载', () => {
    saveReplay(makeReplayFile());
    expect(mockCreateObjectURL).toHaveBeenCalledOnce();
    expect(mockClick).toHaveBeenCalledOnce();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('文件名包含 createdAt', () => {
    saveReplay(makeReplayFile());
    const anchor = document.createElement('a') as unknown as { download: string };
    expect(anchor.download).toMatch(/^sanguosha-replay-\d+\.json$/);
  });
});

describe('isReplayFile', () => {
  it('合法结构返回 true', () => {
    expect(isReplayFile(makeReplayFile())).toBe(true);
  });

  it('format 不符返回 false', () => {
    expect(isReplayFile({ ...makeReplayFile(), format: 'other' })).toBe(false);
  });

  it('version 不符返回 false', () => {
    expect(isReplayFile({ ...makeReplayFile(), version: 99 })).toBe(false);
  });

  it('缺少 meta 返回 false', () => {
    expect(isReplayFile({ format: 'sanguosha-replay', version: 1, seats: {} })).toBe(false);
  });

  it('seats 中缺少 seatIndex 返回 false', () => {
    const bad = makeReplayFile();
    (bad.seats[0] as unknown as Record<string, unknown>).seatIndex = 'not-a-number';
    expect(isReplayFile(bad)).toBe(false);
  });

  it('null 返回 false', () => {
    expect(isReplayFile(null)).toBe(false);
  });
});

describe('loadReplay', () => {
  it('解析合法文件返回 ReplayFile', async () => {
    const file = makeFile(JSON.stringify(makeReplayFile()));
    const result = await loadReplay(file);
    expect(result.format).toBe('sanguosha-replay');
    expect(result.seats[0].playerName).toBe('刘备');
  });

  it('非法 JSON 抛错', async () => {
    await expect(loadReplay(makeFile('not json'))).rejects.toThrow();
  });

  it('格式不符抛错', async () => {
    await expect(loadReplay(makeFile(JSON.stringify({ foo: 'bar' })))).rejects.toThrow(
      '无效的录像文件格式',
    );
  });
});

describe('saveReplay/loadReplay round-trip', () => {
  it('数据一致', async () => {
    const original = makeReplayFile();
    const json = JSON.stringify(original);
    const result = await loadReplay(makeFile(json));
    expect(result).toEqual(original);
  });
});
