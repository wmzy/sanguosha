// src/engine/atoms/_helpers.ts
// atoms 内部共享样板收敛(下划线开头 = atoms 目录内部工具,不对外导出业务概念):
//   - requirePlayer:validate 的「玩家存在」检查(错误文案 `${role} ${idx} not found`)。
//   - viewPlayer:applyView 的「按座次定位 view.players 条目」。
//   - broadcast:toViewEvents 的「全员广播」ViewEventSplit(无 per-player 分叉)。
//   - hookSilentView:标记型时机 atom 的「无 before-hook 则静默」视图工厂。
//   - removeCardFromHand/removeCardsFromHand/addCardToHand:applyView 的手牌样板
//     (handCount 计数 + hand 数组按 cardId 精确同步)。
//   - resolveDiscardEntry:牌入弃牌堆的单点裁决(临时牌销毁/影子卡还原/原样入堆)。
//   - clearEquipVars:装备离身时清除武器距离 vars(卸下/移出至暂存区 共用)。
//   - makeCardAskAtom:卡牌询问型等待 atom 工厂(询问杀/询问闪 逐行同构)。
import type {
  ActionPrompt,
  AtomDefinition,
  Card,
  EquipSlot,
  GameState,
  GameView,
  ViewEvent,
  ViewEventSplit,
} from '../types';
import { getBeforeHooks } from '../core/skill';
import { ASK_CARD_NAME, cardResponsePreResolveForTarget } from '../core/card-response-availability';
import { DISTANCE_ATTACK_RANGE_KEY } from '../rules/vars-keys';

/** GameView.players 的单条目形状(viewPlayer 的返回元素)。 */
export type PlayerViewEntry = GameView['players'][number];

/**
 * validate 的玩家存在检查:玩家不存在返回 `${role} ${idx} not found`,存在返回 null。
 * role 为该 atom 中玩家字段的角色名(player/target/source/initiator/from/to),
 * 保证错误文案与收敛前逐字一致。
 */
export function requirePlayer(
  state: GameState,
  idx: number,
  role: 'player' | 'target' | 'source' | 'initiator' | 'from' | 'to',
): string | null {
  return state.players[idx] ? null : `${role} ${idx} not found`;
}

/**
 * applyView 的玩家定位:按座次 index 在 view.players 中找条目,找不到返回 undefined。
 * 取代 `const pi = view.players.findIndex(...); if (pi < 0) return;` 样板。
 */
export function viewPlayer(view: GameView, idx: number): PlayerViewEntry | undefined {
  return view.players.find((p) => p.index === idx);
}

/**
 * toViewEvents 的全员广播:无 per-owner 分叉的 ViewEventSplit。
 * view 为 null 表示无人感知此 atom(静默)。
 */
export function broadcast(view: ViewEvent | null): ViewEventSplit {
  return { ownerViews: new Map(), othersView: view };
}

/**
 * 标记型时机 atom 的视图工厂:无 before-hook 时静默(null 视图,整个 atom 视图上 no-op),
 * 有 before-hook 时广播 build() 构造的通知事件。atom 本身仍走完整 pipeline,
 * 编排函数/测试可从 state.atomHistory 观察时序。
 */
export function hookSilentView(
  state: GameState,
  type: string,
  build: () => ViewEvent,
): ViewEventSplit {
  if (getBeforeHooks(state, type).length === 0) {
    return broadcast(null);
  }
  return broadcast(build());
}

// ── applyView 手牌样板(handCount 计数 + hand 数组按 cardId 精确同步) ──

/** 从 view 中指定玩家的手牌移除一张:handCount-1(下限 0)+ 按 cardId 精确过滤 hand。
 *  必须用 cardId 精确移除单张,不能用 name/suit/rank 过滤——
 *  标准牌堆中同名同花色同点数的牌有多张(如 杀♠7 有 4 张),
 *  按 name/suit/rank 会误删所有重复牌,导致 hand.length < handCount。
 *  cardId 为空(falsy)时只减计数、不动 hand(与原各调用点守卫一致)。 */
export function removeCardFromHand(p: PlayerViewEntry, cardId: string | undefined): void {
  p.handCount = Math.max(0, p.handCount - 1);
  if (cardId && p.hand) {
    p.hand = p.hand.filter((c: Card) => c.id !== cardId);
  }
}

/** 集合版:一次移除多张(弃置/移出至暂存区/当作 等)。
 *  handCount 按传入张数递减(下限 0),hand 按 cardIds 集合精确过滤。
 *  cardIds 必须是「确在手中的牌」(调用方按 zones/来源过滤后的子集)——
 *  判定区/装备区的同批牌不得计入,否则 handCount 会多扣;
 *  数组过滤按集合匹配,与含非手牌区 id 的全量集合等价(手牌数组不含那些 id)。 */
