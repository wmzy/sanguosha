// src/engine/view/buildView.ts
// src/engine/view/buildView.ts
import type { GameState, GameView, ActionLogEntry, ClientMessage, Json, Card } from '../types';
import { projectVisiblePending } from './pending';
import { getDistanceAttackMod, getDistanceDefenseMod, getDistanceAttackRange } from '../rules/vars-keys';

/** 日志格式化上下文:把内部 cardId / 座次号翻译成玩家可读文本。
 *  省略时退化为只靠 cardId 自身解析(兼容旧调用/测试)。 */
export interface LogEntryContext {
  cardMap?: Record<string, Card>;
  /** 座次 → 展示名(通常是角色名);查不到时回退 P{idx}。 */
  resolveName?: (index: number) => string | undefined;
}

const CARD_ID_PATTERN = /^(.+?)-([♠♥♣♦][0-9JQKA]+)(?:-\d+)?$/u;

/** 从内部 cardId 提取 (牌名, 花色点数)。
 *  支持普通 id「杀-♣6-92」、影子卡「杀-♣6-92#武圣」与无 id 的纯牌名。
 *  返回 null 表示无法识别(调用方原样展示)。 */
function parseCardId(
  rawId: string,
  cardMap?: Record<string, Card>,
): { name: string; badge?: string } | null {
  const id = rawId.split('#')[0];
  const card = cardMap?.[rawId] ?? cardMap?.[id];
  if (card) return { name: card.name, badge: `${card.suit}${card.rank}` };
  const m = CARD_ID_PATTERN.exec(id);
  if (m) return { name: m[1], badge: m[2] };
  if (/^[\u4e00-\u9fa5]+$/.test(id)) return { name: id };
  return null;
}

/** 牌面文本:【杀】/【杀】(♣6)。装备通用等取实际牌名,不暴露内部实例 id。 */
function cardText(cardId: unknown, ctx: LogEntryContext): string | null {
  if (typeof cardId !== 'string' || !cardId) return null;
  const parsed = parseCardId(cardId, ctx.cardMap);
  if (!parsed) return `【${cardId}】`;
  return `【${parsed.name}】${parsed.badge ? `(${parsed.badge})` : ''}`;
}

/** 目标列表:座次号 → 名字,用「、」连接;负数/未知回退 P{n}。 */
function targetText(targets: unknown, ctx: LogEntryContext): string {
  if (!Array.isArray(targets) || targets.length === 0) return '';
  const names = targets.map((t) => {
    const idx = typeof t === 'number' ? t : Number(t);
    if (!Number.isFinite(idx)) return String(t);
    return ctx.resolveName?.(idx) ?? `P${idx}`;
  });
  return ` → ${names.join('、')}`;
}

/** 从 ClientMessage 生成可读日志文本(不含玩家名——player 字段单独携带,由展示层映射)。
 *  所有面向玩家的日志都必须走这里:绝不输出内部 cardId / 座次下标 / __skip 等实现词。 */
export function formatLogEntry(msg: ClientMessage, ctx: LogEntryContext = {}): string {
  const { skillId, actionType, params } = msg;
  if (actionType === 'use') {
    const card = cardText(params.cardId, ctx);
    // 装备通用/转化技的 skillId 是抽象类别,实际牌名在 cardId 里;普通牌两者同名。
    const label = card ?? `【${skillId}】`;
    // 普通牌/技能用 targets[];延时锦囊用单数 target。两种 wire 形状都要显示目标。
    const targets = Array.isArray(params.targets)
      ? params.targets
      : params.target !== undefined
        ? [params.target]
        : undefined;
    return `使用${label}${targetText(targets, ctx)}`;
  }
  if (actionType === 'respond') {
    const card = cardText(params.cardId, ctx);
    return card ? `响应${card}` : '不响应';
  }
  if (actionType === 'start') return '开始游戏';
  if (actionType === 'end') return '结束回合';
  if (actionType === 'skip' || skillId === '__skip') return '跳过';
  if (actionType === 'selectChar' || actionType === '选将') return '完成选将';
  if (actionType === '设置手牌顺序') return '调整手牌顺序';
  if (actionType === 'discard' || actionType === '弃牌') {
    const ids = Array.isArray(params.cardIds) ? params.cardIds : [];
    const cards = ids.map((id) => cardText(id, ctx)).filter(Boolean).join('、');
    return cards ? `弃置${cards}` : '弃置';
  }
  // 兜底:业务技能名 + 动作,不暴露原始 actionType 实现词。
  if (skillId.startsWith('__')) return '跳过';
  return `${skillId}`;
}

export function buildView(state: GameState, viewer: number, debug = false): GameView {
  // 构建日志(最近50条)
  const resolveName = (idx: number): string | undefined => state.players[idx]?.name;
  // 自动跳过(__skip)是一次点击就能产生多条的系统噪声(每张可选牌一条),
  // 不进玩家日志;人工「放弃回应」仍保留为「跳过」。
  const log: GameView['log'] = state.actionLog
    .filter((e: ActionLogEntry) => e.message.skillId !== '__skip')
    .slice(-50)
    .map((e: ActionLogEntry) => ({
      time: e.timestamp,
      player: e.message.ownerId,
      text: formatLogEntry(e.message, { cardMap: state.cardMap, resolveName }),
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
    // 必须是快照:processedView 的 回合结束.applyView 会写 view.turn.vars = {}；
    // 若共享 state.turn 引用，增量视图回放会清掉权威回合用量镜像(buildView 丢失 turnUsage)。
    turn: { round: state.turn.round, phase: state.turn.phase, vars: { ...state.turn.vars } },
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
