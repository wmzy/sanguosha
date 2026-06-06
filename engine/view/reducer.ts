// engine/view/reducer.ts — FrontendState reducer
//
// 客户端把服务器推送的 events 序列应用到本地 FrontendState 上，得到最新视图。
// 这是事件溯源风格：初始快照 + 事件流 = 当前状态。

import type { GameState, PlayerEvent, ServerEvent, Json, Mark } from '../types';
import type { FrontendState, PlayerView, Animation, CardInfo } from './types';
import { isPendingAction } from '../../shared/typeGuards';
import { clonePlayerView } from './buildView';

type P = Record<string, unknown> & { zone?: ZoneRef['zone'] };

export function reduceFrontend(fe: FrontendState, events: PlayerEvent[]): FrontendState {
  const view = clonePlayerView(fe.view);
  const animationQueue = [...fe.animationQueue];
  for (const event of events) {
    applyEvent({ view, animationQueue, myPlayerId: fe.myPlayerId }, event);
  }
  return { view, myPlayerId: fe.myPlayerId, animationQueue };
}

export function reduceGameState(state: GameState, events: ServerEvent[]): GameState {
  let next = state;
  for (const event of events) {
    next = applyGameStateEvent(next, event);
  }
  return next;
}

/** 把 events 序列转换为动画队列（不修改 FrontendState）。 */
export function eventsToAnimations(myPlayerId: string, events: PlayerEvent[]): Animation[] {
  const result: Animation[] = [];
  for (const event of events) {
    const p = (event.payload ?? {}) as Record<string, unknown>;
    const anim = mapEvent(event.type, p);
    if (anim) result.push(anim);
  }
  return result;
}

function mapEvent(type: string, p: Record<string, unknown>): Animation | null {
  switch (type) {
    case 'damage':
      return { type: 'damagePopup', target: (p.target ?? '') as string, amount: (p.amount ?? 0) as number };
    case 'heal':
      return { type: 'healGlow', target: (p.target ?? '') as string, amount: (p.amount ?? 0) as number };
    case 'draw':
      return { type: 'drawCards', player: (p.player ?? '') as string, count: (p.count ?? 0) as number };
    case 'discard':
      return { type: 'discardCards', player: (p.player ?? '') as string, cardIds: (p.cardIds ?? []) as string[] };
    case 'gainCard':
      return {
        type: 'cardMove',
        cardId: ((p.cardId ?? (p.card as Record<string, unknown> | undefined)?.id) ?? '') as string,
        from: (p.from ?? { zone: 'discardPile' }) as { zone: string; player?: string },
        to: { zone: 'hand', player: (p.player ?? '') as string },
        duration: 300,
      };
    case 'equip':
      return { type: 'equipItem', player: (p.player ?? '') as string, cardId: (p.cardId ?? '') as string, slot: (p.slot ?? '') as string };
    case 'kill':
      return { type: 'death', player: ((p.player ?? p.target) ?? '') as string };
    case 'pushPending':
      return { type: 'pendingPrompt', actionType: ((p.type ?? '') as string) };
    case 'judge':
      return { type: 'cardFlip', cardId: ((p.cardId ?? '') as string) };
    case 'moveCard':
      return {
        type: 'cardMove',
        cardId: (p.cardId ?? '') as string,
        from: p.from as { zone: string; player?: string },
        to: p.to as { zone: string; player?: string },
        duration: 300,
      };
    case 'nextPlayer':
      return { type: 'nextPlayer', player: (p.player ?? '') as string };
    case 'addPendingTrick':
      return { type: 'pendingPrompt', actionType: 'addPendingTrick' };
    case 'removePendingTrick':
      return { type: 'trickReveal', cardId: ((p.cardId ?? '') as string), result: ((p.result ?? 'success') as 'success' | 'fail') };
    default:
      return null;
  }
}

interface ReducerCtx {
  view: PlayerView;
  animationQueue: Animation[];
  myPlayerId: string;
}

