// 卡牌回应型 atom 的「响应可用性」预检:决定是否向 target 询问 / 短延时静默 / 直接跳过。
//
// 适用 atom:询问闪 / 询问杀 / 请求回应(useCard+cardFilter.filter)。不适用:
//   - 广播求桃(target<0)
//   - 强制弃牌(mandatory=true,如英魂;filter=()=>true 永远 hasMatching → 永远 normal)
//   - confirm / choosePlayer / distribute / pickTargetCard / chooseOption 等非卡牌回应型
//
// 三种模式:
//   skip   —— target 一张手牌都没有(手牌数公开为 0,本就可判定无响应牌):不创建 slot、
//             无延时,父流程(如杀的结算)立即看到处理区无响应牌 → 正常结算。
//   silent —— target 有手牌但无匹配响应牌:创建短延时 slot(SHORT_DELAY_MS,不走 timeoutScale
//             缩放),但不向 target 展示可操作 prompt(给 target 观察型 pending,与"其他人看到的"
//             一致)。其他人看到一个短暂停顿,无法分辨"没牌不响应"还是"有牌故意不响应"。
//   normal —— target 有匹配响应牌:正常询问(维持现状)。
//
// 该模块是纯函数(state, ...) → 可用性/模式,供 applyAtom(preResolve 接入)、
// toViewEvents(决定 event.responseMode)、applyView、buildView(视图一致性)共用,
// 保证后端 slot 决策与前端投影口径一致。

import type { ActionPrompt, Atom, Card, GameState } from '../types';
import { getBeforeHooks, hasDeclaredAlternativeResponse } from './skill';

/** silent 模式的短延时毫秒数。固定值,不走房间 timeoutScale 缩放。 */
export const SHORT_DELAY_MS = 1500;

export interface CardResponseAvailability {
  handEmpty: boolean;
  hasMatching: boolean;
}

/** 卡牌回应模式。 */
export type CardResponseMode = 'skip' | 'silent' | 'normal';

/** silent 模式下 target / 其他人看到的观察型 prompt(不可操作)。 */
export const SILENT_RESPONSE_PROMPT: ActionPrompt = {
  type: 'confirm',
  title: '等待回应',
  cancelLabel: '',
};

/** target 是否拥有「不依赖字面响应牌」的替代回应能力。有则必须走正常询问(skip/silent 会错误剥夺技能)。
 *  - before-hook 型(八卦阵/八阵):检查 target 自己注册在 atomType 上的 before-hook(自动检测)。
 *    攻击方拥有的 hook(界潜袭/义绝)ownerId≠target,正确排除(且它们 cancel 在 preResolve 之前处理)。
 *  - 声明型(龙胆/急救/蛊惑/...):查技能 onInit 中通过 declareAlternativeResponse 注册的声明表。
 *    涵盖转化/转交/action 型技能,无需维护硬编码技能名单——新增技能在其 onInit 中声明即可。 */
export function hasAlternativeResponse(
  state: GameState,
  atomType: string,
  target: number,
  requestType?: string,
): boolean {
  // before-hook 型替代:target 自己注册在该 atom 上的 before-hook(如八卦阵/八阵判定闪)
  const hooks = getBeforeHooks(state, atomType);
  for (const h of hooks) {
    if (h.ownerId === target) return true;
  }
  // 声明型替代:技能 onInit 中通过 declareAlternativeResponse 就近注册
  return hasDeclaredAlternativeResponse(state, atomType, target, requestType);
}

/** 由可用性推导回应模式。 */
export function resolveCardResponseMode(avail: CardResponseAvailability): CardResponseMode {
  if (avail.handEmpty) return 'skip';
  if (!avail.hasMatching) return 'silent';
  return 'normal';
}

/** 由可用性推导 preResolve 结果(skip / {delayMs} / null)。 */
export function availabilityToPreResolve(
  avail: CardResponseAvailability,
): 'skip' | { delayMs: number } | null {
  const mode = resolveCardResponseMode(avail);
  if (mode === 'skip') return 'skip';
  if (mode === 'silent') return { delayMs: SHORT_DELAY_MS };
  return null;
}

/** 给定 target + 匹配 filter,评估可回应性(核心纯函数)。
 *  target 不存在时回退为 handEmpty(保守:调用方一般已校验 target 存在)。 */
