// src/ai-mcp/heuristics.ts
// AI 启发式策略评分器。纯函数，零副作用。
//
// 定位：在 enumerateAvailableActions（动作枚举）与外部 LLM（慢决策）之间，
// 提供一层快速启发式评分，为每个 AvailableAction 打分（0-100）并推荐最优。
// 用途：
//   1. LLM 兜底——LLM 慢/不可用/超时时，pickBestAction 直接给出可执行动作；
//   2. 动作排序——把高分动作排到前面，降低 LLM 选错概率。
// 不替代 LLM：它只看局部、可见信息，做"合理但不一定最优"的判断。
//
// 评分总览（详见各 score* 函数）：
//   respond 救命（桃自救）=100  >  respond 出闪/出杀 =80-98  >  play 主动 =50-85
//   >  discard 弃牌 =50  >  skip 兜底 =30  >  无目标/满血无意义 =5-10
import type { AiViewSnapshot, AvailableAction } from '../client/headless/types';
import type { Card, EquipSlot } from '../engine/types';

/** 单动作评分结果。 */
export interface ScoredAction {
  /** 0-100，越高越优（已四舍五入并钳制到区间）。 */
  score: number;
  /** 人类可读的评分理由，供 LLM/日志参考。 */
  reason: string;
}

const SCORE_FLOOR = 0;
const SCORE_CEIL = 100;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return SCORE_FLOOR;
  return Math.max(SCORE_FLOOR, Math.min(SCORE_CEIL, Math.round(n)));
}

/** 取自身座次玩家视图。 */
function selfOf(view: AiViewSnapshot): AiViewSnapshot['players'][number] | undefined {
  return view.players[view.viewer];
}

/** 从 action.params.cardId 在自己手牌中查具体 Card（仅 viewer 自己手牌可见）。 */
function findCardInHand(view: AiViewSnapshot, cardId: string | undefined): Card | undefined {
  if (!cardId) return undefined;
  return selfOf(view)?.hand?.find((c) => c.id === cardId);
}

/** 从 action 提取要使用的卡牌 id 与名称。 */
function actionCard(action: AvailableAction): { id?: string; name: string } {
  const p = action.message.params as Record<string, unknown>;
  const id = typeof p.cardId === 'string' ? p.cardId : undefined;
  return { id, name: action.message.skillId };
}

/** 自身血量比例（0-1）。 */
function selfHpRatio(view: AiViewSnapshot): number {
  const me = selfOf(view);
  if (!me || me.maxHealth <= 0) return 1;
  return me.health / me.maxHealth;
}

/** 是否有人濒死（存活且体力 ≤ 0）。 */
function someoneDying(view: AiViewSnapshot): boolean {
  return view.players.some((p) => p.alive && p.health <= 0);
}

/** 自身是否濒死。 */
function selfDying(view: AiViewSnapshot): boolean {
  const me = selfOf(view);
  return !!me && me.alive && me.health <= 0;
}

/** 判定是否处于针对自己的阻塞型回应（被杀/被决斗/被求桃等）。 */
function isBlockingRespondToSelf(view: AiViewSnapshot): boolean {
  const p = view.pending;
  return !!p && p.isBlocking && p.target === view.viewer;
}

