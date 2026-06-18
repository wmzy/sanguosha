import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:3930/ws');
ws.on('open', () => ws.send(JSON.stringify({type:'join_debug_room', roomId:'3JTF40', lastSeq:0})));
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.type === 'error') { console.log('ERROR:', m.message); process.exit(0); }
  if (m.type !== 'debugGameState') return;
  const s = m.state;
  console.log('phase:', s.phase, 'currentPlayer:', s.currentPlayerIndex);
  console.log('pending:', s.pending ? `${s.pending.atom?.type}/${s.pending.atom?.requestType} target=${s.pending.atom?.target}` : 'none');
  console.log('processing:', JSON.stringify(s.zones?.processing));
  for (const p of s.players) {
    console.log(`  P${p.index} ${p.name} hp:${p.health} hand:${p.handCount} alive:${p.alive} equip:${Object.keys(p.equipment||{}).join(',')}`);
  }
  console.log('log:', s.log?.slice(-8).map(l=>l.text).join(' | '));
  process.exit(0);
});
ws.on('error', e => { console.log('WS ERR', e.message); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 5000);
