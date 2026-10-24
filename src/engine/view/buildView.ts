// src/engine/view/buildView.ts
// src/engine/view/buildView.ts
import type { GameState, GameView, ActionLogEntry, ClientMessage, Json } from '../types';
import { projectVisiblePending } from './pending';
import { getDistanceAttackMod, getDistanceDefenseMod, getDistanceAttackRange } from '../rules/vars-keys';

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

  const pending = projectVisiblePending(state, viewer);

  // deadline 来自 pending slot 的超时(出牌阶段的 __出牌 询问、询问闪/弃牌等)。
  // 无 pending 时为 null(没有倒计时)。
  const deadline = pending?.deadline ?? null;
  const deadlineTotalMs = pending?.totalMs ?? 0;

  return {
    viewer,
    currentPlayerIndex: state.currentPlayerIndex,
    phase: state.phase,
    turn: state.turn,
    players: state.players.map((p, i) => {
      // 选将保密:选将进行中,非本人视角不投影角色/势力/技能(名字投影昵称);
      // 选将结束由 亮将 原子统一公开。debug 视角不受限。
      const hideChar = state.charSelecting === true && !debug && i !== viewer;
      return {
      // 名牌回退链 nickname→name:nickname 只在 分配武将.apply 时写入,分配前的
      // 窗口内 undefined——直接投影空串会让他人/旁观视角名牌全空(CharSelectWaitingOverlay
      // 拼出「、、、、正在选将」)。回退 p.name 无泄漏:分配前 name 仍是原昵称
      // (分配武将 apply 才覆写为武将名并留存 nickname);分配后 nickname 已留存,
      // 优先取昵称,武将名不会经 name 通道泄漏(角色保密由 character/skills 红化控制)。
      index: i,
      name: hideChar ? (p.nickname ?? p.name) : p.name,
      character: hideChar ? '' : p.character,
      faction: hideChar ? undefined : p.faction,
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      equipment: { ...p.equipment },
      skills: hideChar ? [] : [...p.skills],
      handCount: p.hand.length,
      hand: (i === viewer || debug) ? p.hand.map((id) => state.cardMap[id]).filter(Boolean) : undefined,
      marks: [...p.marks],
      tags: [...p.tags],
      // 距离修正 vars(只投影距离相关三个 key,不暴露身份等敏感 vars)
      distanceVars: {
        attackMod: getDistanceAttackMod(p.vars),
        defenseMod: getDistanceDefenseMod(p.vars),
        attackRange: getDistanceAttackRange(p.vars),
      },
      // 回合用量仅来自显式「回合用量」atom 的 state 镜像。
      // 镜像按玩家归属存储，支持他人回合中的强制用牌；不再从 player.vars
      // 自动投影 /usedThisTurn 等内部门控标记。
      turnUsage: Object.fromEntries(
        Object.entries(state.turn.vars)
          .map(([k, v]) => {
            const prefix = `__view/${i}/`;
            return k.startsWith(prefix) ? [k.slice(prefix.length), v] : null;
          })
          .filter((entry): entry is [string, Json] => entry !== null),
      ),
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
      };
    }),
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
      // 无帧上下文的判定/拼点/respond 打出会落到 state.zones.processing(帧栈为空时的暂存区,
      // 见 移动牌/判定/拼点扣置 的 frame ? frame.cards : zones.processing 分支),同样属于处理区,
      // 必须一并投影——否则前端 view.zones.processing 有这张牌、buildView 没有(视图漂移)。
      processing: [
        ...state.zones.processing,
        ...state.settlementStack.flatMap((f) => f.cards),
      ],
    },
    settlementStack: state.settlementStack.map((f) => ({
      skillId: f.skillId,
      from: f.from,
      params: { ...f.params },
      cards: [...f.cards],
      cancelled: f.cancelled,
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
  const pending = projectVisiblePending(state, viewer);
  return pending?.deadline !== undefined && pending.totalMs !== undefined
    ? { target: pending.target, deadline: pending.deadline, totalMs: pending.totalMs }
    : null;
}
