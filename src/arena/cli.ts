import { readFileSync } from 'node:fs';
import { runArena } from './runner';
import type { ArenaConfig } from './types';

const configPath = process.argv[2];
if (!configPath) throw new Error('用法：pnpm arena <config.json>，示例见 configs/arena.example.json');
const config = JSON.parse(readFileSync(configPath, 'utf8')) as ArenaConfig;
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
const result = await runArena(config, { signal: controller.signal, log: (line) => process.stdout.write(`${line}\n`) });
if (result.status !== 'completed') process.exitCode = 1;
