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

/** 前端可计算的出杀次数上限(基于 view 装备/turnUsage 推断)。
 *  后端采用三层模型(slash-quota.ts):额定(覆盖 max)+ 额外(叠加 Σ)+ 无限(任一 true→∞)。
 *  前端无法访问提供者集合,故用装备/turnUsage 推断近似,与后端 slashMax 同源。
 *  未来若新增非装备类提供者(武将技等),需在此同步补充推断规则。 */
export function viewSlashMax(view: ActionContext['view'], player: number): number {
  const p = view.players[player];
  if (!p) return 1;
  let max = 1;
  const weaponId = p.equipment['武器'];
  const weapon = weaponId ? view.cardMap[weaponId] : undefined;
  if (weapon?.name === '诸葛连弩') return Infinity;
  // 天义(太史慈):拼点赢后本回合 +1。turnUsage['天义/win'] 由回合用量 atom 同步。
  if (p.turnUsage?.['天义/win']) max += 1;
  // 诈降(界黄盖):失去体力后本回合杀限制次数 +1(非无限,官方为额度叠加)。
  if (p.turnUsage?.['诈降/active']) max += 1;
  // 父魂(界关兴张苞):出牌阶段杀造成伤害后本回合获得咆哮→无限出杀。
  // turnUsage['父魂/granted'] 由回合用量 atom 实时同步。
  if (p.turnUsage?.['父魂/granted']) return Infinity;
  return max;
}

/** 前端视角下某玩家本回合已出杀次数(从 view.turnUsage 投影读)。
 *  turnUsage 由「回合用量」atom 实时同步,与后端 slashUsed()(额定+额外 合计)一致。 */
export function viewSlashUsed(view: ActionContext['view'], player: number): number {
  const used = view.players[player]?.turnUsage?.['杀/usedCount'];
  return typeof used === 'number' ? used : 0;
}

/** 前端视角下某玩家本回合是否还能出杀(已用 < 上限,且未被天义拼点输阻断)。 */
export function viewCanSlash(view: ActionContext['view'], player: number): boolean {
  if (view.players[player]?.turnUsage?.['天义/lost']) return false;
  // 界弓骑(界韩当):与弃置牌花色相同的杀无次数限制。当前视角=player 时,
  // 只要手中有同花色杀,杀按钮就启用(后端 杀.validate 严格校验同花色);
  // 当前视角≠player 时无法看手牌,turnUsage 有 '界弓骑/suit' 时宽松放行(UI 提示)。
  const gongqiSuit = view.players[player]?.turnUsage?.['界弓骑/suit'];
  if (typeof gongqiSuit === 'string' && gongqiSuit !== '') {
    if (view.viewer === player) {
      const hand = view.players[player]?.hand;
      if (hand && hand.some((c) => c.name === '杀' && c.suit === gongqiSuit)) {
        return true;
      }
    } else {
      // 他人视角无法看手牌,保守允许(只影响 UI 渲染,后端权威校验)
      return true;
    }
  }
  return viewSlashUsed(view, player) < viewSlashMax(view, player);
}