function applyEvent(ctx: ReducerCtx, event: PlayerEvent): void {
  const { type, payload } = event;
  const p = (payload ?? {}) as P;
  const myId = ctx.myPlayerId;
  const view = ctx.view;
  const self = view.self;
  const others = view.others;

  switch (type) {
    // ─── damage ───────────────────────────────────────────
    case 'damage': {
      const target = p.target as string;
      const amount = p.amount as number;
      if (target === myId) {
        self.health -= amount;
      } else if (others[target]) {
        others[target].health -= amount;
      }
      ctx.animationQueue.push({ type: 'damagePopup', target, amount });
      break;
    }

    // ─── heal ─────────────────────────────────────────────
    case 'heal': {
      const target = p.target as string;
      const amount = p.amount as number;
      if (target === myId) {
        self.health = Math.min(self.health + amount, self.maxHealth);
      } else if (others[target]) {
        others[target].health = Math.min(others[target].health + amount, others[target].maxHealth);
      }
      ctx.animationQueue.push({ type: 'healGlow', target, amount });
      break;
    }

    // ─── draw ─────────────────────────────────────────────
    case 'draw': {
      const player = p.player as string;
      const count = p.count as number;
      if (player === myId) {
        const cards = p.cards as CardInfo[] | undefined;
        if (cards) self.hand.push(...cards);
      } else if (others[player]) {
        others[player].handCount += count;
      }
      ctx.animationQueue.push({ type: 'drawCards', player, count });
      break;
    }

    // ─── discard ──────────────────────────────────────────
    case 'discard':
    case 'cardsDiscarded': {
      const player = p.player as string;
      const cardIds = p.cardIds as string[] | undefined;
      const count = p.count as number | undefined;
      if (player === myId && cardIds) {
        const idSet = new Set(cardIds);
        self.hand = self.hand.filter(c => !idSet.has(c.id));
      } else if (player === myId && count != null) {
        self.hand = self.hand.slice(0, self.hand.length - count);
      } else if (others[player]) {
        others[player].handCount -= (count ?? cardIds?.length ?? 0);
      }
      ctx.animationQueue.push({
        type: 'discardCards',
        player,
        cardIds: cardIds ?? [],
      });
      break;
    }

    // ─── gainCard ─────────────────────────────────────────
    case 'gainCard':
    case 'cardGained': {
      const player = p.player as string;
      const from = p.from as P | undefined;
      if (player === myId) {
        const card = p.card as CardInfo | undefined;
        if (card) self.hand.push(card);
      } else if (others[player]) {
        others[player].handCount++;
      }
      ctx.animationQueue.push({
        type: 'cardMove',
        cardId: (p.cardId ?? '') as string,
        from: (from ?? { zone: 'unknown' }) as Animation extends { type: 'cardMove' } ? Animation['from'] : never,
        to: { zone: 'hand', player },
        duration: 300,
      });
      break;
    }

    // ─── equip ────────────────────────────────────────────
    // ─── equip ────────────────────────────────────────────
    case 'equip': {
      const player = p.player as string;
      const cardId = p.cardId as string;
      const slot = (p.slot ?? '') as 'weapon' | 'armor' | 'mount';
      if (player === myId) {
        const cardIdx = self.hand.findIndex(c => c.id === cardId);
        if (cardIdx !== -1) {
          const [card] = self.hand.splice(cardIdx, 1);
          const previousCard = self.equipment[slot];
          if (previousCard) view.table.discardPileCount++;
          self.equipment = { ...self.equipment, [slot]: card };
        }
      } else if (others[player]) {
        others[player].equipment = { ...others[player].equipment, [slot]: cardId };
      }
      ctx.animationQueue.push({ type: 'equipItem', player, cardId, slot });
      break;
    }

    // ─── kill ─────────────────────────────────────────────
    case 'kill': {
      const player = p.player as string;
      if (player === myId) {
        self.health = 0;
        self.alive = false;
        self.equipment = { weapon: null, armor: null, mount: null };
      } else if (others[player]) {
        others[player].health = 0;
        others[player].alive = false;
        others[player].equipment = { weapon: null, armor: null, mount: null };
      }
      ctx.animationQueue.push({ type: 'death', player });
      break;
    }

    // ─── setPhase ─────────────────────────────────────────
    case 'setPhase': {
      view.turn.phase = p.phase as string;
      break;
    }

    // ─── nextPlayer ───────────────────────────────────────
    case 'nextPlayer': {
      const player = (p.player ?? p.to) as string;
      view.turn.currentPlayer = player;
      view.turn.phase = '准备';
      ctx.animationQueue.push({ type: 'nextPlayer', player });
      break;
    }

    // ─── pushPending ──────────────────────────────────────
    case 'pushPending': {
      const actionType = (p.actionType ?? p.type ?? 'pushPending') as string;
      ctx.animationQueue.push({ type: 'pendingPrompt', actionType });
      break;
    }

    // ─── popPending ───────────────────────────────────────
    case 'popPending': {
      view.pending = null;
      break;
    }

    // ─── judge ────────────────────────────────────────────
    case 'judge': {
      view.table.discardPileCount++;
      ctx.animationQueue.push({ type: 'cardFlip', cardId: (p.cardId ?? '') as string });
      break;
    }

    // ─── moveCard / cardMoved ─────────────────────────────
    case 'moveCard':
    case 'cardMoved': {
      const to = p.to as P | undefined;
      const from = p.from as P | undefined;
      if (to?.zone === 'discardPile') view.table.discardPileCount++;
      if (from?.zone === 'discardPile') {
        view.table.discardPileCount = Math.max(0, view.table.discardPileCount - 1);
      }
      ctx.animationQueue.push({
        type: 'cardMove',
        cardId: (p.cardId ?? '') as string,
        from: (from ?? { zone: 'unknown' }) as Animation extends { type: 'cardMove' } ? Animation['from'] : never,
        to: (to ?? { zone: 'unknown' }) as Animation extends { type: 'cardMove' } ? Animation['to'] : never,
        duration: 300,
      });
      break;
    }

    // ─── addTag ───────────────────────────────────────────
    case 'addTag': {
      const player = p.player as string;
      if (player === myId) self.tags.push(p.tag as string);
      break;
    }

    // ─── removeTag ────────────────────────────────────────
    case 'removeTag': {
      const player = p.player as string;
      if (player === myId) self.tags = self.tags.filter(t => t !== (p.tag as string));
      break;
    }

    // ─── setVar ───────────────────────────────────────────
    case 'setVar': {
      const player = p.player as string;
      if (player === myId) self.vars[p.key as string] = p.value;
      break;
    }

    // ─── addPendingTrick ──────────────────────────────────
    case 'addPendingTrick': {
      const player = p.player as string;
      if (player === myId) {
        self.pendingTricks.push(p.trick as PlayerView['self']['pendingTricks'][number]);
      }
      ctx.animationQueue.push({ type: 'pendingPrompt', actionType: 'addPendingTrick' });
      break;
    }

    // ─── removePendingTrick ───────────────────────────────
    case 'removePendingTrick': {
      const player = p.player as string;
      const index = p.index as number;
      let removedCardId = p.cardId as string | undefined;
      if (player === myId && index >= 0 && index < self.pendingTricks.length) {
        removedCardId ??= self.pendingTricks[index].cardId;
        self.pendingTricks.splice(index, 1);
      }
      ctx.animationQueue.push({
        type: 'trickReveal',
        cardId: removedCardId ?? '',
        result: (p.result ?? 'fail') as 'success' | 'fail',
      });
      break;
    }

    // ─── rearrangeDeck ────────────────────────────────────
    case 'rearrangeDeck': {
      break;
    }

    // ─── turnStart ────────────────────────────────────────
    case 'turnStart': {
      view.turn.currentPlayer = p.player as string;
      break;
    }

    // ─── skillActivate ────────────────────────────────────
    case 'skillActivate': {
      ctx.animationQueue.push({
        type: 'skillActivate',
        player: p.player as string,
        skillId: p.skillId as string,
      });
      break;
    }

    default:
      break;
  }
}

