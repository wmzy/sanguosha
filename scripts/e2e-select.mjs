#!/usr/bin/env node
// 端到端测试:连接 → 选将 → 验证手牌/角色/身份
import WebSocket from 'ws';

const PORT = 3950;

async function main() {
  const res = await fetch(`http://localhost:${PORT}/api/debug-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerCount: 2 }),
  });
  const { roomId } = await res.json();
  console.log(`[room] ${roomId}`);

  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    let lastSeq = 0;
    let seatIndex = -1;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join_debug_room', roomId, lastSeq: 0 }));
    });

    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());

      if (m.type === 'room_joined') {
        seatIndex = m.seatIndex;
        console.log(`[joined] seat=${seatIndex}`);
      }

      if (m.type === 'initialView') {
        lastSeq = m.lastSeq;
        const s = m.state;
        console.log(`[initialView] seq=${m.lastSeq} P0_id=${s.players[0].identity} P0_char="${s.players[0].character}" P0_hand=${s.players[0].handCount} pending=${s.pending ? s.pending.atom.type : 'null'} deck=${s.zones?.deckCount}`);
      }

      if (m.type === 'event') {
        lastSeq = m.seq;
        const v = m.view;
        console.log(`  [event] seq=${m.seq} type=${v?.type} deadline=${m.deadline ? 'yes' : 'no'}`);

        // 如果收到选将询问事件,模拟主公选将
        if (v?.type === '选将询问' && seatIndex === 0) {
          const candidates = v.candidates ?? [];
          if (candidates.length > 0) {
            const choice = candidates[0].name;
            console.log(`[select] choosing ${choice}`);
            ws.send(JSON.stringify({
              type: 'action',
              action: {
                skillId: '系统规则',
                actionType: '选将',
                ownerId: 0,
                params: { character: choice },
                baseSeq: lastSeq,
              },
              baseSeq: lastSeq,
            }));
          }
        }
      }
    });

    ws.on('error', (e) => console.error('[err]', e.message));

    // 30 秒后检查最终状态
    setTimeout(() => {
      console.log('\n[timeout] closing');
      ws.close();
      resolve();
    }, 30000);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
