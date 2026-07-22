// src/engine/view/buildView.ts
// src/engine/view/buildView.ts
import type { ActionPrompt, GameState, GameView, ActionLogEntry, ClientMessage } from '../types';
import { TARGET_SYSTEM, TARGET_BROADCAST } from '../types';
import { resolveChoosePlayerCandidates } from './choosePlayerCandidates';

/** 从 ClientMessage 生成可读日志文本(不含玩家名——player 字段单独携带,由展示层映射) */
export function formatLogEntry(msg: ClientMessage): string {
  const { skillId, actionType, params } = msg;
  if (actionType === 'use') {
    const cardId = params.cardId as string | undefined;
    const targets = params.targets as string[] | undefined;
    const targetStr = targets?.length ? ` → ${targets.join(',')}` : '';
    return `使用 ${skillId}${cardId ? `(${cardId})` : ''}${targetStr}`;
  }
  if (actionType === 'respond') {
    const cardId = params.cardId as string | undefined;
    return cardId ? `响应 ${cardId}` : '不响应';
  }
  if (actionType === 'start') return '开始游戏';
  if (actionType === 'end') return '结束回合';
  return `${skillId}:${actionType}`;
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
  // 优先匹配 viewer 专属 slot,其次广播型 slot(target === TARGET_BROADCAST)。
  // 不使用 findPendingSlot 的 size===1 fallback —— 那会让主公选将期间(单 slot)
  // 的其他 viewer 错误匹配到主公 slot,导致"共用倒计时":其他角色看到主公的
  // 选将 atom/deadline/target,前端据此渲染主公的选将界面和倒计时。
  let ownOrBroadcastSlot =
    viewer >= 0
      ? (state.pendingSlots.get(viewer) ??
        [...state.pendingSlots.values()].find(
          (s) =>
            (s.atom as { target?: number }).target === TARGET_BROADCAST &&
            !s.isPaused,
        ))
      : undefined;
  // viewer 专属 slot 若已 pause(respond execute 内部创建了新 pending),
  // 不应再返回它——交给 observer 逻辑接管,与增量视图对齐。
  if (ownOrBroadcastSlot?.isPaused) {
    ownOrBroadcastSlot = undefined;
  }
  if (ownOrBroadcastSlot) {
    const slot = ownOrBroadcastSlot;
    const def = slot.definition;
    const rawPrompt =
      (slot.atom as { prompt?: ActionPrompt }).prompt ??
      def.pending?.prompt ??
      (slot.atom.type === '询问闪'
        ? { type: 'useCard' as const, title: '请出闪', cardFilter: { min: 1, max: 1 } }
        : slot.atom.type === '询问杀'
          ? { type: 'useCard' as const, title: '请出杀', cardFilter: { min: 1, max: 1 } }
          : { type: 'confirm' as const, title: '请回应' });
    // choosePlayer 注入可序列化 candidates(filter 无法跨进程序列化)
    const prompt = resolveChoosePlayerCandidates(rawPrompt, state);
    // target 提取:'target' 字段优先;出牌窗口 用 'player';都无则 TARGET_SYSTEM
    const target =
      'target' in slot.atom && typeof slot.atom.target === 'number'
        ? slot.atom.target
        : 'player' in slot.atom && typeof slot.atom.player === 'number'
          ? (slot.atom as { player: number }).player
          : TARGET_SYSTEM;
    pending = {
      type: 'awaits',
      atom: slot.atom,
      prompt,
      target,
      isBlocking: slot.isBlocking,
      // slot.deadline 是相对开局时间 (Date.now() - state.startedAt + timeoutMs),
      // 前端用 (deadline - Date.now()) / 1000 算剩余秒数,需要绝对时间戳。
      deadline: state.startedAt + slot.deadline,
      // totalMs = slot 的 timeout 秒数 * 1000, 前端进度条用
      // 回退到 def.pending.timeout —— 与 createAndAwaitSlot 的实际定时器口径一致
      totalMs: ((slot.atom as { timeout?: number }).timeout ?? def.pending?.timeout ?? 30) * 1000,
    };
  } else {
    // 观察型 pending:当前 viewer 既无自己的 slot 也无广播 slot,但场上存在其他
    // 玩家的 pending slot(真实玩家 target>=0)。与事件流 applyView(询问闪/询问杀/
    // 请求回应 对非 target viewer 设观察型 pending)对齐:让初始视图/重连视图也能
    // 看到"某人在被询问",供视角自动跟随。
    // 不渲染可操作 prompt(仅给 target 供跟随),避免"共用倒计时"误导。
    // 仅限游戏进行中的问询类 atom —— 选将询问/选将 等开局 atom 的 pending 是
    // 隔离的(只有被问询者见),不应观察型投影(charselect-pending-isolation 契约)。
    // viewer<0(旁观者)也需 observer pending 以获知"当前在等谁操作"。
    const OBSERVER_PENDING_TYPES = new Set([
      '询问闪', '询问杀', '请求回应', '出牌窗口',
      ...(debug ? ['选将询问', '选将'] : []),
    ]);
    const observerSlot = [...state.pendingSlots.values()].find((s) => {
      // target 字段优先;出牌窗口用 player
      const t =
        (s.atom as { target?: number; player?: number }).target ??
        (s.atom as { player?: number }).player;
      return (
        typeof t === 'number' && t >= 0 && t !== viewer && OBSERVER_PENDING_TYPES.has(s.atom.type)
      );
    });
    if (observerSlot) {
      const slot = observerSlot;
      const target =
        (slot.atom as { target?: number; player?: number }).target ??
        (slot.atom as { player: number }).player;
      pending = {
        type: 'awaits',
        atom: slot.atom,
        prompt: { type: 'confirm', title: '等待回应', cancelLabel: '' },
        target,
        isBlocking: slot.isBlocking,
        deadline: state.startedAt + slot.deadline,
        totalMs:
          ((slot.atom as { timeout?: number }).timeout ?? slot.definition.pending?.timeout ?? 30) *
          1000,
      };
    }
  }

  // deadline 来自 pending slot 的超时(出牌阶段的 __出牌 询问、询问闪/弃牌等)。
  // 无 pending 时为 null(没有倒计时)。
  const deadline = pending?.deadline ?? null;
  const deadlineTotalMs = pending?.totalMs ?? 0;

  // debug 参数已在 hand 可见性和 OBSERVER_PENDING_TYPES 中使用

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
      hand: (i === viewer || debug) ? p.hand.map((id) => state.cardMap[id]).filter(Boolean) : undefined,
      marks: [...p.marks],
      // 距离修正 vars(只投影距离相关三个 key,不暴露身份等敏感 vars)
      distanceVars: {
        attackMod: p.vars['距离/进攻修正'] as number | undefined,
        defenseMod: p.vars['距离/防御修正'] as number | undefined,
        attackRange: p.vars['距离/出杀范围'] as number | undefined,
      },
      // 本回合用量(出杀计数 + 限一次标记)的 view 投影。
      // baseline/重连时从此处初值;运行期由「回合用量」atom applyView 增量维护。
      turnUsage: {
        ...(typeof state.turn.vars['杀/usedCount'] === 'number'
          ? { '杀/usedCount': state.turn.vars['杀/usedCount'] }
          : {}),
        ...Object.fromEntries(
          Object.entries(p.vars).filter(([k, v]) => k.endsWith('/usedThisTurn') && v),
        ),
      },
      // 判定区:延时锦囊的 cardId 列表(乐不思蜀/闪电/兵粮寸断)
      pendingTricks: p.pendingTricks.map((t) => t.card.id),
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
    deadline,
    /** deadline 对应的倒计时总时长(ms);deadline 为 null 时无意义 */
    deadlineTotalMs,
    log,
    zones: {
      deckCount: state.zones.deck.length,
      discardPileCount: state.zones.discardPile.length,
      // 结算区:所有结算帧的牌聚合(供 ZoneInfoBar 展示)。真相源是 settlementStack 的各帧 cards。
      processing: state.settlementStack.flatMap((f) => f.cards),
    },
    settlementStack: state.settlementStack.map((f) => ({
      skillId: f.skillId,
      from: f.from,
      params: { ...f.params },
      cards: [...f.cards],
    })),
  };
}

/** 读取指定 viewer 可见 pending slot 的 deadline/totalMs(供 session 广播 event 时附加倒计时)。
 *  与 buildView 内部 pending 构建逻辑同源:优先 viewer 专属 slot,其次广播型 slot(target===TARGET_BROADCAST)。
 *  无 pending 返回 null。 */
export function getPendingDeadline(
  state: GameState,
  viewer: number,
): { target: number; deadline: number; totalMs: number } | null {
  const slot =
    viewer >= 0
      ? (state.pendingSlots.get(viewer) ??
        [...state.pendingSlots.values()].find(
          (s) => (s.atom as { target?: number }).target === TARGET_BROADCAST,
        ))
      : undefined;
  if (!slot) return null;
  const def = slot.definition;
  const target =
    'target' in slot.atom && typeof slot.atom.target === 'number'
      ? slot.atom.target
      : 'player' in slot.atom && typeof slot.atom.player === 'number'
        ? (slot.atom as { player: number }).player
        : TARGET_SYSTEM;
  const timeoutSec = (slot.atom as { timeout?: number }).timeout ?? def.pending?.timeout ?? 30;
  return {
    target,
    deadline: state.startedAt + slot.deadline,
    totalMs: timeoutSec * 1000,
  };
}
