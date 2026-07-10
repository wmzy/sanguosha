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

/** 判断目标是否为盟友（基于身份）。
 *  身份规则：
 *  - 主公/忠臣互为盟友（反贼/内奸是敌人）
 *  - 反贼互为盟友（主公/忠臣是敌人）
 *  - 内奸：所有人都是敌人（除自己）
 *  - 目标身份未知(undefined)时：保守视为非盟友
 *  - 自己的身份未知时：保守视为非盟友（即所有人都当敌人处理）
 */
function isAlly(myIdentity: string | undefined, targetIdentity: string | undefined): boolean {
  if (!myIdentity || !targetIdentity) return false;
  // 内奸无盟友
  if (myIdentity === '内奸') return false;
  // 同身份互为盟友（主公-主公/忠臣-忠臣/反贼-反贼）
  if (myIdentity === targetIdentity) return true;
  // 主公与忠臣互为盟友
  if (
    (myIdentity === '主公' && targetIdentity === '忠臣') ||
    (myIdentity === '忠臣' && targetIdentity === '主公')
  ) {
    return true;
  }
  return false;
}

/** 从 action.validTargets 中筛选敌方玩家（基于身份）。 */
function enemyTargets(
  view: AiViewSnapshot,
  action: AvailableAction,
): Array<AiViewSnapshot['players'][number]> {
  const myId = selfOf(view)?.identity;
  return action.validTargets
    .map((i) => view.players[i])
    .filter((p): p is NonNullable<typeof p> => !!p && !isAlly(myId, p.identity));
}

// ────────────────────────────────────────────────────────────────
// 无懈可击评分（威胁等级 × 目标价值 × 阵营 × 手牌/轮次修正）
// ────────────────────────────────────────────────────────────────

/** 轮次修正：前两轮保守(-5)，后期(round≥5)激进(+5)，中期不变。 */
function roundModifier(view: AiViewSnapshot): number {
  const round = view.turn.round;
  if (round <= 2) return -5;
  if (round >= 5) return 5;
  return 0;
}

/** 锦囊威胁等级（按牌名分类，不考虑目标状态）。
 *  - critical：关键单体锦囊（顺手牵羊/过河拆桥/决斗/乐不思蜀）= 90
 *  - high：借刀杀人/火攻/兵粮寸断 = 75
 *  - medium：南蛮入侵/万箭齐发（群体，视存活人数）= 60
 *  - low：桃园结义/五谷丰登/无中生有（一般不无懈）= 40
 *  - 未知：medium = 60 */
export function wuxieThreatLevel(title: string): {
  level: 'critical' | 'high' | 'medium' | 'low';
  score: number;
} {
  if (/顺手牵羊|过河拆桥|决斗|乐不思蜀/.test(title)) {
    return { level: 'critical', score: 90 };
  }
  if (/借刀杀人|火攻|兵粮寸断/.test(title)) {
    return { level: 'high', score: 75 };
  }
  if (/南蛮入侵|万箭齐发/.test(title)) {
    return { level: 'medium', score: 60 };
  }
  if (/桃园结义|五谷丰登|无中生有/.test(title)) {
    return { level: 'low', score: 40 };
  }
  return { level: 'medium', score: 60 };
}

/** 被指定目标的"保护价值"评分（0-100）。
 *  综合目标血量（残血更需要保护）、手牌数（多牌被顺拆损失大）、武将强度。
 *  注：阵营归属（盟友/敌方）由调用方判断，本函数只评估目标本身的价值。 */
export function wuxieTargetValue(view: AiViewSnapshot, targetIdx: number): number {
  const target = view.players[targetIdx];
  if (!target) return 50;
  let value = 50;
  // 残血目标保护价值更高（可能被关键锦囊击杀）
  if (target.health <= 1) value += 20;
  else if (target.health <= 2) value += 12;
  // 手牌多：被顺手牵羊/过河拆桥损失更大
  if (target.handCount >= 4) value += 10;
  // 核心武将更值得保护
  if (STRONG_CHARACTERS.has(target.character)) value += 10;
  return clamp(value);
}

