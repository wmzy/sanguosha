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

  // 从 GameState.pendingSlot 构建 pending view
  let pending: GameView['pending'] = null;
  if (state.pendingSlot) {
    const slot = state.pendingSlot;
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
    };
  }

  // 出牌/弃牌阶段:独立的 turnDeadline(不创建 fake pending)
  let turnDeadline: number | null = null;
  if (state.phase === '出牌' || state.phase === '弃牌') {
    turnDeadline = Date.now() + 60_000;
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
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      equipment: p.equipment,
      skills: p.skills,
      handCount: p.hand.length,
      hand: (i === viewer || debug) ? p.hand.map(id => state.cardMap[id]).filter(Boolean) : undefined,
      marks: p.marks,
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
    turnDeadline,
    log,
  };
}