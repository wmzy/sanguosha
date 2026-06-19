#!/usr/bin/env node
// scripts/e2e-4p.mjs
// 4-player e2e driver via raw WebSocket.
// P0 = browser (already joined); P1/P2/P3 = headless clients.

import WebSocket from 'ws';
import process from 'node:process';

const ROOM_ID = process.argv[2] || 'ARQMLZ';
const P0_PORT = 3930;
const WS_URL = `ws://localhost:${P0_PORT}/ws`;

function makeClient(label) {
  const ws = new WebSocket(WS_URL);
  const inbox = [];
  let resolve;
  const wait = () => new Promise((r) => { resolve = r; });
  const got = (msg) => { if (resolve) { const r = resolve; resolve = null; r(msg); } else { inbox.push(msg); } };
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    // console.log(`[${label}] <-`, JSON.stringify(m).slice(0, 200));
    got(m);
  });
  ws.on('error', (e) => console.error(`[${label}] err`, e.message));
  const send = (msg) => ws.send(JSON.stringify(msg));
  const next = () => inbox.length ? inbox.shift() : wait();
  return { ws, send, next, label, open: new Promise((r) => ws.on('open', r)) };
}

function findPendingSlotFor(view, target) {
  // Returns character candidates for given target
  const p = view?.pending;
  if (!p) return null;
  if (p.atom?.type === '选将询问' && p.atom.target === target) return p.atom.candidates;
  return null;
}

function findActionPromptFor(view, ownerId) {
  const p = view?.pending;
  if (!p) return null;
  return p;
}

async function main() {
  // Spawn P1, P2, P3
  const clients = [null, makeClient('P1'), makeClient('P2'), makeClient('P3')];
  await Promise.all(clients.slice(1).map((c) => c.open));
  console.log('[main] P1/P2/P3 WS connected');

  // Each joins the debug room
  for (let i = 1; i <= 3; i++) {
    const c = clients[i];
    c.send({ type: 'join_debug_room', roomId: ROOM_ID, lastSeq: 0 });
    const joined = await c.next();
    console.log(`[P${i}] room_joined:`, joined);
  }

  // Drive char selection loop: react to pending slots per-player
  // Each player picks the first candidate from their pool
  for (let i = 1; i <= 3; i++) {
    const c = clients[i];
    let attempts = 0;
    while (attempts < 200) {
      const msg = await c.next();
      if (msg.type === 'debugGameState' || msg.type === 'initialView') {
        const view = msg.state;
        const candidates = findPendingSlotFor(view, i);
        if (candidates && candidates.length > 0) {
          const choice = candidates[0].name;
          console.log(`[P${i}] picking character: ${choice}`);
          c.send({
            type: 'action',
            baseSeq: msg.lastSeq,
            action: {
              skillId: '系统规则',
              actionType: '选将',
              ownerId: i,
              params: { character: choice },
              baseSeq: msg.lastSeq,
            },
          });
          // break to wait for next view
          break;
        }
        // No pending for us; consume messages until we get a char select
        // Push back: re-enqueue this message? Easier: just look at the latest and loop
        // The WebSocket is message-stream, so we should NOT break. But here we re-process
        // the same state — break, then next iteration will look again.
      }
      attempts++;
    }
  }
  console.log('[main] all 3 headless players issued char select');

  // Keep the WS alive for a bit so the browser can observe the final state
  setTimeout(() => {
    console.log('[main] exiting');
    process.exit(0);
  }, 30000);
}

main().catch((e) => { console.error(e); process.exit(1); });