// ────────────────────────────────────────────────────────────────
// respond 类（最高优先级——不回应会受伤/死亡）
// ────────────────────────────────────────────────────────────────
function scoreRespond(view: AiViewSnapshot, action: AvailableAction): ScoredAction {
  const skillId = action.message.skillId;
  const me = selfOf(view);
  const hp = me?.health ?? 0;

  // 求桃救命：自己或他人濒死
  if (skillId === '桃' || skillId === '酒') {
    if (selfDying(view)) return { score: 100, reason: '自己濒死，出【桃】自救（救命）' };
    if (someoneDying(view)) return { score: 95, reason: '有人濒死，出【桃】相救' };
    // 非濒死时不应在 respond 窗口出桃（兜底）
    return { score: 60, reason: `回应【${skillId}】` };
  }

  // 被杀→出闪
  if (skillId === '闪') {
    if (hp <= 1) return { score: 98, reason: '残血被杀，出【闪】保命' };
    return { score: 90, reason: '被杀，出【闪】抵消伤害' };
  }

  // 询问杀（决斗/南蛮入侵）→出杀
  if (skillId === '杀') {
    if (hp <= 1) return { score: 92, reason: '残血，出【杀】避免伤害/输掉决斗' };
    return { score: 80, reason: '出【杀】回应（决斗/南蛮入侵）' };
  }

  // 无懈可击（广播型 pending）
  if (skillId === '无懈可击') {
    const title = view.pending?.promptTitle ?? '';
    // 关键锦囊（对自己/局势影响大）才值得无懈
    if (/顺手牵羊|过河拆桥|决斗|借刀杀人|乐不思蜀|兵粮寸断|火攻/.test(title)) {
      return { score: 80, reason: `关键锦囊(${title})，打出【无懈可击】` };
    }
    if (/南蛮入侵|万箭齐发|桃园结义|五谷丰登|无中生有/.test(title)) {
      return { score: 70, reason: `群体锦囊(${title})，考虑【无懈可击】` };
    }
    return { score: 65, reason: '打出【无懈可击】应对锦囊' };
  }

  // confirm 类技能触发（突袭/苦肉等）
  return { score: 75, reason: `发动/回应【${skillId}】` };
}

// ────────────────────────────────────────────────────────────────
// skip 类（不回应/不打出）
// ────────────────────────────────────────────────────────────────
function scoreSkip(view: AiViewSnapshot, _action: AvailableAction): ScoredAction {
  const me = selfOf(view);
  const hp = me?.health ?? 0;

  // 广播型 pending（无懈可击询问）的 skip：保留无懈通常是对的
  if (view.pending && view.pending.target < 0) {
    return { score: 60, reason: '保留【无懈可击】，暂不打出' };
  }

  // 针对自己的阻塞型回应 skip = 承受伤害
  if (isBlockingRespondToSelf(view)) {
    if (hp <= 1) return { score: 20, reason: '残血仍不出牌，濒危（建议回应）' };
    return { score: 40, reason: '不出牌，承受伤害' };
  }

  // 通用兜底
  return { score: 30, reason: '跳过' };
}

