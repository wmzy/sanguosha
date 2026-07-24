// src/engine/atoms/rank-timing.ts
// 拼点两步化编排时机 atom 定义(对齐 flow-redesign.md 模块 G / rankcompare.md):
//   - 拼点扣置 / 拼点亮出 / 拼点后
//   由 src/engine/rank-flow.ts 的编排函数 runRankCompareFlow 在拼点流程中依次发出。
//   与旧「拼点」atom 并存——后者保留为兼容(天义/烈刃/界巧说/界陷阵 等未迁移调用方仍用)。
//
// 三时机职责:
//   拼点扣置(实质 atom):apply 把两张拼点牌从手牌移入处理区(面朝下)。
//     toViewEvents 实现信息分级——发起方只看到自己的拼点牌牌面,目标方只看到自己的,
//     其他人两张都看不到(面朝下)。cardId 仍下发给全员(供 applyView 同步处理区/手牌数),
//     但牌面仅给各自的扣置者(参考 蛊惑 扣牌 atom 的 ownerViews 模式)。
//   拼点亮出(纯视图 atom):apply 无副作用(牌已在处理区);toViewEvents 向全员公开两张牌面。
//     参考 蛊惑 展示 atom——纯广播事件,不改持久 view。
//   拼点后(纯标记 atom):validate 恒通过、apply 无副作用,只提供 before/after hook 注册点。
//     无 before hook 时 toViewEvents 返回 null(与 damage-timing / move-timing 一致)。
import type { AtomDefinition, GameState, ViewEventSplit, ViewEvent, Card } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

/** 拼点时机 atom 的公共形状(扣置/亮出)。 */
type RankCompareAtom = {
  initiator: number;
  target: number;
  initiatorCard: string;
  targetCard: string;
};

/** 校验 initiator/target 玩家存在(纯标记视角;不校验存活/手牌——编排函数前置保证)。 */
function validateRankCompare(state: GameState, atom: RankCompareAtom): string | null {
  if (!state.players[atom.initiator]) return `initiator ${atom.initiator} not found`;
  if (!state.players[atom.target]) return `target ${atom.target} not found`;
  return null;
}

function cardFace(card: Card | undefined): { name: string; suit: string; rank: string } | null {
  return card ? { name: card.name, suit: card.suit, rank: card.rank } : null;
}

// ── 时机1:拼点扣置(两张拼点牌从手牌移入处理区,面朝下) ──────────
// apply 直接搬运(不走 移动牌 atom——后者 toViewEvents 固定广播牌面为「打出」,会破坏面朝下)。
// 处理区优先用栈顶结算帧;无帧则用 zones.processing(与 移动牌/拼点 atom 一致)。
export const 拼点扣置: AtomDefinition<RankCompareAtom> = {
  type: '拼点扣置',
  validate: validateRankCompare,
  apply(state, atom) {
    const frame = state.settlementStack[state.settlementStack.length - 1];
    const dest = frame ? frame.cards : state.zones.processing;
    const moves: Array<{ player: number; cardId: string }> = [
      { player: atom.initiator, cardId: atom.initiatorCard },
      { player: atom.target, cardId: atom.targetCard },
    ];
    for (const { player, cardId } of moves) {
      if (!cardId) continue;
      const p = state.players[player];
      if (!p) continue;
      p.hand = p.hand.filter((id) => id !== cardId);
      dest.push(cardId);
    }
  },
  effect: { sound: 'play_card', animation: 'flip', duration: 800 },
  toViewEvents(state, atom): ViewEventSplit {
    const initFace = cardFace(state.cardMap[atom.initiatorCard]);
    const tgtFace = cardFace(state.cardMap[atom.targetCard]);
    const effect = { sound: 'play_card' as const, animation: 'flip' as const, duration: 800 };
    const base = {
      type: '拼点扣置',
      initiator: atom.initiator,
      target: atom.target,
      // cardId 下发给全员:applyView 据此同步手牌数与处理区。
      initiatorCard: atom.initiatorCard,
      targetCard: atom.targetCard,
      effect,
    };
    // 发起方:只看到自己的拼点牌牌面(目标牌面朝下)
    const initiatorView: ViewEvent = { ...base, initiatorCardFace: initFace };
    // 目标方:只看到自己的拼点牌牌面(发起方牌面朝下)
    const targetView: ViewEvent = { ...base, targetCardFace: tgtFace };
    // 其他人:两张牌都面朝下(无 *CardFace 字段)
    const othersView: ViewEvent = { ...base };
    return {
      ownerViews: new Map([
        [atom.initiator, initiatorView],
        [atom.target, targetView],
      ]),
      othersView,
    };
  },
  applyView(view, event) {
    const initiator = event.initiator as number;
    const target = event.target as number;
    const initiatorCard = event.initiatorCard as string;
    const targetCard = event.targetCard as string;
    // 双方各从手牌移除一张(handCount -1 + 按 cardId 精确过滤)
    const removeOne = (playerIdx: number, cardId: string): void => {
      const pi = view.players.findIndex((p) => p.index === playerIdx);
      if (pi < 0) return;
      view.players[pi].handCount = Math.max(0, view.players[pi].handCount - 1);
      if (cardId && view.players[pi].hand) {
        view.players[pi].hand = view.players[pi].hand.filter((c: Card) => c.id !== cardId);
      }
    };
    removeOne(initiator, initiatorCard);
    removeOne(target, targetCard);
    // 两张牌入处理区(settlementStack 顶帧 + zones.processing 双写,与 移动牌「打出」对称)
    if (view.zones) {
      if (initiatorCard) view.zones.processing.push(initiatorCard);
      if (targetCard) view.zones.processing.push(targetCard);
    }
    const f = view.settlementStack[view.settlementStack.length - 1];
    if (f) {
      if (initiatorCard) f.cards.push(initiatorCard);
      if (targetCard) f.cards.push(targetCard);
    }
  },
  toViewLog(event, viewer) {
    const initiator = event.initiator as number;
    const target = event.target as number;
    const myFace =
      viewer === initiator
        ? (event.initiatorCardFace as { suit: string; rank: string } | undefined)
        : viewer === target
          ? (event.targetCardFace as { suit: string; rank: string } | undefined)
          : undefined;
    if (myFace) {
      return { player: initiator, text: `拼点:扣置 ${myFace.suit}${myFace.rank}(面朝下)` };
    }
    return { player: initiator, text: '拼点:扣置一张牌(面朝下)' };
  },
};

