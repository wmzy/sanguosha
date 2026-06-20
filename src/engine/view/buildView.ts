// src/engine/view/buildView.ts
import type { ActionPrompt, GameState, GameView, ActionLogEntry, ClientMessage } from '../types';


/** 从 ClientMessage 生成可读日志文本 */
function formatLogEntry(msg: ClientMessage): string {
  const { skillId, actionType, ownerId, params } = msg;
  if (actionType === 'use') {
    const cardId = params.cardId as string | undefined;
    const targets = params.targets as string[] | undefined;
    const targetStr = targets?.length ? ` → ${targets.join(',')}` : '';
    return `${ownerId} 使用 ${skillId}${cardId ? `(${cardId})` : ''}${targetStr}`;
  }
  if (actionType === 'respond') {
    const cardId = params.cardId as string | undefined;
    return cardId ? `${ownerId} 响应 ${cardId}` : `${ownerId} 不响应`;
  }
  if (actionType === 'start') return `${ownerId} 开始游戏`;
  if (actionType === 'end') return `${ownerId} 结束回合`;
  return `${ownerId} ${skillId}:${actionType}`;
}

export function buildView(state: GameState, viewer: number, debug = false): GameView {
  // 构建日志(最近50条)
  const log: GameView['log'] = state.actionLog.slice(-50).map((e: ActionLogEntry) => ({
    time: e.timestamp,
    player: e.message.ownerId,
    text: formatLogEntry(e.message),
  }));

  // 从 GameState.pendingSlots 构建 pending view。
  // 多 target 并行(拼点/选将)时,每个 viewer 只看到自己的 slot;
  // 单 target 场景 Map 只有1个 slot。
  let pending: GameView['pending'] = null;
  // 优先取 viewer 专属 slot;其次取广播 slot(target<0,如无辨可击全桌可见);最后取唯一 slot
  const mySlot = viewer >= 0 ? state.pendingSlots.get(viewer) : undefined;
  const broadcastSlot = [...state.pendingSlots.values()].find(s => {
    const t = (s.atom as { target?: unknown }).target;
    return typeof t === 'number' && t < 0;
  });
  const slot = mySlot ?? broadcastSlot ?? (state.pendingSlots.size === 1 ? [...state.pendingSlots.values()][0] : undefined);
  if (slot) {
    const def = slot.definition;
    const prompt = (slot.atom as { prompt?: ActionPrompt }).prompt
      ?? def.pending?.prompt
      ?? (slot.atom.type === '询问闪'
        ? { type: 'useCard' as const, title: '请出闪', cardFilter: { min: 1, max: 1 } }
        : slot.atom.type === '询问杀'
        ? { type: 'useCard' as const, title: '请出杀', cardFilter: { min: 1, max: 1 } }
        : { type: 'confirm' as const, title: '请回应' });
    const target = 'target' in slot.atom && typeof slot.atom.target === 'number'
      ? slot.atom.target
      : -1;
    pending = {
      type: 'awaits',
      atom: slot.atom,
      prompt,
      target,
      // slot.deadline 是相对开局时间 (Date.now() - state.startedAt + timeoutMs),
      // 前端用 (deadline - Date.now()) / 1000 算剩余秒数,需要绝对时间戳。
      deadline: state.startedAt + slot.deadline,
      // totalMs = slot 的 timeout 秒数 * 1000, 前端进度条用
      // 回退到 def.pending.timeout —— 与 createAndAwaitSlot 的实际定时器口径一致
      totalMs: ((slot.atom as { timeout?: number }).timeout ?? def.pending?.timeout ?? 30) * 1000,
    };
  }

  // 出牌/弃牌阶段:独立的 turnDeadline(不创建 fake pending)
  let turnDeadline: number | null = null;
  if (state.phase === '出牌' || state.phase === '弃牌') {
    turnDeadline = Date.now() + 60_000;
  }

  // debug 模式:收集所有并行选将 slot,供单客户端代打时切换视角帮其他玩家选将。
  // 正式模式不填充(viewer 隔离:只看自己的 pending)。
  let allCharSelectSlots: GameView['allCharSelectSlots'];
  if (debug) {
    const selectSlots = [...state.pendingSlots.values()].filter(s => s.atom.type === '选将询问');
    if (selectSlots.length > 1) {
      allCharSelectSlots = selectSlots.map(s => {
        const def = s.definition;
        const prompt = (s.atom as { prompt?: ActionPrompt }).prompt
          ?? def.pending?.prompt
          ?? { type: 'chooseCharacter' as const, title: '请选择武将', candidates: [] };
        const t = 'target' in s.atom && typeof s.atom.target === 'number' ? s.atom.target : -1;
        return {
          type: 'awaits' as const,
          atom: s.atom,
          prompt,
          target: t,
          deadline: state.startedAt + s.deadline,
          totalMs: ((s.atom as { timeout?: number }).timeout ?? def.pending?.timeout ?? 60) * 1000,
        };
      });
    }
  }

  return {
    viewer,
    currentPlayerIndex: state.currentPlayerIndex,
    phase: state.phase,
    turn: state.turn,
    players: state.players.map((p, i) => ({
      index: i,
      name: p.name,
      character: p.character,
      faction: p.faction,
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      equipment: p.equipment,
      skills: p.skills,
      handCount: p.hand.length,
      hand: (i === viewer || debug) ? p.hand.map(id => state.cardMap[id]).filter(Boolean) : undefined,
      marks: p.marks,
      // 距离修正 vars(只投影距离相关三个 key,不暴露身份等敏感 vars)
      distanceVars: {
        attackMod: p.vars['距离/进攻修正'] as number | undefined,
        defenseMod: p.vars['距离/防御修正'] as number | undefined,
        attackRange: p.vars['距离/出杀范围'] as number | undefined,
      },
      // 判定区:延时锦囊的 cardId 列表(乐不思蜀/闪电/兵粮寸断)
      pendingTricks: p.pendingTricks.map(t => t.card.id),
      ...(() => {
        const rawIdentity = p.vars['身份'] as string | undefined;
        if (!rawIdentity) return { identity: undefined, identityHidden: false };
        // 自己:可见(debug 模式全部暴露,前端按 perspectiveIdx 隐藏)
        if (i === viewer || debug) return { identity: rawIdentity, identityHidden: false };
        // 主公:公开
        if (rawIdentity === '主公') return { identity: rawIdentity, identityHidden: false };
        // 死亡:揭示
        if (!p.alive) return { identity: rawIdentity, identityHidden: false };
        // 其他玩家:隐藏
        return { identity: undefined, identityHidden: true };
      })(),
    })),
    cardMap: state.cardMap,
    pending,
    allCharSelectSlots,
    turnDeadline,
    log,
    zones: {
      deckCount: state.zones.deck.length,
      discardPileCount: state.zones.discardPile.length,
      // 处理区:判定牌 / 中间结算的卡(闪抵消杀等)
      processing: [...state.zones.processing],
    },
  };
}