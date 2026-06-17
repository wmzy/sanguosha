// src/engine/view/buildView.ts
import type { GameState, GameView, ActionLogEntry, ClientMessage } from '../types';


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
    const prompt = def.pending?.prompt
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
      deadline: slot.deadline,
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
      identity: p.vars['身份'] as string | undefined,
    })),
    cardMap: state.cardMap,
    pending,
    turnDeadline,
    log,
  };
}