registerAtom(拼点扣置);

// ── 时机2:拼点亮出(同时亮出两张拼点牌,全员公开牌面) ──────────
// 纯视图 atom:牌已在处理区(由 拼点扣置 移入),apply 无副作用。
// toViewEvents 向全员广播两张牌的牌面(参考 蛊惑 展示 atom)。
export const 拼点亮出: AtomDefinition<RankCompareAtom> = {
  type: '拼点亮出',
  validate: validateRankCompare,
  apply() {
    // no-op:牌已在处理区,亮出只广播牌面。
  },
  effect: { sound: 'flip', animation: 'flip', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '拼点亮出',
      initiator: atom.initiator,
      target: atom.target,
      initiatorCard: atom.initiatorCard,
      targetCard: atom.targetCard,
      initiatorCardFace: cardFace(state.cardMap[atom.initiatorCard]),
      targetCardFace: cardFace(state.cardMap[atom.targetCard]),
      effect: { sound: 'flip', animation: 'flip', duration: 600 },
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // no-op:处理区在 view 中只投影 cardId(牌面不持久化);亮出是一次性广播事件。
  },
  toViewLog(event) {
    const iFace = event.initiatorCardFace as { suit: string; rank: string } | undefined;
    const tFace = event.targetCardFace as { suit: string; rank: string } | undefined;
    const initiator = event.initiator as number;
    const target = event.target as number;
    const iStr = iFace ? `${iFace.suit}${iFace.rank}` : '?';
    const tStr = tFace ? `${tFace.suit}${tFace.rank}` : '?';
    return { player: initiator, text: `拼点亮出:${iStr} vs ${tStr}(目标 ${target})` };
  },
};

registerAtom(拼点亮出);

// ── 时机3:拼点后(纯标记,after-hook 触发拼点后效果) ────────────
// result 由编排函数确定后透传('赢'/'没赢'),供 拼点后 hook 读取。
// 携带 initiatorCard/targetCard:钩子(酣战获杀/纵适获牌)据此定位拼点牌(在弃牌堆中)。
// 无 before hook 时静默(no-op 视图),与 damage-timing / move-timing 一致。
export const 拼点后: AtomDefinition<{
  initiator: number;
  target: number;
  initiatorCard: string;
  targetCard: string;
  result: '赢' | '没赢';
}> = {
  type: '拼点后',
  validate(state, atom) {
    if (!state.players[atom.initiator]) return `initiator ${atom.initiator} not found`;
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {},
  toViewEvents(state, atom): ViewEventSplit {
    if (getBeforeHooks(state, '拼点后').length === 0) {
      return { ownerViews: new Map(), othersView: null };
    }
    const view: ViewEvent = {
      type: '拼点后',
      initiator: atom.initiator,
      target: atom.target,
      initiatorCard: atom.initiatorCard,
      targetCard: atom.targetCard,
      result: atom.result,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {},
};

registerAtom(拼点后);
