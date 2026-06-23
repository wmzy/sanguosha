// src/engine/view/buildView.ts
import type { ActionPrompt, GameState, GameView, ActionLogEntry, ClientMessage, PendingSlot } from '../types';
import { TARGET_SYSTEM, TARGET_BROADCAST } from '../types';

/** 出牌/弃牌阶段的回合空闲超时(ms)。
 *  服务端 resetIdleTimer 与此处 turnDeadline 必须使用同一口径——
 *  否则前端倒计时与实际超时不一致(表现为进度条未走完回合就被结束)。 */
export const TURN_IDLE_TIMEOUT_MS = 50_000;


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
  // 只匹配 viewer 专属 slot 或广播型 slot(target === TARGET_BROADCAST)。
  // 不使用 findPendingSlot 的 size===1 fallback —— 那会让主公选将期间(单 slot)
  // 的其他 viewer 错误匹配到主公 slot,导致"共用倒计时":其他角色看到主公的
  // 选将 atom/deadline/target,前端据此渲染主公的选将界面和倒计时。
  const slot = viewer >= 0
    ? (state.pendingSlots.get(viewer)
        ?? [...state.pendingSlots.values()].find(s =>
            (s.atom as { target?: number }).target === TARGET_BROADCAST))
    : undefined;
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
      : TARGET_SYSTEM;
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

  // 出牌/弃牌阶段:独立的 turnDeadline(不创建 fake pending)。
  // 与服务端 resetIdleTimer 使用同一 TURN_IDLE_TIMEOUT_MS 口径,避免倒计时与实际超时偏差。
  let turnDeadline: number | null = null;
  let turnTotalMs = 0;
  if (state.phase === '出牌' || state.phase === '弃牌') {
    turnDeadline = Date.now() + TURN_IDLE_TIMEOUT_MS;
    turnTotalMs = TURN_IDLE_TIMEOUT_MS;
  }

  void debug;  // 保留参数签名兼容调用点,但不再影响隔离逻辑

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
      equipment: { ...p.equipment },
      skills: [...p.skills],
      handCount: p.hand.length,
      hand: i === viewer ? p.hand.map(id => state.cardMap[id]).filter(Boolean) : undefined,
      marks: [...p.marks],
      // 距离修正 vars(只投影距离相关三个 key,不暴露身份等敏感 vars)
      distanceVars: {
        attackMod: p.vars['距离/进攻修正'] as number | undefined,
        defenseMod: p.vars['距离/防御修正'] as number | undefined,
        attackRange: p.vars['距离/出杀范围'] as number | undefined,
      },
      // 判定区:延时锦囊的 cardId 列表(乐不思蜀/闪电/兵粮寸断)
      pendingTricks: p.pendingTricks.map(t => t.card.id),
      ...(() => {
        const rawIdentity = p.identity;
        if (!rawIdentity) return { identity: undefined, identityHidden: false };
        // 自己:可见
        if (i === viewer) return { identity: rawIdentity, identityHidden: false };
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
    /** 出牌/弃牌阶段倒计时总时长;为 0 表示非出牌/弃牌阶段(无 turnDeadline) */
    turnTotalMs,
    log,
    zones: {
      deckCount: state.zones.deck.length,
      discardPileCount: state.zones.discardPile.length,
      // 处理区:判定牌 / 中间结算的卡(闪抵消杀等)
      processing: [...state.zones.processing],
    },
  };
}