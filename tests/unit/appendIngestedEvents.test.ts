import { describe, expect, it } from 'vitest';
import { appendIngestedEvents, MAX_INGESTED_EVENT_BUFFER } from '../../src/client/utils/appendIngestedEvents';
import type { ViewEvent } from '../../src/engine/types';

describe('appendIngestedEvents', () => {
  it('appends batches instead of replacing (React 18 WS burst)', () => {
    let seq = 0;
    const nextSeq = () => ++seq;
    const a = appendIngestedEvents([], [{ type: '打出' } as ViewEvent], nextSeq);
    const b = appendIngestedEvents(a, [{ type: '指定目标' } as ViewEvent], nextSeq);
    const c = appendIngestedEvents(b, [{ type: '出牌窗口' } as ViewEvent], nextSeq);
    expect(c.map((e) => e.event.type)).toEqual(['打出', '指定目标', '出牌窗口']);
    expect(c.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('trims to MAX_INGESTED_EVENT_BUFFER keeping newest', () => {
    let seq = 0;
    let buf = appendIngestedEvents([], [], () => ++seq);
    for (let i = 0; i < MAX_INGESTED_EVENT_BUFFER + 5; i++) {
      buf = appendIngestedEvents(buf, [{ type: `e${i}` } as ViewEvent], () => ++seq);
    }
    expect(buf).toHaveLength(MAX_INGESTED_EVENT_BUFFER);
    expect(buf[0].event.type).toBe('e5');
    expect(buf[buf.length - 1].event.type).toBe(`e${MAX_INGESTED_EVENT_BUFFER + 4}`);
  });
});