/** 自己手牌中【无懈可击】的数量（仅 viewer 手牌可见）。 */
export function countWuxieInHand(view: AiViewSnapshot): number {
  return selfOf(view)?.hand?.filter((c) => c.name === '无懈可击').length ?? 0;
}

/** 无懈可击综合评分。
 *  维度：锦囊威胁等级 × 目标保护价值 × 阵营（自己/盟友/敌方）× 手牌无懈数 × 轮次。 */
export function scoreWuxie(view: AiViewSnapshot, _action: AvailableAction): ScoredAction {
  const title = view.pending?.promptTitle ?? '';
  const threat = wuxieThreatLevel(title);
  const targetIdx = view.pending?.target ?? -1;
  const me = selfOf(view);
  const myId = me?.identity;
  const roundMod = roundModifier(view);

  // 广播型 / 目标未知：以威胁等级为基础
  if (targetIdx < 0 || !view.players[targetIdx]) {
    let baseScore = threat.score;
    // 群体锦囊在场上存活人数少时威胁降低
    if (/南蛮|万箭/.test(title)) {
      const aliveCount = view.players.filter((p) => p.alive).length;
      if (aliveCount <= 2) baseScore -= 15;
    }
    const score = clamp(baseScore + roundMod);
    return {
      score,
      reason: `${title || '锦囊'}（广播型，威胁${threat.level}）${score >= 60 ? '考虑' : '暂不'}打出【无懈可击】`,
    };
  }

  const target = view.players[targetIdx];
  const targetVal = wuxieTargetValue(view, targetIdx);

  // 自己被指定：始终最高优先级
  if (targetIdx === view.viewer) {
    const score = clamp(threat.score + 5 + roundMod);
    return {
      score,
      reason: `自己被${title}指定（威胁${threat.level}），打出【无懈可击】自保`,
    };
  }

  // 盟友被指定：威胁等级 × 目标价值，并按手牌无懈数微调
  if (isAlly(myId, target.identity)) {
    const baseScore = Math.round((threat.score + targetVal) / 2);
    const wuxieCount = countWuxieInHand(view);
    const handMod = wuxieCount <= 1 ? -5 : 0;
    const score = clamp(baseScore + roundMod + handMod);
    return {
      score,
      reason: `盟友${target.name}被${title}指定（威胁${threat.level}/价值${targetVal}），打出【无懈可击】保护`,
    };
  }

  // 敌方被指定：默认保留无懈；但若锦囊对我方有利（桃园/五谷帮敌方），则考虑无懈阻止
  if (/桃园结义|五谷丰登/.test(title)) {
    return {
      score: 55,
      reason: `敌方${target.name}的${title}对我方有利，考虑无懈阻止`,
    };
  }
  return {
    score: 20,
    reason: `敌方${target.name}被${title}指定，保留【无懈可击】`,
  };
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

  // 无懈可击：综合评分（威胁×价值×阵营×手牌/轮次），见 scoreWuxie
  if (skillId === '无懈可击') {
    return scoreWuxie(view, action);
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

  // 无懈可击询问窗口的 skip（非阻塞 pending）
  if (view.pending && !view.pending.isBlocking) {
    const targetIdx = view.pending.target;
    const title = view.pending.promptTitle ?? '';
    const threat = wuxieThreatLevel(title);
    if (targetIdx >= 0 && targetIdx < view.players.length) {
      const myId = me?.identity;
      const isFriend =
        targetIdx === view.viewer || isAlly(myId, view.players[targetIdx]?.identity);
      if (isFriend) {
        // 关键威胁且目标是盟友/自己 → skip 进一步降低（强烈建议无懈）
        if (threat.level === 'critical') {
          return {
            score: 35,
            reason: `${title}威胁己方${view.players[targetIdx]?.name ?? ''}，不宜跳过（强烈建议无懈）`,
          };
        }
        // 盟友/自己被锦囊指定 → 降低 skip 分（可能需要无懈保护）
        return { score: 42, reason: '盟友/自己被锦囊指定，不宜跳过（可能需无懈保护）' };
      }
      // 敌方被指定：低威胁锦囊 → 更倾向保留（skip 分提高）
      if (threat.level === 'low') {
        return { score: 65, reason: `敌方被低威胁锦囊(${title})指定，保留【无懈可击】` };
      }
    }
    // 广播型或敌方被指定（非低威胁）：保留无懈通常正确
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
    const myId = me?.identity;
    const enemies = enemyTargets(view, action);

    // 没有敌方目标（全是盟友或身份不明）
    if (enemies.length === 0) {
      return { score: 8, reason: '【杀】无敌方目标（合法目标均为盟友/身份不明）' };
    }

    // 内奸特殊：优先攻击当前血量最高的存活玩家（平衡局势）
    if (myId === '内奸') {
      const maxHp = Math.max(...enemies.map((p) => p.health));
      const prime = enemies.find((p) => p.health === maxHp)!;
      if (prime.health <= 1) {
        return { score: 85, reason: `【杀】攻击残血 ${prime.name}(${prime.health}血，可击杀)` };
      }
      return { score: 72, reason: `【杀】内奸平衡局势，攻击高血 ${prime.name}(${prime.health}血)` };
    }

    // 反贼优先攻击主公
    if (myId === '反贼') {
      const lord = enemies.find((p) => p.identity === '主公');
      if (lord) {
        if (lord.health <= 1) {
          return { score: 90, reason: `【杀】攻击残血主公 ${lord.name}(${lord.health}血，可击杀)` };
        }
        return { score: 82, reason: `【杀】反贼优先攻击主公 ${lord.name}(${lord.health}血)` };
      }
    }

    // 通用：选血量最低的敌人
    const minHp = Math.min(...enemies.map((p) => p.health));
    const prime = enemies.find((p) => p.health === minHp)!;
    if (prime.health <= 1) {
      return { score: 85, reason: `【杀】攻击残血 ${prime.name}(${prime.health}血，可击杀)` };
    }
    if (prime.health <= 2) {
      return { score: 78, reason: `【杀】攻击低血 ${prime.name}(${prime.health}血)` };
    }
    return { score: 72, reason: `【杀】攻击目标(${enemies.length}个敌方)` };
  }

  // 顺手牵羊 / 过河拆桥：目标有牌且为敌方才值得
  if (cardName === '顺手牵羊' || cardName === '过河拆桥') {
    const enemies = enemyTargets(view, action);
    if (enemies.length === 0) {
      return { score: 18, reason: `【${cardName}】合法目标均为盟友/身份不明` };
    }
    const hasCards = enemies.some(
      (p) => p.handCount > 0 || Object.keys(p.equipment ?? {}).length > 0,
    );
    if (!hasCards) return { score: 8, reason: `${cardName}目标无牌可取` };
    return { score: 75, reason: `【${cardName}】夺取敌方目标牌` };
  }

  // 无中生有：稳定摸2张
  if (cardName === '无中生有') {
    return { score: 80, reason: '【无中生有】摸2张牌（稳定过牌）' };
  }

  // 决斗
  if (cardName === '决斗') {
    if (action.validTargets.length === 0) return { score: 5, reason: '【决斗】无合法目标' };
    if (enemyTargets(view, action).length === 0) {
      return { score: 18, reason: '【决斗】合法目标均为盟友/身份不明' };
    }
    return { score: 70, reason: '【决斗】敌方目标（注意己方杀数）' };
  }

  // AOE：注意是否伤队友
  if (cardName === '南蛮入侵' || cardName === '万箭齐发') {
    const myId = me?.identity;
    const allies = view.players.filter(
      (p) => p.alive && p.index !== view.viewer && isAlly(myId, p.identity),
    ).length;
    if (allies > 0) {
      return {
        score: Math.max(20, 68 - allies * 15),
        reason: `【${cardName}】会伤害${allies}名盟友，降分`,
      };
    }
    return { score: 68, reason: `【${cardName}】群体伤害（无盟友受波及）` };
  }

  // 借刀杀人
  if (cardName === '借刀杀人') {
    if (action.validTargets.length === 0) return { score: 5, reason: '【借刀杀人】无合法目标' };
    if (enemyTargets(view, action).length === 0) {
      return { score: 18, reason: '【借刀杀人】合法目标均为盟友/身份不明' };
    }
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
    if (enemyTargets(view, action).length === 0) {
      return { score: 18, reason: `【${cardName}】合法目标均为盟友/身份不明` };
    }
    return { score: 73, reason: `【${cardName}】控场敌方目标` };
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
    if (enemyTargets(view, action).length === 0) {
      return { score: 18, reason: '【火攻】合法目标均为盟友/身份不明' };
    }
    return { score: 65, reason: '【火攻】敌方目标' };
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

/** 卡牌保留优先级（越高越保留，越低越优先弃）。
 *  用于弃牌阶段选牌：低分先弃。
 *  装备牌(type==='装备牌')最优先弃（多余装备）；桃/无懈/闪最该留。 */
function cardKeepPriority(card: Card): number {
  if (card.type === '装备牌') return 30;
  switch (card.name) {
    case '桃':
      return 100;
    case '无懈可击':
      return 90;
    case '闪':
      return 85;
    case '无中生有':
      return 78;
    case '杀':
      return 70;
    case '顺手牵羊':
    case '过河拆桥':
      return 65;
    case '乐不思蜀':
    case '兵粮寸断':
      return 60;
    case '决斗':
    case '借刀杀人':
      return 55;
    case '南蛮入侵':
    case '万箭齐发':
      return 50;
    case '桃园结义':
    case '五谷丰登':
      return 45;
    case '闪电':
      return 35;
    default:
      return 40;
  }
}

/** 从手牌中选出建议弃掉的 cardIds（按保留优先级从低到高取前 N 张）。 */
function suggestDiscardCards(hand: Card[], count: number): string[] {
  if (count <= 0 || hand.length === 0) return [];
  return [...hand]
    .sort((a, b) => cardKeepPriority(a) - cardKeepPriority(b))
    .slice(0, count)
    .map((c) => c.id);
}

function scoreDiscard(view: AiViewSnapshot, action: AvailableAction): ScoredAction {
  const me = selfOf(view);
  const hand = me?.hand ?? [];
  const handCount = me?.handCount ?? hand.length;
  const max = me?.maxHealth ?? 0;
  const overflow = Math.max(0, handCount - max);

  if (overflow <= 0) {
    return { score: 50, reason: '弃牌阶段（手牌未超限，无需弃牌）' };
  }

  // 如果 action.params.cardIds 已有具体值，验证它们是否是低价值牌
  const existingCardIds = (action.message.params as { cardIds?: string[] }).cardIds;
  if (existingCardIds && existingCardIds.length > 0) {
    const selectedCards = existingCardIds
      .map((id) => hand.find((c) => c.id === id))
      .filter(Boolean) as Card[];
    if (selectedCards.length > 0) {
      const avgPriority =
        selectedCards.reduce((s, c) => s + cardKeepPriority(c), 0) / selectedCards.length;
      // 弃了高价值牌则降分
      if (avgPriority >= 80) {
        return {
          score: 25,
          reason: `弃牌选择不佳：弃掉了高价值牌（均保留优先级${avgPriority.toFixed(0)}），建议保留桃/闪/无懈`,
        };
      }
      return { score: 55, reason: `弃牌选择合理（均保留优先级${avgPriority.toFixed(0)}）` };
    }
  }

  // 建议弃牌：按保留优先级从低到高排序
  const suggested = suggestDiscardCards(hand, overflow);
  if (suggested.length === 0) {
    // 手牌不可见或为空，给通用指导（保留旧文案以含 overflow 数量）
    return {
      score: 50,
      reason: `弃牌阶段（手牌${handCount}>体力${max}，需弃${overflow}张；优先弃多余装备>无用锦囊，保留桃>闪>杀）`,
    };
  }
  const suggestedCards = suggested
    .map((id) => hand.find((c) => c.id === id))
    .filter(Boolean) as Card[];
  const suggestedDesc = suggestedCards.map((c) => `${c.suit}${c.rank}${c.name}`).join('、');

  return {
    score: 50,
    reason: `弃牌阶段：建议弃 ${suggestedDesc}（保留桃>闪>无懈>杀>锦囊>装备）。建议弃牌cardIds: [${suggested.join(', ')}]`,
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
