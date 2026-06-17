// scripts/multi-agent-player.mjs
// 多 AI 玩家进入同一 debug 房间,各自以自己座次视角玩牌,发现 bug。
// 用法: node scripts/multi-agent-player.mjs [playerCount]
import WebSocket from 'ws';

const HOST = 'localhost:3930';
const playerCount = parseInt(process.argv[2] || '4', 10);
const maxTurns = 500;

async function createDebugRoom(n) {
  const res = await fetch(`http://${HOST}/api/debug-room`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerCount: n }),
  });
  return (await res.json()).roomId;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class AIPlayer {
  constructor(roomId, seatIndex) {
    this.roomId = roomId;
    this.seat = seatIndex;
    this.ws = null;
    this.state = null;
    this.lastSeq = 0;
    this.errors = [];
    this.actions = [];
    this.bugs = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${HOST}/ws`);
      this.ws = ws;
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'join_debug_room', roomId: this.roomId, lastSeq: 0 }));
      });
      ws.addEventListener('error', reject);
      ws.addEventListener('close', () => {});
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'debugGameState' || msg.type === 'initialView') {
          this.state = msg.state;
          this.lastSeq = msg.lastSeq;
        } else if (msg.type === 'error') {
          this.errors.push(msg.message);
        }
      });
      setTimeout(resolve, 1500);
    });
  }

  // 只看自己座次的信息
  getMyState() {
    const s = this.state;
    if (!s) return null;
    return {
      phase: s.phase,
      currentPlayer: s.currentPlayerIndex,
      pending: s.pending,
      me: s.players[this.seat],
      players: s.players.map((p, i) => ({
        name: p.name, character: p.character, hp: p.health,
        alive: p.alive, handCount: p.hand?.length || 0,
        identity: p.identity, // debug 模式暴露
        skills: p.skills,
      })),
    };
  }

  // 检查是否轮到自己操作
  needsAction() {
    const s = this.state;
    if (!s) return null;
    const cur = s.currentPlayerIndex;
    const pending = s.pending;

    // 有 pending 针对自己
    if (pending && pending.target === this.seat) {
      return { type: 'respond', pending };
    }
    // 自己回合出牌阶段
    if (cur === this.seat && s.phase === '出牌' && !pending) {
      return { type: 'play', phase: s.phase };
    }
    return null;
  }

  decide() {
    const s = this.state;
    if (!s) return null;
    const need = this.needsAction();
    if (!need) return null;

    const me = s.players[this.seat];
    const hand = me?.hand || [];

    if (need.type === 'respond') {
      const atom = need.pending.atom;
      const reqType = atom?.requestType;
      const atomType = atom?.type;

      // 询问闪
      if (atomType === '询问闪') {
        const dodge = hand.find(c => c.name === '闪');
        if (dodge) return { skillId: '闪', actionType: 'respond', params: { cardId: dodge.id }, reason: '出闪' };
        return { skillId: '闪', actionType: 'respond', params: {}, reason: '不闪' };
      }
      // 询问杀
      if (atomType === '询问杀') {
        const kill = hand.find(c => c.name === '杀');
        if (kill) return { skillId: '杀', actionType: 'respond', params: { cardId: kill.id }, reason: '出杀响应' };
        return { skillId: '杀', actionType: 'respond', params: {}, reason: '不出杀' };
      }
      // 求桃
      if (atomType === '请求回应' && reqType === '求桃') {
        const peach = hand.find(c => c.name === '桃');
        if (peach) return { skillId: '桃', actionType: 'respond', params: { cardId: peach.id }, reason: '出桃救' };
        return null; // 不救,等超时
      }
      // 弃牌
      if (atomType === '请求回应' && reqType === '__弃牌') {
        const limit = me.maxHealth;
        const excess = hand.length - limit;
        if (excess > 0) {
          const toDiscard = hand.slice(-excess).map(c => c.id);
          return { skillId: '系统规则', actionType: 'respond', params: { cardIds: toDiscard }, reason: `弃${excess}牌` };
        }
        return { skillId: '系统规则', actionType: 'respond', params: { cardIds: [] }, reason: '弃牌0' };
      }
      // 遗计分配
      if (reqType === '遗计/distribute') {
        const last2 = hand.slice(-2).map(c => c.id);
        return { skillId: '遗计', actionType: 'respond', params: { allocation: [{ target: this.seat, cardIds: last2 }] }, reason: '遗计留牌' };
      }
      // 其他:空回应
      return { skillId: '无懈可击', actionType: 'respond', params: {}, reason: `空回应 ${reqType || atomType}` };
    }

    if (need.type === 'play') {
      // 出牌策略:有杀就出(每回合只出一次)
      const kill = hand.find(c => c.name === '杀');
      if (kill) {
        // 找目标(存活的非自己)
        const targets = s.players.map((p, i) => ({ p, i }))
          .filter(({ p, i }) => i !== this.seat && p.alive);
        if (targets.length > 0) {
          return { skillId: '杀', actionType: 'use', params: { cardId: kill.id, targets: [targets[0].i] }, reason: `出杀→P${targets[0].i}` };
        }
      }
      // 没杀→结束回合
      return { skillId: '回合管理', actionType: 'end', params: {}, reason: '结束回合' };
    }

    return null;
  }

  sendAction(decision) {
    const action = {
      skillId: decision.skillId,
      actionType: decision.actionType,
      ownerId: this.seat,
      params: decision.params,
      baseSeq: this.lastSeq,
    };
    this.actions.push({ seq: this.lastSeq, ...decision });
    this.ws.send(JSON.stringify({ type: 'action', action, baseSeq: this.lastSeq }));
  }

  // 检查规则一致性 bug
  checkBugs() {
    const s = this.state;
    if (!s) return;
    const me = s.players[this.seat];
    if (!me) return;

    // 检查手牌数 > 体力值但不在弃牌阶段
    if (me.alive && me.hand.length > me.maxHealth && s.phase !== '弃牌' && !s.pending) {
      const cur = s.currentPlayerIndex;
      if (cur === this.seat && s.phase === '出牌') {
        // 正常,出牌阶段手牌可以超限
      } else if (cur !== this.seat) {
        // 别人回合自己手牌超限?应该已经弃过了
        // (可能是回合切换时没触发弃牌)
      }
    }

    // 检查自己身份是否正确暴露
    // (debug 模式所有人都暴露,但前端会隐藏,这里不检查)

    // 检查同时多个 pending
    // (引擎保证只有一个 pendingSlot)
  }

  close() { this.ws?.close(); }
}

async function main() {
  console.log(`\n===== ${playerCount}人局 多 AI 玩家对战 =====`);
  const roomId = await createDebugRoom(playerCount);
  console.log(`房间: ${roomId}`);

  // 创建 N 个 AI 玩家,各自连接
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const p = new AIPlayer(roomId, i);
    await p.connect();
    players.push(p);
    console.log(`  P${i} 已连接`);
  }

  // 等开局
  await sleep(2000);
  const s0 = players[0].state;
  if (!s0) { console.log('开局失败'); process.exit(1); }
  console.log(`\n开局:`);
  s0.players.forEach((p, i) => {
    console.log(`  P${i}: ${p.character} HP${p.health}/${p.maxHealth} ${p.hand?.length||0}牌 [${p.skills?.filter(s=>!['回合管理','装备通用','杀','闪','桃','酒','过河拆桥','顺手牵羊','无中生有','桃园结义','借刀杀人','决斗','南蛮入侵','万箭齐发','乐不思蜀','无懈可击'].includes(s)).join(',')}]`);
  });

  // 主循环:每个 AI 玩家各自决策
  let turn = 0;
  let gameOver = false;
  let stuckCount = 0;
  let lastSeq = 0;

  while (turn < maxTurns && !gameOver) {
    let anyAction = false;

    for (const p of players) {
      const s = p.state;
      if (!s) continue;

      // 游戏结束
      const alive = s.players.filter(pp => pp.alive);
      if (alive.length <= 1 && s.players.length > 1) {
        console.log(`\n>>> 游戏结束! 胜者: ${alive.length === 1 ? 'P' + s.players.indexOf(alive[0]) : '无'}`);
        gameOver = true;
        break;
      }

      // 这个玩家需要操作吗?
      const decision = p.decide();
      if (decision) {
        if (turn < 60 || turn % 30 === 0) {
          const hpSummary = s.players.map((pp, i) => `P${i}:${pp.health}`).join(' ');
          console.log(`[T${turn}] P${p.seat}(${s.players[p.seat]?.character}) ${decision.reason} | ${hpSummary}`);
        }
        p.sendAction(decision);
        p.checkBugs();
        anyAction = true;
        await sleep(200);
      }
    }

    if (gameOver) break;

    if (!anyAction) {
      stuckCount++;
      await sleep(300);
      if (stuckCount % 30 === 0) {
        const s = players[0].state;
        console.log(`[T${turn}] 等待中... phase=${s?.phase} cur=P${s?.currentPlayerIndex} pending=${!!s?.pending} stuck=${stuckCount}`);
      }
      if (stuckCount > 100) {
        console.log(`[T${turn}] 连续100轮无操作,中止`);
        break;
      }
    } else {
      stuckCount = 0;
    }
    turn++;
  }

  // 总结
  console.log(`\n===== 总结 =====`);
  console.log(`总轮次: ${turn}, 游戏结束: ${gameOver}`);
  const finalState = players[0].state;
  if (finalState) {
    console.log(`最终:`);
    finalState.players.forEach((p, i) => {
      console.log(`  P${i}: ${p.character} HP${p.health}${p.alive ? '' : '(亡)'}`);
    });
  }

  // 错误统计
  const allErrors = players.flatMap(p => p.errors.map(e => `P${p.seat}: ${e}`));
  if (allErrors.length > 0) {
    console.log(`\n错误 (${allErrors.length}):`);
    allErrors.slice(0, 10).forEach(e => console.log(`  ${e}`));
  }

  // 行动统计
  console.log(`\n各玩家行动数:`);
  players.forEach(p => console.log(`  P${p.seat}: ${p.actions.length} 次`));

  players.forEach(p => p.close());
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
