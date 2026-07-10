// src/engine/atoms/扣牌.ts
// 扣牌:于吉「蛊惑」专用——将一张手牌扣置(面朝下),声明为某张基本牌。
//
// 设计(隐藏信息):
//   - apply:手牌 → 弃牌堆(面朝下暂存)。牌的真实身份对其他人隐藏:
//     弃牌堆在 view 中仅投影数量(discardPileCount),不下发牌面/牌名,
//     故其他人只知道"于吉扣置了一张牌",不知其真身。扣牌者本人知道(由 ownerView 携带 cardId/牌面)。
//   - cardId 同步写入 localVars['蛊惑/扣牌'],声明写入 localVars['蛊惑/声明'],
//     供蛊惑 execute 后续揭示(展示 atom)/给牌(移动牌 弃牌堆→手牌)/按声明生效读取。
//
// 为什么入弃牌堆而非独立"蛊惑区":
//   弃牌堆是唯一"只投影数量、不下发身份"的公共区(处理区会下发 cardId→经 cardMap 暴露身份)。
//   面朝下扣置的牌语义上等同于"已离开手牌、身份未公开",入弃牌堆(数量+1)即可表达,
//   且后续假牌分支可直接用「移动牌」(弃牌堆→质疑者手牌)取回,无需新造"取回扣牌"atom。
//   成功(真牌/无人质疑)分支牌留在弃牌堆(即"已使用"),假牌分支牌被质疑者取走(弃牌堆-1)。
import type { AtomDefinition, ViewEventSplit, ViewEvent, Card } from '../types';
import { registerAtom } from '../atom';

export const 扣牌: AtomDefinition<{
  player: number;
  cardId: string;
  declaredName: string;
}> = {
  type: '扣牌',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    if (!state.players[atom.player].hand.includes(atom.cardId)) return `card not in hand`;
    return null;
  },
  apply(state, atom) {
    const p = state.players[atom.player];
    // 手牌 → 弃牌堆(面朝下:身份不下发,仅数量)
    p.hand = p.hand.filter((id) => id !== atom.cardId);
    state.zones.discardPile.push(atom.cardId);
    // 记录扣牌与声明,供蛊惑后续阶段读取
    state.localVars['蛊惑/扣牌'] = atom.cardId;
    state.localVars['蛊惑/声明'] = atom.declaredName;
  },
  effect: { sound: 'play_card', animation: 'flip', duration: 800 },
  toViewEvents(state, atom): ViewEventSplit {
    const card: Card | undefined = state.cardMap[atom.cardId];
    const cardInfo = card ? { name: card.name, suit: card.suit, rank: card.rank } : null;
    const effect = { sound: 'play_card' as const, animation: 'flip' as const, duration: 800 };
    // 扣牌者:看到完整牌面(知道自己扣了什么)+ 声明
    const ownerView: ViewEvent = {
      type: '扣牌',
      player: atom.player,
      cardId: atom.cardId,
      card: cardInfo,
      declaredName: atom.declaredName,
      effect,
    };
    // 其他人:只看到"于吉扣置一张牌,声明为X",不暴露真实牌面/cardId
    const othersView: ViewEvent = {
      type: '扣牌',
      player: atom.player,
      declaredName: atom.declaredName,
      effect,
    };
    return { ownerViews: new Map([[atom.player, ownerView]]), othersView };
  },
  applyView(view, event) {
    // 手牌 -1(扣牌者);若当前视角是扣牌者,精确移除 cardId
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi >= 0) {
      view.players[pi].handCount = Math.max(0, view.players[pi].handCount - 1);
      const cardId = event.cardId as string | undefined;
      if (cardId && view.players[pi].hand) {
        view.players[pi].hand = view.players[pi].hand.filter((c: Card) => c.id !== cardId);
      }
    }
    // 弃牌堆 +1(面朝下:仅数量,不下发牌面)
    if (view.zones) view.zones.discardPileCount += 1;
  },
  toViewLog(event, viewer) {
    const declared = event.declaredName as string;
    const isOwner = viewer === (event.player as number);
    if (isOwner && event.card) {
      const c = event.card as { suit: string; rank: string };
      return { player: event.player as number, text: `蛊惑:扣置 ${c.suit}${c.rank},声明为【${declared}】` };
    }
    return { player: event.player as number, text: `蛊惑:扣置一张手牌,声明为【${declared}】` };
  },
};

registerAtom(扣牌);