export function evaluateCardResponseForTarget(
  state: GameState,
  target: number,
  filter: (card: Card) => boolean,
): CardResponseAvailability {
  const player = state.players[target];
  if (!player) return { handEmpty: true, hasMatching: false };
  const hand = player.hand;
  if (hand.length === 0) return { handEmpty: true, hasMatching: false };
  let hasMatching = false;
  for (const id of hand) {
    const card = state.cardMap[id];
    if (!card) continue;
    // filter 可能访问未提供的字段而抛错(投影层/不同版本),保守视为匹配,
    // 避免误判"无牌"而跳过询问。
    try {
      if (filter(card)) {
        hasMatching = true;
        break;
      }
    } catch {
      hasMatching = true;
      break;
    }
  }
  return { handEmpty: false, hasMatching };
}

/** 从卡牌回应型 atom(完整 Atom,含 type)解析出"匹配响应牌"的判定函数。
 *  非卡牌回应型 / 广播(target<0)/ 强制弃牌(mandatory)返回 null。
 *  供 buildView 等持有完整 slot.atom 的调用方使用。 */
function resolveCardResponseFilter(atom: Atom): ((card: Card) => boolean) | null {
  if (atom.type === '询问闪') return (c) => c.name === '闪';
  if (atom.type === '询问杀') return (c) => c.name === '杀';
  if (atom.type === '请求回应') {
    if ((atom as { mandatory?: boolean }).mandatory === true) return null;
    const prompt = (atom as { prompt?: ActionPrompt }).prompt;
    if (prompt?.type !== 'useCard') return null;
    const filter = prompt.cardFilter?.filter;
    if (typeof filter !== 'function') return null;
    return filter;
  }
  return null;
}

/** 对卡牌回应型 atom(完整 Atom)评估 target 的可回应性。
 *  非卡牌回应型 / 广播(target<0)/ target 不存在时返回 null(走正常询问流程)。
 *  供 buildView(视图一致性)等持有完整 slot.atom 的调用方使用。 */
export function evaluateCardResponse(
  state: GameState,
  atom: Atom,
): CardResponseAvailability | null {
  const filter = resolveCardResponseFilter(atom);
  if (!filter) return null;
  const target = (atom as { target?: number }).target;
  if (typeof target !== 'number' || target < 0) return null;
  return evaluateCardResponseForTarget(state, target, filter);
}

/** 便捷:直接由 (state, 完整 atom) 得到回应模式。非卡牌回应型返回 'normal'。
 *  供 buildView 使用(slot.atom 是完整 Atom)。应用 hasAlternativeResponse 门控。 */
export function getCardResponseMode(state: GameState, atom: Atom): CardResponseMode {
  const target = (atom as { target?: number }).target;
  const requestType = (atom as { requestType?: string }).requestType;
  if (
    typeof target === 'number' &&
    target >= 0 &&
    hasAlternativeResponse(state, atom.type, target, requestType)
  ) {
    return 'normal';
  }
  const avail = evaluateCardResponse(state, atom);
  if (!avail) return 'normal';
  return resolveCardResponseMode(avail);
}

/** 给定 atomType + target + 匹配 filter,得到门控后的回应模式(供 atom 的 toViewEvents 使用)。
 *  target 有替代回应能力(转化/转交/判定防御技/救援转化技)时返回 'normal'(不剥夺其技能)。 */
export function evaluateCardResponseModeForTarget(
  state: GameState,
  atomType: string,
  target: number,
  filter: (card: Card) => boolean,
  requestType?: string,
): CardResponseMode {
  if (hasAlternativeResponse(state, atomType, target, requestType)) return 'normal';
  return resolveCardResponseMode(evaluateCardResponseForTarget(state, target, filter));
}

/** 给定 atomType + target + 匹配 filter,得到门控后的 preResolve 结果(供 atom 的 preResolve 使用)。
 *  target 有替代回应能力时返回 null(正常询问)。 */
export function cardResponsePreResolveForTarget(
  state: GameState,
  atomType: string,
  target: number,
  filter: (card: Card) => boolean,
  requestType?: string,
): 'skip' | { delayMs: number } | null {
  if (hasAlternativeResponse(state, atomType, target, requestType)) return null;
  return availabilityToPreResolve(evaluateCardResponseForTarget(state, target, filter));
}
