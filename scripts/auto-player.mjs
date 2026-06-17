// scripts/auto-player.mjs — v3
// 自动化三国杀完整游戏模拟。
// 核心逻辑:每次循环用最新的 client.state 决策,正确处理 pending/回合切换。
// 用法: node scripts/auto-player.mjs [playerCount] [maxTurns]
import WebSocket from 'ws';

const HOST = 'localhost:3930';
const playerCount = parseInt(process.argv[2] || '2', 10);
const maxTurns = parseInt(process.argv[3] || '300', 10);

async function createDebugRoom(n) {
  const res = await fetch(`http://${HOST}/api/debug-room`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerCount: n }),
  });
  if (!res.ok) throw new Error(`createDebugRoom failed: ${res.status}`);
  return (await res.json()).roomId;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class GameClient {
  constructor(roomId) {
    this.roomId = roomId;
    this.ws = null; this.state = null; this.lastSeq = 0; this.playerId = null;
    this.errors = []; this.closed = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${HOST}/ws`);
      this.ws = ws;
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'join_debug_room', roomId: this.roomId, lastSeq: 0 }));
        resolve();
      });
      ws.addEventListener('error', reject);
      ws.addEventListener('close', () => { this.closed = true; });
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'debugGameState' || msg.type === 'initialView') {
          this.state = msg.state; this.lastSeq = msg.lastSeq;
        } else if (msg.type === 'room_joined') {
          this.playerId = msg.playerId;
        } else if (msg.type === 'error') {
          this.errors.push(msg.message);
        }
      });
    });
  }
  sendAction(action) {
    const payload = { type: 'action', action: { ...action, baseSeq: this.lastSeq }, baseSeq: this.lastSeq };
    this.ws.send(JSON.stringify(payload));
  }
  close() { this.ws?.close(); }
}

// 找手牌中的指定牌名
function findCard(state, playerIdx, name) {
  const hand = state.players[playerIdx]?.hand || [];
  const card = hand.find(c => c.name === name);
  return card?.id || null;
}

// AI 决策:返回 {action, reason} 或 null(无可做)
// killDone: 本回合是否已出过杀(quota 已用)
function decide(state, killDone = false) {
  const cur = state.currentPlayerIndex;
  const pending = state.pending;

  // 1. 有 pending — 需要某玩家回应
  if (pending) {
    const target = pending.target;
    const atomType = pending.atom?.type;
    // 询问闪
    if (atomType === '询问闪') {
      const dodge = findCard(state, target, '闪');
      if (dodge) {
        return { action: { skillId: '闪', actionType: 'respond', ownerId: target, params: { cardId: dodge } }, reason: `P${target}出闪` };
      }
      return { action: { skillId: '闪', actionType: 'respond', ownerId: target, params: {} }, reason: `P${target}不闪` };
    }
    // 询问杀(南蛮/决斗)
    if (atomType === '询问杀') {
      const kill = findCard(state, target, '杀');
      if (kill) {
        return { action: { skillId: '杀', actionType: 'respond', ownerId: target, params: { cardId: kill } }, reason: `P${target}出杀` };
      }
      return { action: { skillId: '杀', actionType: 'respond', ownerId: target, params: {} }, reason: `P${target}不出杀` };
    }
    // 请求回应(无椭可击等)— 看 requestType
    if (atomType === '请求回应') {
      const reqType = pending.atom?.requestType;
      if (reqType === '__弃牌') {
        const p = state.players[target];
        const limit = p.maxHealth;
        const excess = (p.hand?.length || 0) - limit;
        if (excess > 0) {
          const toDiscard = (p.hand || []).slice(-excess).map(c => c.id);
          return { action: { skillId: '系统规则', actionType: 'respond', ownerId: -1, params: { cardIds: toDiscard } }, reason: `P${target}弃${excess}牌` };
        }
        return { action: { skillId: '系统规则', actionType: 'respond', ownerId: -1, params: { cardIds: [] } }, reason: `P${target}弃牌0` };
      }
      // 求桃:有桃就出,没桃发无操作(等超时)
      if (reqType === '求桃') {
        const peach = findCard(state, target, '桃');
        if (peach) {
          return { action: { skillId: '桃', actionType: 'respond', ownerId: target, params: { cardId: peach } }, reason: `P${target}出桃救` };
        }
        // 没桃:发无操作 action 触发超时路径(dispatch 丢弃 → 15s 超时)
        return null; // 不发 action,等超时
      }
      // 遗计分配:把牌全留给自己
      if (reqType === '遗计/distribute') {
        const p = state.players[target];
        const hand = p.hand || [];
        const last2 = hand.slice(-2).map(c => c.id);
        return { action: { skillId: '遗计', actionType: 'respond', ownerId: target, params: { allocation: [{ target, cardIds: last2 }] } }, reason: `P${target}遗计留牌` };
      }
      return { action: { skillId: '无椭可击', actionType: 'respond', ownerId: target, params: {} }, reason: `P${target}不回应(${reqType})` };
    }
    // 弃牌阶段
    const atom = pending.atom;
    if (atom?.requestType === '__弃牌' || atom?.type === '选择询问') {
      const p = state.players[target];
      const limit = p.maxHealth;
      const excess = p.hand.length - limit;
      if (excess > 0) {
        const toDiscard = p.hand.slice(-excess).map(c => c.id);
        return { action: { skillId: '系统规则', actionType: '弃牌', ownerId: target, params: { cardIds: toDiscard } }, reason: `P${target}弃${excess}牌` };
      }
      return { action: { skillId: '系统规则', actionType: '弃牌', ownerId: target, params: { cardIds: [] } }, reason: `P${target}弃牌0` };
    }
    // 未知 pending — 尝试空回应
    return { action: { skillId: '无操作', actionType: 'respond', ownerId: target, params: {} }, reason: `P${target}空回应${atomType}` };
  }

  // 2. 出牌阶段 — 当前玩家行动
  if (state.phase === '出牌' && cur !== null && cur !== undefined) {
    // 优先出杀(每回合只出一次)
    const kill = killDone ? null : findCard(state, cur, '杀');
    if (kill) {
      const targets = state.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== cur && p.alive);
      if (targets.length > 0) {
        return { action: { skillId: '杀', actionType: 'use', ownerId: cur, params: { cardId: kill, targets: [targets[0].i] } }, reason: `P${cur}出杀→P${targets[0].i}` };
      }
    }
    // 没杀→结束回合
    return { action: { skillId: '回合管理', actionType: 'end', ownerId: cur, params: {} }, reason: `P${cur}结束回合` };
  }

  // 3. 其他阶段(摸牌/弃牌/判定等)— 等服务端自动推进
  return null;
}

async function main() {
  console.log(`\n===== ${playerCount}人局 (${maxTurns}回合) =====`);
  const roomId = await createDebugRoom(playerCount);
  console.log(`房间: ${roomId}`);

  const client = new GameClient(roomId);
  await client.connect();
  await sleep(600);

  const s0 = client.state;
  console.log('开局:');
  s0.players.forEach((p, i) => {
    console.log(`  P${i}: ${p.character} HP${p.health}/${p.maxHealth} ${p.hand?.length||0}牌`);
  });

  let turns = 0;
  const log = [];
  let gameOver = false;
  let idleCount = 0;
  let lastSeq = -1;
  let killAttempted = false; // 本回合是否已尝试出杀

  while (turns < maxTurns && !gameOver && !client.closed) {
    const s = client.state;
    if (!s) { await sleep(100); continue; }

    // 游戏结束
    const alive = s.players.filter(p => p.alive);
    if (alive.length <= 1 && s.players.length > 1) {
      console.log(`\n>>> 游戏结束! 存活: ${alive.length === 1 ? 'P' + s.players.indexOf(alive[0]) : '无'}`);
      gameOver = true;
      break;
    }

    // 检测是否卡住(seq 不变 + 无新决策)
    const curSeq = client.lastSeq;
    if (curSeq === lastSeq) {
      idleCount++;
    } else {
      idleCount = 0;
      lastSeq = curSeq;
    }

    // 如果当前玩家变了,重置出杀标记
    const decision = decide(s, killAttempted);
    if (decision) {
      const seqBefore = client.lastSeq;
      log.push({ t: turns, seq: curSeq, ...decision });
      const hp = s.players.map((p, i) => `P${i}:${p.health}`).join(' ');
      const pendInfo = s.pending ? ` [${s.pending.atom?.type}→P${s.pending.target}]` : '';
      if (turns < 50 || turns % 20 === 0) {
        console.log(`[T${turns}] ${decision.reason} | ${hp} | seq=${curSeq}${pendInfo}`);
      }
      client.sendAction(decision.action);
      await sleep(300); // 等 state 更新
      // 检查 action 是否生效
      if (decision.action.actionType === 'use' && decision.action.skillId === '杀') {
        if (client.lastSeq === seqBefore) {
          // 出杀被拒绝(quota 用尽),标记本回合不再出杀
          killAttempted = true;
        } else {
          killAttempted = true; // 成功出杀后也不再用杀
        }
      }
      // 回合切换时重置
      if (s.currentPlayerIndex !== client.state?.currentPlayerIndex) {
        killAttempted = false;
      }
    } else {
      await sleep(150);
    }

    if (idleCount > 120) {
      console.log(`[T${turns}] 连续80轮无变化,中止 (seq=${curSeq} phase=${s.phase} pending=${!!s.pending} atom=${s.pending?.atom?.type} target=${s.pending?.target})`);
      break;
    }
    turns++;
  }

  // 总结
  console.log(`\n===== 总结 =====`);
  console.log(`总轮次: ${turns}, 游戏结束: ${gameOver}`);
  console.log(`错误数: ${client.errors.length}`);
  client.errors.slice(0, 5).forEach(e => console.log(`  ${e}`));
  const finalS = client.state;
  if (finalS) {
    console.log(`最终: ${finalS.players.map((p, i) => `P${i}:${p.health}hp${p.alive ? '' : '(亡)'}`).join(' ')}`);
  }
  console.log(`\n最后15条行动:`);
  log.slice(-15).forEach(a => console.log(`  [T${a.t}] ${a.reason} (seq=${a.seq})`));

  client.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
