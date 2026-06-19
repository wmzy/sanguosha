#!/usr/bin/env node
import WebSocket from 'ws';
import fs from 'node:fs';

const ROOM_ID = process.argv[2] || 'ARQMLZ';
const SELF_IDX = parseInt(process.argv[3] || '1', 10);
const log = fs.createWriteStream(`/tmp/ws-${SELF_IDX}.log`, { flags: 'w' });
const out = (...args) => { log.write(args.join(' ') + '\n'); };

const ws = new WebSocket('ws://localhost:3930/ws');
let lastSeq = 0;

ws.on('open', () => {
  out('[open]');
  ws.send(JSON.stringify({ type: 'join_debug_room', roomId: ROOM_ID, lastSeq: 0 }));
});

ws.on('message', (data) => {
  const m = JSON.parse(data.toString());
  out('[msg]', m.type, m.lastSeq ?? '', '|', JSON.stringify(m.state?.pending ?? m).slice(0, 200));
  if (m.type === 'debugGameState' || m.type === 'initialView') {
    lastSeq = m.lastSeq;
    const view = m.state;
    const pending = view?.pending;
    if (pending?.atom?.type === '选将询问') {
      out('[pending] target=', pending.atom.target, 'want=', SELF_IDX, 'cands=', (pending.atom.candidates || []).map(c => c.name).join(','));
      if (pending.atom.target === SELF_IDX) {
        const candidates = pending.atom.candidates;
        if (candidates && candidates.length > 0) {
          const choice = candidates[0].name;
          out('[pick]', choice);
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
  }
});
ws.on('error', (e) => out('[err]', e.message));
ws.on('close', () => out('[close]'));

setTimeout(() => { out('[exit]'); process.exit(0); }, 30000);
