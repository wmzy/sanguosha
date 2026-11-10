import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runArena } from '../src/arena/runner';

const result = await runArena({
  name: '中止归档验证', timeoutSec: 2, maxDecisions: 6, maxDurationMs: 30000,
  players: [{ id: 'one', name: '甲', mode: 'heuristic' }, { id: 'two', name: '乙', mode: 'heuristic' }],
}, { log: (line) => process.stdout.write(`${line}\n`) });
const replayPath = resolve('data/arena', result.id, 'replay.json');
if (result.status !== 'interrupted' || !existsSync(replayPath)) throw new Error('中止局未导出录像');
const replay = JSON.parse(readFileSync(replayPath, 'utf8')) as { seats: Record<string, unknown> };
if (Object.keys(replay.seats).length < 3) throw new Error('中止录像缺少玩家或旁观视角');
process.stdout.write(`中止归档验证通过：${result.id}\n`);