// ────────────────────────────────────────────────────────────────
// play 类（主动出牌）
// ────────────────────────────────────────────────────────────────
function scorePlay(view: AiViewSnapshot, action: AvailableAction): ScoredAction {
  const { id, name } = actionCard(action);
  const card = findCardInHand(view, id);
  const cardName = card?.name ?? name ?? '';
  const me = selfOf(view);

  // 桃：满血不出；残血保命
  if (cardName === '桃') {
    const hp = me?.health ?? 0;
    const max = me?.maxHealth ?? 0;
    if (hp >= max) return { score: 10, reason: '满血，无需出【桃】' };
    if (hp <= 1) return { score: 88, reason: '残血，出【桃】回血保命' };
    return { score: 55, reason: '不满血，出【桃】回血' };
  }

  // 酒：出牌阶段用作杀+1或自救（自救走 respond 分支，这里仅 buff）
  if (cardName === '酒') {
    return { score: 35, reason: '出【酒】（杀+1伤害或留作自救）' };
  }

  // 杀：射程内（validTargets 已过滤射程/存活）有目标
  if (cardName === '杀') {
    if (action.validTargets.length === 0) {
      return { score: 5, reason: '【杀】无合法目标（射程外/无敌人）' };
    }
    const targets = action.validTargets.map((i) => view.players[i]).filter(Boolean);
    const minHp = Math.min(...targets.map((p) => p.health));
    const prime = targets.find((p) => p.health === minHp);
    if (prime && prime.health <= 1) {
      return { score: 85, reason: `【杀】攻击残血 ${prime.name}(${prime.health}血，可击杀)` };
    }
    if (prime && prime.health <= 2) {
      return { score: 78, reason: `【杀】攻击低血 ${prime.name}(${prime.health}血)` };
    }
    return { score: 72, reason: `【杀】攻击目标(${targets.length}个合法)` };
  }

  // 顺手牵羊 / 过河拆桥：目标有牌才值得
  if (cardName === '顺手牵羊' || cardName === '过河拆桥') {
    const hasCards = action.validTargets
      .map((i) => view.players[i])
      .some((p) => p && (p.handCount > 0 || Object.keys(p.equipment ?? {}).length > 0));
    if (!hasCards) return { score: 8, reason: `${cardName}目标无牌可取` };
    return { score: 75, reason: `【${cardName}】夺取目标牌` };
  }

  // 无中生有：稳定摸2张
  if (cardName === '无中生有') {
    return { score: 80, reason: '【无中生有】摸2张牌（稳定过牌）' };
  }

  // 决斗
  if (cardName === '决斗') {
    if (action.validTargets.length === 0) return { score: 5, reason: '【决斗】无合法目标' };
    return { score: 70, reason: '【决斗】目标（注意己方杀数）' };
  }

  // AOE：注意是否伤队友
  if (cardName === '南蛮入侵' || cardName === '万箭齐发') {
    return { score: 68, reason: `【${cardName}】群体伤害（注意队友）` };
  }

  // 借刀杀人
  if (cardName === '借刀杀人') {
    if (action.validTargets.length === 0) return { score: 5, reason: '【借刀杀人】无合法目标' };
    return { score: 72, reason: '【借刀杀人】夺取/借武器' };
  }

  // 桃园结义：有人受伤才收益
  if (cardName === '桃园结义') {
    const wounded = view.players.some((p) => p.alive && p.health < p.maxHealth);
    return wounded
      ? { score: 65, reason: '【桃园结义】群体回血' }
      : { score: 20, reason: '无人受伤，【桃园结义】收益低' };
  }

  // 五谷丰登：双方都受益，中性
  if (cardName === '五谷丰登') {
    return { score: 50, reason: '【五谷丰登】（双方都受益）' };
  }

  // 延时控场锦囊
  if (cardName === '乐不思蜀' || cardName === '兵粮寸断') {
    if (action.validTargets.length === 0) return { score: 5, reason: `【${cardName}】无合法目标` };
    return { score: 73, reason: `【${cardName}】控场目标` };
  }
  if (cardName === '闪电') {
    return { score: 35, reason: '【闪电】高风险延时锦囊（视局势）' };
  }

  // 铁索连环
  if (cardName === '铁索连环') {
    return { score: 55, reason: '【铁索连环】（视局势）' };
  }

  // 火攻
  if (cardName === '火攻') {
    if (action.validTargets.length === 0) return { score: 5, reason: '【火攻】无合法目标' };
    return { score: 65, reason: '【火攻】目标' };
  }

  // 装备牌：空槽 + 手牌不紧缺时优先装
  if (card?.type === '装备牌') {
    const slot = (card.subtype ?? undefined) as EquipSlot | undefined;
    const occupied = slot ? !!(me?.equipment?.[slot]) : false;
    if (occupied) {
      return { score: 15, reason: `${slot}槽已占用，装备【${cardName}】收益低` };
    }
    const handCount = me?.handCount ?? 0;
    const base = handCount > 2 ? 58 : 45;
    return { score: base, reason: `装备【${cardName}】(${slot ?? '未知槽位'})` };
  }

  // 默认 play
  return { score: 50, reason: `使用【${cardName}】` };
}

// ────────────────────────────────────────────────────────────────
// discard 类（弃牌阶段）
// ────────────────────────────────────────────────────────────────
function scoreDiscard(view: AiViewSnapshot, _action: AvailableAction): ScoredAction {
  const me = selfOf(view);
  const handCount = me?.handCount ?? 0;
  const max = me?.maxHealth ?? 0;
  const overflow = Math.max(0, handCount - max);
  return {
    score: 50,
    reason:
      overflow > 0
        ? `弃牌阶段（手牌${handCount}>体力${max}，需弃${overflow}张；优先弃多余装备>无用锦囊，保留桃>闪>杀）`
        : '弃牌阶段（优先弃低价值牌）',
  };
}