function applyGameStateEvent(state: GameState, event: ServerEvent): GameState {
  const p = (event.payload ?? {}) as P;
  switch (event.type) {
    case 'damage': {
      const target = p.target as string;
      const amount = p.amount as number;
      const player = state.players[target];
      if (!player) return state;
      return { ...state, players: { ...state.players, [target]: { ...player, health: player.health - amount } } };
    }
    case 'heal': {
      const target = p.target as string;
      const amount = p.amount as number;
      const player = state.players[target];
      if (!player) return state;
      return { ...state, players: { ...state.players, [target]: { ...player, health: Math.min(player.health + amount, player.maxHealth) } } };
    }
    case 'draw': {
      const player = p.player as string;
      const count = p.count as number;
      const cards = p.cards as string[] | undefined;
      const pState = state.players[player];
      if (!pState) return state;
      const drawn = cards ?? state.zones.deck.slice(0, count);
      const newDeck = cards
        ? state.zones.deck.filter(id => !drawn.includes(id))
        : state.zones.deck.slice(drawn.length);
      return {
        ...state,
        zones: { ...state.zones, deck: newDeck },
        players: { ...state.players, [player]: { ...pState, hand: [...pState.hand, ...drawn] } },
      };
    }
    case 'discard':
    case 'cardsDiscarded':
    case 'cardDiscarded': {
      const player = p.player as string;
      const cardIds = p.cardIds as string[] | undefined;
      const count = p.count as number | undefined;
      const pState = state.players[player];
      if (!pState) return state;
      if (cardIds) {
        const set = new Set(cardIds);
        return { ...state, players: { ...state.players, [player]: { ...pState, hand: pState.hand.filter(id => !set.has(id)) } }, zones: { ...state.zones, discardPile: [...state.zones.discardPile, ...cardIds] } };
      }
      if (count != null) {
        const removed = pState.hand.slice(0, count);
        return { ...state, players: { ...state.players, [player]: { ...pState, hand: pState.hand.slice(count) } }, zones: { ...state.zones, discardPile: [...state.zones.discardPile, ...removed] } };
      }
      return state;
    }
    case 'moveCard':
    case 'cardMoved': {
      const cardId = p.cardId as string;
      const from = p.from as P | undefined;
      const to = p.to as P | undefined;
      if (!from || !to) return state;
      return moveCardInState(state, cardId, from, to);
    }
    case 'equip': {
      const player = p.player as string;
      const cardId = p.cardId as string;
      const slot = (p.slot ?? inferEquipSlot(state, cardId)) as keyof GameState['players'][string]['equipment'] | undefined;
      const pState = state.players[player];
      if (!pState || !slot) return state;
      const newHand = pState.hand.filter(id => id !== cardId);
      return { ...state, players: { ...state.players, [player]: { ...pState, hand: newHand, equipment: { ...pState.equipment, [slot]: cardId } } } };
    }
    case 'unequip': {
      const player = p.player as string;
      const slot = p.slot as keyof GameState['players'][string]['equipment'];
      const pState = state.players[player];
      if (!pState) return state;
      const cardId = pState.equipment[slot];
      return {
        ...state,
        players: {
          ...state.players,
          [player]: {
            ...pState,
            equipment: { ...pState.equipment, [slot]: undefined },
            hand: cardId ? [...pState.hand, cardId] : pState.hand,
          },
        },
      };
    }
    case 'setVar': {
      const player = p.player as string;
      const key = p.key as string;
      const value = p.value as Json;
      const pState = state.players[player];
      if (!pState) return state;
      return { ...state, players: { ...state.players, [player]: { ...pState, vars: { ...pState.vars, [key]: value } } } };
    }
    case 'incrementVar': {
      const player = p.player as string;
      const key = p.key as string;
      const delta = p.delta as number;
      const pState = state.players[player];
      if (!pState) return state;
      const current = (pState.vars[key] as number) ?? 0;
      return { ...state, players: { ...state.players, [player]: { ...pState, vars: { ...pState.vars, [key]: current + delta } } } };
    }
    case 'clearVarPattern': {
      const player = p.player as string;
      const pattern = p.pattern as string;
      const pState = state.players[player];
      if (!pState) return state;
      try {
        const re = new RegExp(pattern);
        const newVars = Object.fromEntries(Object.entries(pState.vars).filter(([k]) => !re.test(k)));
        return { ...state, players: { ...state.players, [player]: { ...pState, vars: newVars } } };
      } catch {
        return state;
      }
    }
    case 'pushPending': {
      if (!isPendingAction(event.payload)) return state;
      return { ...state, pending: event.payload };
    }
    case 'popPending': {
      return { ...state, pending: null };
    }
    case 'setPhase': {
      const phase = p.phase as GameState['phase'];
      return { ...state, phase };
    }
    case 'nextPlayer': {
      const to = (p.to ?? p.player) as string;
      const round = p.round as number | undefined;
      return {
        ...state,
        currentPlayer: to,
        turn: { ...state.turn, killsPlayed: 0, skillsUsed: [], turnStarted: false },
        meta: {
          ...state.meta,
          turnNumber: state.meta.turnNumber + 1,
          ...(round != null ? { round } : {}),
        },
      };
    }
    case 'judge': {
      if (state.zones.deck.length === 0) return state;
      const cardId = state.zones.deck[state.zones.deck.length - 1];
      return {
        ...state,
        zones: {
          ...state.zones,
          deck: state.zones.deck.slice(0, -1),
          discardPile: [...state.zones.discardPile, cardId],
        },
      };
    }
    case 'addPendingTrick': {
      const player = p.player as string;
      const trick = p.trick as GameState['players'][string]['pendingTricks'][number];
      const pState = state.players[player];
      if (!pState) return state;
      return { ...state, players: { ...state.players, [player]: { ...pState, pendingTricks: [...pState.pendingTricks, trick] } } };
    }
    case 'removePendingTrick': {
      const player = p.player as string;
      const index = p.index as number;
      const pState = state.players[player];
      if (!pState) return state;
      if (index < 0 || index >= pState.pendingTricks.length) return state;
      const removed = pState.pendingTricks[index];
      return {
        ...state,
        players: { ...state.players, [player]: { ...pState, pendingTricks: pState.pendingTricks.filter((_, i) => i !== index) } },
        zones: { ...state.zones, discardPile: removed ? [...state.zones.discardPile, removed.card.id] : state.zones.discardPile },
      };
    }
    case 'addTag': {
      const player = p.player as string;
      const tag = p.tag as string;
      const pState = state.players[player];
      if (!pState || pState.tags.includes(tag)) return state;
      return { ...state, players: { ...state.players, [player]: { ...pState, tags: [...pState.tags, tag] } } };
    }
    case 'removeTag': {
      const player = p.player as string;
      const tag = p.tag as string;
      const pState = state.players[player];
      if (!pState) return state;
      return { ...state, players: { ...state.players, [player]: { ...pState, tags: pState.tags.filter(t => t !== tag) } } };
    }
    case 'kill': {
      const player = p.player as string;
      const pState = state.players[player];
      if (!pState) return state;
      return { ...state, players: { ...state.players, [player]: { ...pState, info: { ...pState.info, alive: false } } } };
    }
    case 'gainCard':
    case 'cardGained': {
      const player = p.player as string;
      const cardId = (p.cardId ?? (p.card as P | undefined)?.id) as string | undefined;
      const pState = state.players[player];
      if (!pState || !cardId) return state;
      return { ...state, players: { ...state.players, [player]: { ...pState, hand: [...pState.hand, cardId] } } };
    }
    case 'incrementKills': {
      return { ...state, turn: { ...state.turn, killsPlayed: state.turn.killsPlayed + 1 } };
    }
    case 'rearrangeDeck': {
      const topCardIds = p.topCardIds as string[] | undefined;
      const bottomCardIds = p.bottomCardIds as string[] | undefined;
      const newDeck = [...(topCardIds ?? state.zones.deck), ...(bottomCardIds ?? [])];
      return { ...state, zones: { ...state.zones, deck: newDeck } };
    }
    case 'turnStart': {
      const player = p.player as string;
      return { ...state, currentPlayer: player, turn: { ...state.turn, killsPlayed: 0, skillsUsed: [], turnStarted: false } };
    }
    // reshuffle 是服务端副作用（牌堆→弃牌堆洗回牌堆），已被后续 draw 事件的
    // payload 携带的 cards 隐式覆盖；前端不需要在此重放 rngState/deck 改动。
    // 跳过而非 fallthrough 到 default，能让后续 state-changes（draw/等）继续生效。
    case 'reshuffle': {
      return state;
    }
    case 'loseHealth': {
      const target = p.target as string;
      const amount = p.amount as number;
      const pState = state.players[target];
      if (!pState) return state;
      return { ...state, players: { ...state.players, [target]: { ...pState, health: Math.max(0, pState.health - amount) } } };
    }
    case 'loseCard': {
      // payload: { cardId, from: { zone, player, slot? } }
      const cardId = p.cardId as string;
      const from = p.from as { zone: 'hand' | 'equipment'; player: string; slot?: string };
      const player = from.player;
      const pState = state.players[player];
      if (!pState) return state;
      if (from.zone === 'hand') {
        if (!pState.hand.includes(cardId)) return state;
        const after = { ...state, players: { ...state.players, [player]: { ...pState, hand: pState.hand.filter(id => id !== cardId) } } };
        return { ...after, zones: { ...after.zones, discardPile: [...after.zones.discardPile, cardId] } };
      }
      if (from.zone === 'equipment' && from.slot) {
        if ((pState.equipment as Record<string, string | undefined>)[from.slot] !== cardId) return state;
        const after = { ...state, players: { ...state.players, [player]: { ...pState, equipment: { ...pState.equipment, [from.slot]: undefined } } } };
        return { ...after, zones: { ...after.zones, discardPile: [...after.zones.discardPile, cardId] } };
      }
      return state;
    }
    case 'removeSkill': {
      // payload: { player, skillId }
      const player = p.player as string;
      const skillId = p.skillId as string;
      return { ...state, triggers: state.triggers.filter(t => !(t.player === player && t.skillId === skillId)) };
    }
    case 'setChained': {
      const target = p.target as string;
      const chained = p.chained as boolean;
      const pState = state.players[target];
      if (!pState) return state;
      return { ...state, players: { ...state.players, [target]: { ...pState, chained } } };
    }
    case 'addMark': {
      const player = p.player as string;
      const mark = p.mark as Mark;
      const current = state.marks[player] ?? [];
      const filtered = current.filter(m => m.id !== mark.id);
      return { ...state, marks: { ...state.marks, [player]: [...filtered, mark] } };
    }
    case 'removeMark': {
      const player = p.player as string;
      const markId = p.markId as string;
      const current = state.marks[player] ?? [];
      return { ...state, marks: { ...state.marks, [player]: current.filter(m => m.id !== markId) } };
    }
    case 'clearExpiredMarks': {
      const phase = p.phase as string;
      const next: GameState['marks'] = {};
      for (const [player, marks] of Object.entries(state.marks)) {
        const kept = marks.filter(m => {
          if (m.duration === 'permanent') return true;
          if (m.duration === 'untilTurnEnd' && phase === 'turnEnd') return false;
          if (m.duration === 'untilPhaseEnd' && m.scope === 'relation') {
            return phase !== 'turnEnd';
          }
          return true;
        });
        next[player] = kept;
      }
      return { ...state, marks: next };
    }
    case 'shuffleDeck': {
      // 服务端 rng 推进；前端仅刷新 deck 内容（保持 multiset 不变）。
      // 实际 deck 内容由后续 draw/discard/loseCard 事件携带的 cardId 隐式重构。
      // reducer 不维护 rngState，因此本 case 为 no-op。
      return state;
    }
    default:
      return state;
  }
}

