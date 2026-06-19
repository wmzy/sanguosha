#!/usr/bin/env node
// scripts/e2e-4p.mjs
// 4-player e2e driver via raw WebSocket.
// P0 = browser (already joined as player-0/Lord).
// P1/P2/P3 = 3 headless clients.

import WebSocket from 'ws';
import process from 'node:process';

const ROOM_ID = process.argv[2] || 'ARQMLZ';
const WS_URL = 'ws://localhost:3930/ws';

function makeClient(label) {
  const ws = new WebSocket(WS_URL);
  const waiters = [];
  let inbox = [];
  const arm = (resolver) => waiters.push(resolver);
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (waiters.length) {
      const r = waiters.shift();
      r(m);
    } else {
      inbox.push(m);
    }
  });
  ws.on('error', (e) => console.error(`[${label}] err`, e.message));
  const send = (msg) => ws.send(JSON.stringify(msg));
  const next = () => inbox.length ? Promise.resolve(inbox.shift()) : new Promise(arm);
  return { ws, send, next, label, open: new Promise((r) => ws.on('open', r)) };
}

async function main() {
  const clients = [null, makeClient('P1'), makeClient('P2'), makeClient('P3')];
  await Promise.all(clients.slice(1).map((c) => c.open));
  console.log('[main] P1/P2/P3 WS connected');

  for (let i = 1; i <= 3; i++) {
    const c = clients[i];
    c.send({ type: 'join_debug_room', roomId: ROOM_ID, lastSeq: 0 });
  }
  console.log('[main] all 4 sent join_debug_room');

  // Each client responds when a char-select slot for its ownerId appears.
  for (let i = 1; i <= 3; i++) {
    const c = clients[i];
    c.labelSelf = `P${i}`;
    (async () => {
      let lastSeq = 0;
      // pump
      while (true) {
        const msg = await c.next();
        if (msg.type === 'debugGameState' || msg.type === 'initialView') {
          lastSeq = msg.lastSeq;
          const view = msg.state;
          const pending = view?.pending;
          if (pending?.atom?.type === '选将询问' && pending.atom.target === i) {
            const candidates = pending.atom.candidates;
            if (candidates && candidates.length > 0) {
              const choice = candidates[0].name;
              console.log(`[P${i}] picking character: ${choice}`);
              c.send({
                type: 'action',
                baseSeq: lastSeq,
                action: {
                  skillId: '系统规则',
                  actionType: '选将',
                  ownerId: i,
                  params: { character: choice },
                  baseSeq: lastSeq,
                },
              });
            }
          }
        }
      }
    })();
  }

  // Keep alive
  setTimeout(() => { console.log('[main] exiting'); process.exit(0); }, 60000);
}

main().catch((e) => { console.error(e); process.exit(1); });