// ────────────────────────────────────────────────────────────────
// selectChar 类（选将）
// ────────────────────────────────────────────────────────────────
// 偏好武将表（技能强度高的常见主力，可按需扩展）。
const STRONG_CHARACTERS = new Set([
  '诸葛亮',
  '司马懿',
  '曹操',
  '刘备',
  '孙权',
  '貂蝉',
  '甄姬',
  '郭嘉',
  '陆逊',
  '黄月英',
  '孙尚香',
  '张角',
  '华佗',
  '吕布',
  '夏侯渊',
  '张飞',
  '许褚',
]);

function scoreSelectChar(view: AiViewSnapshot, action: AvailableAction): ScoredAction {
  const params = action.message.params as Record<string, unknown>;
  const name = typeof params.character === 'string' ? params.character : '';
  const strong = STRONG_CHARACTERS.has(name);
  return {
    score: strong ? 60 : 45,
    reason: strong ? `选择强力武将【${name}】` : `选择武将【${name}】`,
  };
}

// ────────────────────────────────────────────────────────────────
// transform 类（转化出牌，如武圣红牌当杀）
// ────────────────────────────────────────────────────────────────
function scoreTransform(view: AiViewSnapshot, action: AvailableAction): ScoredAction {
  // 转化类一般产出杀/闪等，复用 play 的牌名判定
  const base = scorePlay(view, action);
  return { score: clamp(base.score - 2), reason: `转化：${base.reason}` };
}

// ────────────────────────────────────────────────────────────────
// distribute 类（分配，如仁德/制衡）
// ────────────────────────────────────────────────────────────────
function scoreDistribute(_view: AiViewSnapshot, action: AvailableAction): ScoredAction {
  return {
    score: 55,
    reason: `分配/调度【${action.message.skillId}】（视手牌结构）`,
  };
}

/**
 * 为单个动作评分。
 * 纯函数：只读 view 与 action，无副作用。
 */
export function scoreAction(view: AiViewSnapshot, action: AvailableAction): ScoredAction {
  let result: ScoredAction;
  switch (action.category) {
    case 'respond':
      result = scoreRespond(view, action);
      break;
    case 'skip':
      result = scoreSkip(view, action);
      break;
    case 'play':
      result = scorePlay(view, action);
      break;
    case 'discard':
      result = scoreDiscard(view, action);
      break;
    case 'selectChar':
      result = scoreSelectChar(view, action);
      break;
    case 'transform':
      result = scoreTransform(view, action);
      break;
    case 'distribute':
      result = scoreDistribute(view, action);
      break;
    default:
      result = { score: 30, reason: action.description };
  }
  return { score: clamp(result.score), reason: result.reason };
}

/**
 * 按评分降序排序动作（同分保持稳定顺序）。
 * 返回新数组，不修改入参。
 */
export function rankActions(view: AiViewSnapshot, actions: AvailableAction[]): AvailableAction[] {
  const scored = actions.map((a, idx) => ({ a, idx, s: scoreAction(view, a).score }));
  scored.sort((x, y) => (y.s - x.s) || x.idx - y.idx);
  return scored.map((x) => x.a);
}

/**
 * 选择评分最高的动作；无动作时返回 null。
 */
export function pickBestAction(
  view: AiViewSnapshot,
  actions: AvailableAction[],
): AvailableAction | null {
  if (actions.length === 0) return null;
  const ranked = rankActions(view, actions);
  return ranked[0];
}

/**
 * 为调试/日志：返回带评分与理由的完整列表（已排序）。
 */
export function scoreAll(
  view: AiViewSnapshot,
  actions: AvailableAction[],
): Array<{ action: AvailableAction; score: number; reason: string }> {
  return rankActions(view, actions).map((a) => {
    const s = scoreAction(view, a);
    return { action: a, score: s.score, reason: s.reason };
  });
}
