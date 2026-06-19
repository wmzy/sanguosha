#!/usr/bin/env node
// scripts/e2e-1p.mjs
// Single headless WS client. Joins room, picks first candidate for self.

import WebSocket from 'ws';
import process from 'node:process';

const ROOM_ID = process.argv[2] || 'ARQMLZ';
const SELF_IDX = parseInt(process.argv[3] || '1', 10);
const WS_URL = 'ws://localhost:3930/ws';

const ws = new WebSocket(WS_URL);
let lastSeq = 0;

ws.on('message', (data) => {
  const m = JSON.parse(data.toString());
  if (m.type === 'debugGameState' || m.type === 'initialView') {
    lastSeq = m.lastSeq;
    const view = m.state;
    const pending = view?.pending;
    if (pending?.atom?.type === '选将询问' && pending.atom.target === SELF_IDX) {
      const candidates = pending.atom.candidates;
      if (candidates && candidates.length > 0) {
        const choice = candidates[0].name;
        process.stdout.write(`[P${SELF_IDX}] picking: ${choice}\n`);
        ws.send(JSON.stringify({
          type: 'action',
          baseSeq: lastSeq,
          action: {
            skillId: '系统规则',
            actionType: '选将',
            ownerId: SELF_IDX,
            params: { character: choice },
            baseSeq: lastSeq,
          },
        }));
      }
    }
  }
});
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'join_debug_room', roomId: ROOM_ID, lastSeq: 0 }));
});
ws.on('error', (e) => process.stderr.write(`[P${SELF_IDX}] err: ${e.message}\n`));

setTimeout(() => process.exit(0), 120000);