interface ZoneRef {
  zone: 'hand' | 'deck' | 'discardPile' | 'equipment' | 'pendingTricks';
  player?: string;
  index?: number;
  slot?: keyof GameState['players'][string]['equipment'];
}

function moveCardInState(state: GameState, cardId: string, from: P, to: P): GameState {
  const fromRef = from as ZoneRef;
  const toRef = to as ZoneRef;
  let stateAfterRemove = removeFromZone(state, cardId, fromRef);
  let stateAfterAdd = addToZone(stateAfterRemove, cardId, toRef);
  return stateAfterAdd;
}

function removeFromZone(state: GameState, cardId: string, ref: ZoneRef): GameState {
  if (ref.zone === 'hand' && ref.player) {
    const p = state.players[ref.player];
    if (!p) return state;
    return { ...state, players: { ...state.players, [ref.player]: { ...p, hand: p.hand.filter(id => id !== cardId) } } };
  }
  if (ref.zone === 'equipment' && ref.player && ref.slot) {
    const p = state.players[ref.player];
    if (!p) return state;
    return { ...state, players: { ...state.players, [ref.player]: { ...p, equipment: { ...p.equipment, [ref.slot]: undefined } } } };
  }
  if (ref.zone === 'deck') {
    return { ...state, zones: { ...state.zones, deck: state.zones.deck.filter(id => id !== cardId) } };
  }
  if (ref.zone === 'discardPile') {
    return { ...state, zones: { ...state.zones, discardPile: state.zones.discardPile.filter(id => id !== cardId) } };
  }
  if (ref.zone === 'pendingTricks' && ref.player && ref.index != null) {
    const p = state.players[ref.player];
    if (!p) return state;
    return { ...state, players: { ...state.players, [ref.player]: { ...p, pendingTricks: p.pendingTricks.filter((_, i) => i !== ref.index) } } };
  }
  return state;
}

