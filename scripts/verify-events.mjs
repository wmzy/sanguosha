#!/usr/bin/env node
// 验证新事件流协议:连接 debug 房,观察收到的消息类型(event vs initialView)。
// 用法:node scripts/verify-events.mjs [playerCount]
import WebSocket from 'ws';

const PLAYER_COUNT = parseInt(process.argv[2] || '2', 10);
const PORT = 3931;

async function main() {
  // 1. 创建 debug 房
  const res = await fetch(`http://localhost:${PORT}/api/debug-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerCount: PLAYER_COUNT }),
  });
  const { roomId } = await res.json();
  console.log(`[room] created ${roomId} (${PLAYER_COUNT}p)`);

  // 2. 连接 viewer 0
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const msgTypes = [];
  let eventCount = 0;

  ws.on('open', () => {
    console.log('[ws] open');
    ws.send(JSON.stringify({ type: 'join_debug_room', roomId, lastSeq: 0 }));
  });

  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    msgTypes.push(m.type);
    if (m.type === 'initialView') {
      console.log(`[initialView] lastSeq=${m.lastSeq} phase=${m.state?.phase} players=${m.state?.players?.length}`);
      console.log(`  hand isolation: P0 hand=${m.state?.players?.[0]?.hand?.length ?? 'undefined'} P1 hand=${m.state?.players?.[1]?.hand?.length ?? 'undefined'}`);
    } else if (m.type === 'event') {
      eventCount++;
      console.log(`[event] seq=${m.seq} view.type=${m.view?.type} deadline=${m.deadline ? 'yes' : 'no'}`);
    } else {
      console.log(`[${m.type}]`, JSON.stringify(m).slice(0, 120));
    }
  });

  ws.on('error', (e) => console.error('[err]', e.message));

  // 3. 跑 10 秒收消息后退出
  await new Promise(r => setTimeout(r, 10000));
  console.log(`\n[summary] total msgs=${msgTypes.length} types=${[...new Set(msgTypes)].join(',')} events=${eventCount}`);
  ws.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
