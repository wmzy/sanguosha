// src/engine/atoms/_helpers.ts
// atoms 内部共享样板收敛(下划线开头 = atoms 目录内部工具,不对外导出业务概念):
//   - requirePlayer:validate 的「玩家存在」检查(错误文案 `${role} ${idx} not found`)。
//   - viewPlayer:applyView 的「按座次定位 view.players 条目」。
//   - broadcast:toViewEvents 的「全员广播」ViewEventSplit(无 per-player 分叉)。
//   - hookSilentView:标记型时机 atom 的「无 before-hook 则静默」视图工厂。
//   - removeCardFromHand/removeCardsFromHand/addCardToHand:applyView 的手牌样板
//     (handCount 计数 + hand 数组按 cardId 精确同步)。
//   - applyDrawEvent:摸牌 ViewEvent 的 applyView 单点(摸牌 atom 与 移动牌「牌堆→手牌」共用)。
//   - takeFromDeck:牌堆计数递减单点(判定/移动牌/置创牌/发牌 的 applyView 共用)。
//   - resolveDiscardEntry:牌入弃牌堆的单点裁决(临时牌销毁/影子卡还原/原样入堆)。
//   - pushToDiscardPile:牌入弃牌堆的 apply 单点(裁决 + push 的两行组合)。
//   - removeFromEquipment:装备区按谓词重建(apply/applyView 的「剔除被移走的装备槽」样板)。
//   - clearEquipVars:装备离身时清除武器距离 vars(卸下/移出至暂存区 共用)。
//   - clearEquipViewVars:clearEquipVars 的 view 侧配对(武器离身清 distanceVars.attackRange)。
//   - decrementHandCount:others 视角的手牌计数扣减(仅减计数不动 hand 数组)。
//   - makeCardAskAtom:卡牌询问型等待 atom 工厂(询问杀/询问闪 逐行同构)。
//   - makeHealthDeltaAtom:体力增减 atom 工厂(回复体力/失去体力 同构,差异仅方向/钳制/文案)。
import type {
  ActionPrompt,
  AtomDefinition,
  AtomEffect,
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

/** others 视角的手牌计数扣减:仅减 handCount(下限 0),不动 hand 数组。
 *  用于「owner 视图按 handIds 精确移除、others 视图只见计数」的分叉 else 支
 *  (移出至暂存区 等):不可见视角无 hand 数组,可见视角的数组同步走 removeCardsFromHand。 */
export function decrementHandCount(p: PlayerViewEntry, n: number): void {
  if (n > 0) p.handCount = Math.max(0, p.handCount - n);
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

/** 牌堆计数递减单点(判定/移动牌/置创牌/发牌 的 applyView 共用):
 *  deckCount 按翻/摸走张数递减(下限 0)。zones 缺失时 no-op——GameView 契约中
 *  zones 为可选项(types/view.ts),与各调用点原「if (view.zones)」守卫行为一致。 */
export function takeFromDeck(view: GameView, n: number): void {
  if (view.zones) view.zones.deckCount = Math.max(0, view.zones.deckCount - n);
}

/** 摸牌 ViewEvent 的 applyView 单点(摸牌 atom 与 移动牌「牌堆→手牌」路径共用):
 *  handCount += count;可见视角(p.hand 存在)且事件带 cards 时追加进手牌数组;
 *  deckCount 按摸入张数递减(下限 0)。reshuffled(摸牌 atom 牌堆不足重洗路径)时
 *  牌堆/弃牌堆计数改用事件携带的权威值覆盖。玩家不在 view 中时整体 no-op。
 *  count 缺省按 1 计(两处调用点的摸牌事件恒带 count;摸牌 atom validate 要求
 *  count > 0,缺省分支实际不可达)。 */
export function applyDrawEvent(view: GameView, event: ViewEvent): void {
  const p = viewPlayer(view, event.player as number);
  if (!p) return;
  const count = (event.count as number) ?? 1;
  p.handCount += count;
  // owner 有 cards 字段,加入手牌;others 视角只有计数
  if (event.cards && p.hand) {
    p.hand.push(...(event.cards as Card[]));
  }
  if (view.zones) {
    if (event.reshuffled) {
      // 重洗:牌堆/弃牌堆计数用事件携带的权威值覆盖;newDeckCount 缺省时回退
      // 「按摸入张数扣减」(deckCount 尚未修改,与旧实现逐字一致)
      view.zones.deckCount =
        (event.newDeckCount as number) ?? Math.max(0, view.zones.deckCount - count);
      view.zones.discardPileCount = (event.newDiscardPileCount as number) ?? 0;
    } else {
      takeFromDeck(view, count);
    }
  }
}

// ── 牌入弃牌堆的单点裁决 ──

/** 牌入弃牌堆前裁决其真实入堆 id(副作用:临时牌/影子卡的 cardMap 条目就地删除)。
 *  - ephemeral(结算临时牌,如八卦阵虚拟闪):销毁不入堆(null)——它是凭空生成的标记,
 *    入堆会让牌库永久多一张假牌,重洗后可被玩家摸起;
 *  - shadowOf(转化影子卡,如武圣红牌当杀):还原为原卡 id 入堆,影子条目删除
 *    (原卡 cardMap[shadowOf] 仍在);
 *  - 普通牌:原 id 入堆。
 *  「牌入弃牌堆」的 apply 路径一律经 pushToDiscardPile(本函数 + push 的组合单点)——
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

/** 牌入弃牌堆(state 侧单点):经 resolveDiscardEntry 裁决真实入堆 id 后 push,
 *  裁决为 null(临时牌销毁)时不入堆。所有「牌入弃牌堆」的 apply 路径
 *  (弃置/扣牌/归还暂存牌/移动牌/置创牌/系统处理牌)必须走本单点:
 *  - 结算临时牌(八卦阵/八阵虚拟闪)是凭空生成的标记,直接入堆会让牌库永久
 *    多一张假牌,重洗后可被玩家摸起——销毁不入堆;
 *  - 转化影子卡(如武圣红牌当杀)还原为原卡 id 入堆——影子 id 直接入堆会让
 *    弃牌堆出现 cardMap 查不到的 id(重洗后同牌两个实例,摸牌/视图投影漂移);
 *  - 普通牌原样入堆。 */
export function pushToDiscardPile(state: GameState, cardId: string): void {
  const entry = resolveDiscardEntry(state, cardId);
  if (entry !== null) state.zones.discardPile.push(entry);
}

// ── 装备区重建样板(apply 与 applyView 共用) ──

/** 装备区按谓词重建(对齐 removeCardsFromHand 的集合过滤风格):
 *  返回新 Record,仅保留「id 为真值且未被 shouldRemove 命中」的槽位,原对象不变。
 *  falsy 槽位不保留(装备槽只可能「有 string id」或「键不存在」,无 null 值,
 *  delete 循环与重建等价);键顺序保持原插入顺序。
 *  仅做 Record 重建、不触碰 vars——武器离身需清距离 vars 的调用方(移出至暂存区)
 *  另行调用 clearEquipVars。 */
export function removeFromEquipment(
  equipment: Partial<Record<EquipSlot, string>>,
  shouldRemove: (id: string) => boolean,
): Partial<Record<EquipSlot, string>> {
  const kept: Record<string, string> = {};
  for (const [slot, id] of Object.entries(equipment)) {
    if (id && !shouldRemove(id)) kept[slot] = id;
  }
  return kept;
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

/** clearEquipVars 的 view 侧配对:武器槽离身时把玩家视图条目的
 *  distanceVars.attackRange 置 undefined(马匹由 移除技能 atom 的视图处理)。
 *  卸下 与 移出至暂存区 的 applyView 共用——与 state 侧 clearEquipVars 一一对应,
 *  否则徒手玩家视图仍带旧武器射程。 */
export function clearEquipViewVars(p: PlayerViewEntry, slot: EquipSlot): void {
  if (slot === '武器' && p.distanceVars) {
    p.distanceVars = {
      ...p.distanceVars,
      attackRange: undefined,
    };
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

// ── 体力增减 atom 工厂 ──

/** 体力增减 atom 的工厂(回复体力/失去体力 逐行同构,差异仅四点):
 *  - sign:+1 回复(向 maxHealth 钳制)/ -1 失去(可扣至负值,濒死由 after-hook 流程处理);
 *  - clamp:是否以 maxHealth 封顶;
 *  - effect:atom 的 fallback 展示(音效/动画各自不同);
 *  - logVerb:toViewLog 文案动词(「回复」/「失去」)。
 *  validate/toViewEvents/applyView 的行为对两者逐字一致:
 *  校验 amount>0 + target 存在 + 存活;广播 {type,target,amount};
 *  视图侧按 sign 增减 health(clamp 时封顶)。
 *  扣减体力(life-timing)不并入本工厂——其 validate 文案与 toViewEvents payload
 *  均有独立差异(错误信息带座次、事件携带按伤害点数计算的 injure_N 音效)。 */
export function makeHealthDeltaAtom<T extends { target: number; amount: number }>(
  type: string,
  opts: {
    /** 体力增减方向:+1=回复,-1=失去。 */
    sign: 1 | -1;
    /** 是否以 maxHealth 封顶(回复体力);失去体力不封顶。 */
    clamp: boolean;
    /** atom 的 fallback 展示效果。 */
    effect: AtomEffect;
    /** toViewLog 的动词(「回复」/「失去」)。 */
    logVerb: string;
  },
): AtomDefinition<T> {
  return {
    type,
    validate(state, atom) {
      if (atom.amount <= 0) return 'amount must be > 0';
      const err = requirePlayer(state, atom.target, 'target');
      if (err) return err;
      if (!state.players[atom.target].alive) return 'target is dead';
      return null;
    },
    apply(state, atom) {
      const target = state.players[atom.target];
      const next = target.health + opts.sign * atom.amount;
      target.health = opts.clamp ? Math.min(target.maxHealth, next) : next;
    },
    effect: opts.effect,
    toViewEvents(_state, atom): ViewEventSplit {
      return broadcast({ type, target: atom.target, amount: atom.amount });
    },
    applyView(view: GameView, event: ViewEvent) {
      const p = viewPlayer(view, event.target as number);
      if (!p) return;
      const delta = opts.sign * (event.amount as number);
      p.health = opts.clamp ? Math.min(p.maxHealth, p.health + delta) : p.health + delta;
    },
    toViewLog(event) {
      return { player: event.target as number, text: `${opts.logVerb} ${event.amount ?? 0} 点体力` };
    },
  };
}