function addToZone(state: GameState, cardId: string, ref: ZoneRef): GameState {
  if (ref.zone === 'hand' && ref.player) {
    const p = state.players[ref.player];
    if (!p) return state;
    return { ...state, players: { ...state.players, [ref.player]: { ...p, hand: [...p.hand, cardId] } } };
  }
  if (ref.zone === 'equipment' && ref.player && ref.slot) {
    const p = state.players[ref.player];
    if (!p) return state;
    return { ...state, players: { ...state.players, [ref.player]: { ...p, equipment: { ...p.equipment, [ref.slot]: cardId } } } };
  }
  if (ref.zone === 'deck') {
    return { ...state, zones: { ...state.zones, deck: [...state.zones.deck, cardId] } };
  }
  if (ref.zone === 'discardPile') {
    return { ...state, zones: { ...state.zones, discardPile: [...state.zones.discardPile, cardId] } };
  }
  if (ref.zone === 'pendingTricks' && ref.player) {
    const p = state.players[ref.player];
    if (!p) return state;
    const card = state.cardMap[cardId];
    if (!card) return state;
    const trick = { name: card.name, source: '', card };
    return { ...state, players: { ...state.players, [ref.player]: { ...p, pendingTricks: [...p.pendingTricks, trick] } } };
  }
  return state;
}

function inferEquipSlot(state: GameState, cardId: string): keyof GameState['players'][string]['equipment'] | undefined {
  const card = state.cardMap[cardId];
  if (!card) return undefined;
  const name = card.name;
  if (['诸葛连弩', '雌雄双股剑', '贯石斧', '青龙偃月刀', '丈八蛇矛', '古锭刀', '麒麟弓'].includes(name)) return 'weapon';
  if (['八卦阵', '仁王盾', '藤甲', '白银狮子', '寒冰甲'].includes(name)) return 'armor';
  if (name === '的卢' || name === '绝影') return 'horsePlus';
  if (name === '爪黄飞电' || name === '大宛') return 'horseMinus';
  return undefined;
}
