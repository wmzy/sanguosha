import type { Hono } from 'hono';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ARENA_DIR, safeName } from '../arena/archive';
import type { ArenaManifest } from '../arena/types';
import { gameSessions } from './registry';
import { getSessionUser } from './auth/guard';
import { getRoom } from './room';
import { buildAudienceView } from '../engine/view/audience';

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as unknown : null;
}

export function applyArenaRoutes(app: Hono): void {
  // Explicit director endpoint; never exposed as a player/MCP observation tool.
  app.get('/api/rooms/:id/audience', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    if (!room.isDebug) {
      const user = await getSessionUser(c);
      if (!user || (!room.players.has(user.id) && !room.spectators.has(user.id)))
        return c.json({ error: '观众快照需要房间成员身份' }, 403);
    }
    const state = gameSessions.get(roomId)?.getState();
    return c.json(state ? { seq: state.seq, at: Date.now(), view: buildAudienceView(state) } : null);
  });

  app.get('/api/rooms/:id/arena-replay', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    if (!room.isDebug) {
      const user = await getSessionUser(c);
      if (!user || (!room.players.has(user.id) && !room.spectators.has(user.id)))
        return c.json({ error: '录像导出需要房间成员身份' }, 403);
    }
    return c.json(gameSessions.get(roomId)?.exportArenaReplay() ?? null);
  });

  app.get('/api/arena', (c) => {
    const matches: ArenaManifest[] = [];
    if (existsSync(DEFAULT_ARENA_DIR)) {
      for (const dir of readdirSync(DEFAULT_ARENA_DIR, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        try {
          const manifest = readJson(join(DEFAULT_ARENA_DIR, dir.name, 'manifest.json')) as ArenaManifest | null;
          if (manifest) matches.push(manifest);
        } catch { /* Another process may be updating its manifest. Poll on the next tick. */ }
      }
    }
    return c.json({ matches: matches.sort((a, b) => b.startedAt - a.startedAt) });
  });

  app.get('/api/arena/:id', (c) => {
    const dir = join(DEFAULT_ARENA_DIR, safeName(c.req.param('id')));
    const manifest = readJson(join(dir, 'manifest.json'));
    if (!manifest) return c.json({ error: '对局归档不存在' }, 404);
    return c.json({
      manifest,
      audience: readJson(join(dir, 'audience.json')),
      publicChat: readJson(join(dir, 'chat.json')) ?? [],
    });
  });

  app.get('/api/arena/:id/frames', (c) => {
    const dir = join(DEFAULT_ARENA_DIR, safeName(c.req.param('id')));
    const jsonlPath = join(dir, 'audience.jsonl');
    if (!existsSync(jsonlPath)) return c.json({ frames: [] });
    try {
      const content = readFileSync(jsonlPath, 'utf8');
      const frames = content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      return c.json({ frames });
    } catch {
      return c.json({ frames: [] });
    }
  });
}
