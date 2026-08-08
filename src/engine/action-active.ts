// src/engine/action-active.ts
// action 激活条件辅助(view 级谓词),供技能 onMount 声明 activeWhen 复用。
//
// 集中到 engine 层的原因:activeWhen 在技能模块(engine/skills)的 onMount 中声明,
// 而 onMount 在前端运行(skillActionRegistry import skills 触发)。若谓词放 client 层,
// 会形成 engine→client 反向依赖。故放 engine 层,与 ActionContext(engine/types)同层。
// client/utils/gameViewHelpers 的 DEFAULT_PLAY_ACTIVE 复用此处,消除重复。
import type { ActionContext } from './types';

/** 默认出牌激活条件:当前视角回合 + 出牌阶段 + 无阻塞型 pending。
 *  非阻塞型 pending(出牌窗口)不阻止出牌/用技。这是绝大多数主动出牌/用技场景的
 *  激活条件;主动技若需额外约束(限一次/转化条件),在 activeWhen 中
 *  `defaultPlayActive(ctx) && <额外条件>` 叠加。 */
export function defaultPlayActive(ctx: ActionContext): boolean {
  const { view, perspectiveIdx } = ctx;
  const pending = view.pending;
  const blocked = pending != null && pending.isBlocking !== false;
  return view.currentPlayerIndex === perspectiveIdx && view.phase === '出牌' && !blocked;
}

/** 前端可计算的出杀次数上限(基于 view 装备元数据/turnUsage 前缀聚合推断)。
 *  后端采用三层模型(slash-quota.ts):额定(覆盖 max)+ 额外(叠加 Σ)+ 无限(任一 true→∞)。
 *  前端无法访问提供者集合,故用武器元数据 + turnUsage 通用前缀推断,与后端 slashMax 同源。
 *  turnUsage 前缀约定:
 *    '杀/unlimited/<来源>' — 任一真值 → 无限出杀
 *    '杀/extra/<来源>'    — 数字,叠加到出杀上限
 *    '杀/blocked/<来源>'  — 任一真值 → 禁止出杀
 *    '杀/target/<来源>'   — 数字,叠加到目标数上限
 *    '杀/exemptSuit'      — 花色字符串,同花色杀无次数限制 */
export function viewSlashMax(view: ActionContext['view'], player: number): number {
  const p = view.players[player];
  if (!p) return 1;
  // 武器元数据:无限出杀武器(slashUnlimited)
  const weaponId = p.equipment['武器'];
  const weapon = weaponId ? view.cardMap[weaponId] : undefined;
  if (weapon?.slashUnlimited) return Infinity;
  // 回合制效果:前缀聚合('杀/unlimited/' 任一 true → ∞)
  const tu = p.turnUsage ?? {};
  for (const [k, v] of Object.entries(tu)) {
    if (k.startsWith('杀/unlimited/') && v) return Infinity;
  }
  let max = 1;
  for (const [k, v] of Object.entries(tu)) {
    if (k.startsWith('杀/extra/') && typeof v === 'number') max += v;
  }
  return max;
}

/** 前端可计算的【杀】目标数上限(基于 view 装备元数据/turnUsage 前缀/tag 推断)。
 *  与后端 slashTargetMax(state,player,cardId) 同源:默认 1;武器/回合制效果/tag 放宽。
 *  供前端选目标 UI 限制可选目标数,与后端 canUseSlash 权威校验对齐
 *  (后端是权威闸门,前端仅 UX 提示,避免玩家选了却被拒)。 */
export function viewSlashTargetMax(
  view: ActionContext['view'],
  player: number,
  card?: { name: string; damageType?: string },
): number {
  const p = view.players[player];
  if (!p) return 1;
  let max = 1;
  // 武器元数据:最后一张手牌出杀时放宽目标数(slashTargetBonusWhenLastCard)
  const weaponId = p.equipment['武器'];
  const weapon = weaponId ? view.cardMap[weaponId] : undefined;
  if (weapon?.slashTargetBonusWhenLastCard && (p.hand?.length ?? 0) === 1)
    max = Math.max(max, weapon.slashTargetBonusWhenLastCard);
  // 回合制效果:额外卖目标('杀/target/' 叠加)
  const tu = p.turnUsage ?? {};
  for (const [k, v] of Object.entries(tu)) {
    if (k.startsWith('杀/target/') && typeof v === 'number') max += v;
  }
  // 持久技能 tag:火杀多目标
  if (card?.name === '杀' && card.damageType === '火焰' && p.tags?.includes('杀/火杀多目标'))
    max = Math.max(max, 3);
  return max;
}

/** 前端视角下某玩家本回合已出杀次数(从 view.turnUsage 投影读)。
 *  turnUsage 由「回合用量」atom 实时同步,与后端 slashUsed()(额定+额外 合计)一致。 */
export function viewSlashUsed(view: ActionContext['view'], player: number): number {
  const used = view.players[player]?.turnUsage?.['杀/usedCount'];
  return typeof used === 'number' ? used : 0;
}

/** 前端视角下某玩家本回合是否还能出杀(已用 < 上限,且未被回合制效果阻断)。 */
export function viewCanSlash(view: ActionContext['view'], player: number): boolean {
  const p = view.players[player];
  if (!p) return false;
  const tu = p.turnUsage ?? {};
  // 回合制阻断('杀/blocked/' 任一 true → 禁杀)
  for (const [k, v] of Object.entries(tu)) {
    if (k.startsWith('杀/blocked/') && v) return false;
  }
  // 花色豁免:同花色杀无次数限制
  const exemptSuit = tu['杀/exemptSuit'];
  if (typeof exemptSuit === 'string' && exemptSuit !== '') {
    if (view.viewer === player) {
      const hand = p.hand;
      if (hand?.some((c) => c.name === '杀' && c.suit === exemptSuit)) return true;
    } else {
      // 他人视角无法看手牌,保守允许(只影响 UI 渲染,后端权威校验)
      return true;
    }
  }
  return viewSlashUsed(view, player) < viewSlashMax(view, player);
}
