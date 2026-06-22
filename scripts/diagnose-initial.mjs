#!/usr/bin/env node
// 精确诊断:连接 debug 房,打印 initialView 的完整内容,看手牌/身份/选将/pending 是否存在。
import WebSocket from 'ws';

const PORT = 3950;
const PLAYER_COUNT = parseInt(process.argv[2] || '2', 10);

async function main() {
  // 1. 创建 debug 房
  const res = await fetch(`http://localhost:${PORT}/api/debug-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerCount: PLAYER_COUNT }),
  });
  const { roomId } = await res.json();
  console.log(`[room] ${roomId} (${PLAYER_COUNT}p)`);

  // 2. 连接 2 个座次
  const seats = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const msgs = [];
    ws.idx = i;
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join_debug_room', roomId, lastSeq: 0 }));
    });
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      msgs.push(m);
    });
    ws.on('close', () => { /* ignore */ });
    seats.push({ ws, msgs });
  }

  // 3. 跑 12 秒收所有消息
  await new Promise(r => setTimeout(r, 12000));

  // 4. 分析
  for (const seat of seats) {
    console.log(`\n===== Seat ${seat.ws.idx}: ${seat.msgs.length} messages =====`);
    for (const m of seat.msgs) {
      if (m.type === 'initialView') {
        console.log(`[initialView] viewer=${m.viewer} lastSeq=${m.lastSeq}`);
        const s = m.state;
        console.log(`  phase=${s.phase} currentPlayerIndex=${s.currentPlayerIndex}`);
        console.log(`  players count=${s.players?.length}`);
        if (s.players) {
          for (const p of s.players) {
            console.log(`    P${p.index}: name=${p.name} character="${p.character}" hp=${p.health} handCount=${p.handCount} hand=${p.hand?.length ?? 'undef'} identity=${p.identity} identityHidden=${p.identityHidden} skills=${JSON.stringify(p.skills)}`);
          }
        }
        console.log(`  pending=${s.pending ? `type=${s.pending.atom?.type} target=${s.pending.target}` : 'null'}`);
        console.log(`  zones deck=${s.zones?.deckCount} processing=${s.zones?.processing?.length}`);
      } else if (m.type === 'events') {
        console.log(`[events] viewer=${m.viewer} fromSeq=${m.fromSeq} count=${m.events?.length}`);
        for (const e of (m.events || []).slice(0, 8)) {
          console.log(`  seq=${e.seq} type=${e.viewEvent?.type} fields=${Object.keys(e.viewEvent || {}).join(',')}`);
        }
      } else if (m.type === 'room_joined') {
        console.log(`[room_joined] playerId=${m.playerId} seatIndex=${m.seatIndex}`);
      } else if (m.type === 'error') {
        console.log(`[error] ${m.message}`);
      } else {
        console.log(`[${m.type}] ${JSON.stringify(m).slice(0,150)}`);
      }
    }
  }

  for (const seat of seats) seat.ws.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