export function removeCardsFromHand(p: PlayerViewEntry, cardIds: string[]): void {
  if (cardIds.length === 0) return;
  p.handCount = Math.max(0, p.handCount - cardIds.length);
  if (p.hand) {
    const removeSet = new Set(cardIds);
    p.hand = p.hand.filter((c: Card) => !removeSet.has(c.id));
  }
}

/** 一张牌进手牌:handCount+1;可见视角(p.hand 存在)且 view.cardMap 有该卡时追加进数组。
 *  cardId 为空时仍计 +1——广播事件对不可见视角只携带计数(与 给予/获得 原实现一致);
 *  玩家不在 view 中时整体 no-op。 */
export function addCardToHand(view: GameView, idx: number, cardId: string | undefined): void {
  const p = viewPlayer(view, idx);
  if (!p) return;
  p.handCount += 1;
  if (cardId && p.hand) {
    const card = view.cardMap[cardId];
    if (card) p.hand.push(card);
  }
}

// ── 牌入弃牌堆的单点裁决 ──

/** 牌入弃牌堆前裁决其真实入堆 id(副作用:临时牌/影子卡的 cardMap 条目就地删除)。
 *  - ephemeral(结算临时牌,如八卦阵虚拟闪):销毁不入堆(null)——它是凭空生成的标记,
 *    入堆会让牌库永久多一张假牌,重洗后可被玩家摸起;
 *  - shadowOf(转化影子卡,如武圣红牌当杀):还原为原卡 id 入堆,影子条目删除
 *    (原卡 cardMap[shadowOf] 仍在);
 *  - 普通牌:原 id 入堆。
 *  所有「牌入弃牌堆」的 apply 路径(移动牌/弃置/扣牌)必须经此单点——
 *  影子 id 直接入堆会让弃牌堆出现 cardMap 外的 id(重洗后 cardMap[id] 为 undefined,
 *  摸牌/视图投影随之漂移)。 */
export function resolveDiscardEntry(state: GameState, cardId: string): string | null {
  const card = state.cardMap[cardId];
  if (card?.ephemeral) {
    delete state.cardMap[cardId];
    return null;
  }
  if (card?.shadowOf) {
    const originalId = card.shadowOf;
    delete state.cardMap[cardId];
    return originalId;
  }
  return cardId;
}

// ── 装备 vars 清理 ──

/** 清除装备槽带来的 vars(仅武器攻击范围;马匹由技能的 移除技能 hook 处理)。
 *  卸下 与 移出至暂存区 共用——武器离身(卸回手牌 或 被移出游戏)都必须清
 *  距离/出杀范围,否则徒手玩家视图仍带旧武器射程。 */
export function clearEquipVars(state: GameState, playerIdx: number, slot: EquipSlot): void {
  if (slot === '武器') {
    delete state.players[playerIdx].vars[DISTANCE_ATTACK_RANGE_KEY];
  }
}

// ── 卡牌询问型等待 atom 工厂 ──

/** 询问超时秒数:超时 = 不出牌,父流程检查处理区无响应牌继续结算。 */
const CARD_ASK_TIMEOUT_SEC = 15;

/** 卡牌询问型等待 atom 的工厂(询问杀/询问闪 逐行同构,差异仅 atom type 与响应牌名):
 *  等待 target 打出一张 cardName。prompt 的 cardFilter 与 preResolve 的匹配牌名
 *  均由调用参数派生,与 core/card-response-availability(ASK_CARD_NAME +
 *  resolveCardResponseFilter)同源,两侧不会漂移。 */
export function makeCardAskAtom(
  type: keyof typeof ASK_CARD_NAME,
  cardName: string,
): AtomDefinition<{ target: number; source: number }> {
  const prompt: ActionPrompt = {
    type: 'useCard',
    title: `是否出${cardName}`,
    cardFilter: { filter: (c) => c.name === cardName, min: 1, max: 1 },
  };
  return {
    type,
    validate(state, atom) {
      if (!state.players[atom.target]) return `target not found`;
      return null;
    },
    apply(_state) {
      // 等待型 atom——apply 不修改 state
    },
    pending: {
      // 超时:不出牌,结算继续(父 action 检查处理区无响应牌则继续后续效果)
      onTimeout: async () => {},
      prompt,
      timeout: CARD_ASK_TIMEOUT_SEC,
      // 卡牌回应型预检:无手牌→skip;有手牌无响应牌→silent;有响应牌→正常。
      // 若 target 有转化/转交防御技(龙胆/倾国/激将 等)→ 正常询问(不剥夺技能)。
      preResolve: (state, atom) =>
        cardResponsePreResolveForTarget(state, type, atom.target, (c) => c.name === cardName),
    },
    effect: { blockUntilDone: true, duration: 200 },
    // Interactive state is published from the actual slot, never reconstructed by the client clock.
    toViewEvents(_state, atom): ViewEventSplit {
      return broadcast({ type, target: atom.target, source: atom.source });
    },
  };
}
