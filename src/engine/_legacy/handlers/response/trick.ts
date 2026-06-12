// @ts-nocheck
// engine/handlers/response/trick.ts — 锦囊牌响应 + 效果执行
//
// 处理过河拆桥/顺手牵羊/决斗/乐不思蜀/兵粮寸断/无中生有/桃园结义/五谷丰登等。
// 包含无懈可击的并发抢占响应（depth 奇偶判定）和判定阶段处理。

import type {
  GameState, GameAction, EngineResult, Atom, PendingResponseWindow,
  PendingSelectCard, PendingHarvestSelection,
} from '../../types';
import { TIMEOUT_DEFAULTS } from '../../types';
import { getPlayer, getAlivePlayerNames } from '../../state';
import { makeLogEntry } from '../../event';
import { applyAtoms } from '../../atom';
import { createPendingId } from '../../atoms/pending';
import { startAoeTargetWuxie, executeAoeResume } from './aoe';

/** 创建抢占式（并发）无懈可击响应窗口。 */
export function createConcurrentTrickResponse(
  state: GameState,
  params: {
    sourceCard: string;
    attacker: string;
    trickTarget?: string;
    responders: string[];
    depth?: number;
    wuxieChain?: { attacker: string; cardId: string }[];
    sourceUser?: string;
    judgmentContext?: { player: string; trickIndex: number };
    aoeResume?: { attacker: string; remainingTargets: string[]; requiredCard: string; sourceCard: string };
  },
): PendingResponseWindow {
  const { sourceCard, attacker, trickTarget, responders, depth, wuxieChain, sourceUser, judgmentContext, aoeResume } = params;
  const timeout = TIMEOUT_DEFAULTS.trickResponse;
  const defender = responders[0];
  const defenderPlayer = getPlayer(state, defender);
  const validCards = defenderPlayer.hand.filter(id => state.cardMap[id]?.name === '无懈可击');

  return {
    id: createPendingId(),
    type: '响应窗口',
    window: {
      type: 'trickResponse',
      attacker,
      defender,
      validCards,
      sourceCard,
      trickTarget,
      sourceUser: sourceUser ?? attacker,
      responders,
      passedResponders: [],
      depth: depth ?? 0,
      wuxieChain: wuxieChain ?? [],
      judgmentContext,
      aoeResume,
      timeout,
      deadline: Date.now() + timeout,
    },
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: '打出', player: defender },
  };
}

export function resolveTrickResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  if (action.type !== '打出') {
    return { state, logEntries: [], error: '锦囊响应窗口需要 respond 动作' };
  }

  const responders = pending.window.responders;
  if (responders && responders.length > 0) {
    return resolveConcurrentTrickResponse(state, action, pending);
  }
  return resolveLegacyTrickResponse(state, action, pending);
}

function resolveConcurrentTrickResponse(
  state: GameState,
  action: GameAction & { type: '打出' },
  pending: PendingResponseWindow,
): EngineResult {
  const { responders, passedResponders, depth, sourceCard, attacker, trickTarget, wuxieChain, sourceUser, judgmentContext, aoeResume } = pending.window;
  const currentDepth = depth ?? 0;
  const currentChain = wuxieChain ?? [];
  const sourceUserName = sourceUser ?? attacker;

  if (!responders || responders.length === 0) {
    return { state, logEntries: [], error: 'trickResponse 并发模式缺少 responders' };
  }

  const currentPassed = passedResponders ?? [];

  if (!responders.includes(action.player)) {
    return { state, logEntries: [], error: '你不是可响应的玩家' };
  }
  if (currentPassed.includes(action.player)) {
    return { state, logEntries: [], error: '你已经 pass 了' };
  }

  // 出了无懈可击
  if (action.cardId) {
    const card = state.cardMap[action.cardId];
    if (card?.name !== '无懈可击') {
      return { state, logEntries: [], error: '只能用无懈可击响应锦囊' };
    }
    const responder = getPlayer(state, action.player);
    if (!responder.hand.includes(action.cardId)) {
      return { state, logEntries: [], error: '手牌中没有该卡牌' };
    }

    state = applyAtoms(state, [
      {
        type: '移动牌',
        cardId: action.cardId,
        from: { zone: '手牌', player: action.player },
        to: { zone: '弃牌堆' },
      },
      { type: '弹出待定' },
    ]).state;

    // 嵌套 trickResponse：询问其他人是否对这张无懈可击再出无懈可击
    const aliveOthers = getAlivePlayerNames(state).filter(p => p !== action.player);
    const nextChain = [...currentChain, { attacker: action.player, cardId: action.cardId }];

    if (aliveOthers.length === 0) {
      return resolveTrickResolution(state, currentDepth + 1, sourceCard!, attacker!, trickTarget, judgmentContext, aoeResume);
    }

    const nestedPending = createConcurrentTrickResponse(state, {
      sourceCard: sourceCard!,
      attacker: action.player,
      trickTarget,
      sourceUser: sourceUserName,
      responders: aliveOthers,
      depth: currentDepth + 1,
      wuxieChain: nextChain,
      judgmentContext,
      aoeResume,
    });

    return applyAtoms(state, [{ type: '推入待定', action: nestedPending }]);
  }

  // Pass
  const newPassed = [...currentPassed, action.player];
  const remaining = responders.filter(p => !newPassed.includes(p));

  if (remaining.length > 0) {
    state = applyAtoms(state, [{ type: '弹出待定' }]).state;
    const nextDefender = remaining[0];
    const nextDefenderPlayer = getPlayer(state, nextDefender);
    const validCards = nextDefenderPlayer.hand.filter(id => state.cardMap[id]?.name === '无懈可击');
    const timeout = TIMEOUT_DEFAULTS.trickResponse;

    const updatedPending: PendingResponseWindow = {
      id: createPendingId(),
      type: '响应窗口',
      window: {
        type: 'trickResponse',
        attacker,
        defender: nextDefender,
        validCards,
        sourceCard,
        trickTarget,
        sourceUser: sourceUserName,
        responders,
        passedResponders: newPassed,
        depth: currentDepth,
        wuxieChain: currentChain,
        judgmentContext,
        aoeResume,
        timeout,
        deadline: Date.now() + timeout,
      },
      timeout,
      deadline: Date.now() + timeout,
      onTimeout: { type: '打出', player: nextDefender },
    };

    return applyAtoms(state, [{ type: '推入待定', action: updatedPending }]);
  }

  state = applyAtoms(state, [{ type: '弹出待定' }]).state;
  return resolveTrickResolution(state, currentDepth, sourceCard!, attacker!, trickTarget, judgmentContext, aoeResume);
}

function resolveTrickResolution(
  state: GameState,
  depth: number,
  sourceCard: string,
  attacker: string,
  trickTarget?: string,
  judgmentContext?: { player: string; trickIndex: number },
  aoeResume?: { attacker: string; remainingTargets: string[]; requiredCard: string; sourceCard: string },
): EngineResult {
  // depth EVEN → 锦囊放行；depth ODD → 锦囊被取消
  const negated = depth % 2 !== 0;

  if (judgmentContext) {
    return resolveJudgmentTrickResponse(state, negated, state.cardMap[sourceCard]?.name ?? '', judgmentContext);
  }

  if (aoeResume) {
    if (negated) {
      const nextTargets = aoeResume.remainingTargets.slice(1);
      if (nextTargets.length === 0) return { state, logEntries: [] };
      return startAoeTargetWuxie(state, {
        attacker: aoeResume.attacker,
        remainingTargets: nextTargets,
        requiredCard: aoeResume.requiredCard,
        sourceCard: aoeResume.sourceCard,
      });
    }
    return executeAoeResume(state, aoeResume);
  }

  if (negated) return { state, logEntries: [] };

  return executeTrickEffect(state, { sourceCard, attacker, trickTarget });
}

export function executeTrickEffect(
  state: GameState,
  params: { sourceCard: string; attacker: string; trickTarget?: string },
): EngineResult {
  const { sourceCard, attacker, trickTarget } = params;
  const trickCard = state.cardMap[sourceCard];
  if (!trickCard) return { state, logEntries: [], error: '源卡牌不存在' };
  const trickName = trickCard.name;
  const target = trickTarget;

  switch (trickName) {
    case '过河拆桥': {
      if (!target) return { state, logEntries: [] };
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) return { state, logEntries: [] };
      const selectPending: PendingSelectCard = {
        id: createPendingId(),
        type: '选择牌',
        player: attacker,
        target,
        cardIds: targetPlayer.hand,
        min: 1,
        max: 1,
        sourceCard,
        mode: '弃置',
        timeout: TIMEOUT_DEFAULTS.selectCard,
        deadline: Date.now() + TIMEOUT_DEFAULTS.selectCard,
        onTimeout: { type: '打出', player: attacker, cardIds: [targetPlayer.hand[0]] },
      };
      return applyAtoms(state, [{ type: '推入待定', action: selectPending }]);
    }

    case '顺手牵羊': {
      if (!target) return { state, logEntries: [] };
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) return { state, logEntries: [] };
      const selectPending: PendingSelectCard = {
        id: createPendingId(),
        type: '选择牌',
        player: attacker,
        target,
        cardIds: targetPlayer.hand,
        min: 1,
        max: 1,
        sourceCard,
        mode: '获得',
        timeout: TIMEOUT_DEFAULTS.selectCard,
        deadline: Date.now() + TIMEOUT_DEFAULTS.selectCard,
        onTimeout: { type: '打出', player: attacker, cardIds: [targetPlayer.hand[0]] },
      };
      return applyAtoms(state, [{ type: '推入待定', action: selectPending }]);
    }

    case '决斗': {
      if (!target) return { state, logEntries: [] };
      const validKills = getPlayer(state, target).hand.filter(id => state.cardMap[id]?.name === '杀');
      const duelTimeout = TIMEOUT_DEFAULTS.killResponse;
      const duelWindow: PendingResponseWindow = {
        id: createPendingId(),
        type: '响应窗口',
        window: {
          type: 'duelResponse',
          attacker,
          defender: target,
          validCards: validKills,
          sourceCard,
          timeout: duelTimeout,
          deadline: Date.now() + duelTimeout,
        },
        timeout: duelTimeout,
        deadline: Date.now() + duelTimeout,
        onTimeout: { type: '打出', player: target },
      };
      return applyAtoms(state, [{ type: '推入待定', action: duelWindow }]);
    }

    case '乐不思蜀': {
      if (!target) return { state, logEntries: [] };
      const trick = { name: '乐不思蜀', source: attacker, card: trickCard };
      return applyAtoms(state, [{ type: '添加延时锦囊', player: target, trick }]);
    }

    case '兵粮寸断': {
      if (!target) return { state, logEntries: [] };
      const trick = { name: '兵粮寸断', source: attacker, card: trickCard };
      return applyAtoms(state, [{ type: '添加延时锦囊', player: target, trick }]);
    }

    case '无中生有': {
      return applyAtoms(state, [{ type: '摸牌', player: attacker, count: 2 }]);
    }

    case '桃园结义': {
      const alivePlayers = state.playerOrder.filter(p => getPlayer(state, p).info.alive);
      const healAtoms: Atom[] = alivePlayers.flatMap(p => {
        const ps = getPlayer(state, p);
        if (ps.health >= ps.maxHealth) return [];
        return [{ type: '回复体力' as const, target: p, amount: 1, source: attacker }];
      });
      return applyAtoms(state, healAtoms);
    }

    case '五谷丰登': {
      const alivePlayerNames = state.playerOrder.filter(p => getPlayer(state, p).info.alive);
      const count = Math.min(alivePlayerNames.length, state.zones.deck.length);
      if (count === 0) return { state, logEntries: [] };

      const revealedCards = state.zones.deck.slice(0, count);
      const remainingDeck = state.zones.deck.slice(count);
      const startIdx = state.playerOrder.indexOf(state.currentPlayer);
      const pickOrder: string[] = [];
      for (let i = 0; i < state.playerOrder.length; i++) {
        const p = state.playerOrder[(startIdx - i + state.playerOrder.length) % state.playerOrder.length];
        if (getPlayer(state, p).info.alive) pickOrder.push(p);
      }
      const timeout = TIMEOUT_DEFAULTS.harvestSelection;
      const harvestPending: PendingHarvestSelection = {
        id: createPendingId(),
        type: '收获选牌',
        revealedCards,
        currentPickerIndex: 0,
        pickOrder,
        player: attacker,
        timeout,
        deadline: Date.now() + timeout,
        onTimeout: { type: '打出', player: pickOrder[0], cardId: revealedCards[0] },
      };
      const s = { ...state, zones: { ...state.zones, deck: remainingDeck } };
      const result = applyAtoms(s, [{ type: '推入待定', action: harvestPending }]);
      const harvestRevealLogEntry = makeLogEntry({ type: 'harvestReveal', cards: revealedCards } as unknown as Atom);
      return { state: result.state, logEntries: [...result.logEntries, harvestRevealLogEntry] };
    }

    default:
      return { state, logEntries: [] };
  }
}

function resolveLegacyTrickResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  const cardId = action.type === '打出' ? action.cardId : undefined;
  const { attacker, defender, sourceCard, trickTarget, remainingPlayers, negated } = pending.window;
  if (!sourceCard) return { state, logEntries: [], error: 'trickResponse 缺少 sourceCard' };
  if (!attacker) return { state, logEntries: [], error: 'trickResponse 缺少 attacker' };
  const trickCard = state.cardMap[sourceCard];
  if (!trickCard) return { state, logEntries: [], error: 'trickResponse 源卡牌不存在' };
  const trickName = trickCard.name;

  let newNegated = negated ?? false;

  if (cardId) {
    const card = state.cardMap[cardId];
    if (card?.name !== '无懈可击') {
      return { state, logEntries: [], error: '只能用无懈可击响应锦囊' };
    }
    const responder = getPlayer(state, defender);
    if (!responder.hand.includes(cardId)) {
      return { state, logEntries: [], error: '手牌中没有该卡牌' };
    }
    state = applyAtoms(state, [
      {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: defender },
        to: { zone: '弃牌堆' },
      },
    ]).state;
    newNegated = !newNegated;
  }

  state = applyAtoms(state, [{ type: '弹出待定' }]).state;

  if (remainingPlayers && remainingPlayers.length > 0) {
    const nextTarget = remainingPlayers[0];
    const nextRemaining = remainingPlayers.slice(1);
    const nextPlayer = getPlayer(state, nextTarget);
    const validWuxie = nextPlayer.hand.filter(id => state.cardMap[id]?.name === '无懈可击');
    const nextTimeout = TIMEOUT_DEFAULTS.trickResponse;

    const nextWindow: PendingResponseWindow = {
      id: createPendingId(),
      type: '响应窗口',
      window: {
        type: 'trickResponse',
        attacker,
        defender: nextTarget,
        validCards: validWuxie,
        sourceCard,
        trickTarget: trickTarget ?? defender,
        remainingPlayers: nextRemaining,
        negated: newNegated,
        timeout: nextTimeout,
        deadline: Date.now() + nextTimeout,
      },
      timeout: nextTimeout,
      deadline: Date.now() + nextTimeout,
      onTimeout: { type: '打出', player: nextTarget },
    };

    return applyAtoms(state, [{ type: '推入待定', action: nextWindow }]);
  }

  if (pending.window.judgmentContext) {
    return resolveJudgmentTrickResponse(state, newNegated, trickName, pending.window.judgmentContext);
  }

  if (newNegated) return { state, logEntries: [] };

  // Legacy 路径：直接 dispatch 到与 executeTrickEffect 相同的 switch
  return executeTrickEffect(state, { sourceCard, attacker, trickTarget });
}

function resolveJudgmentTrickResponse(
  state: GameState,
  negated: boolean,
  trickName: string,
  ctx: { player: string; trickIndex: number },
): EngineResult {
  const { player, trickIndex } = ctx;

  const atoms: Atom[] = [{ type: '移除延时锦囊', player, index: trickIndex }];

  if (!negated) {
    atoms.push({ type: '判定', player, varKey: `judgeResult_${trickName}_${trickIndex}` });
  }

  const result = applyAtoms(state, atoms);
  let s = result.state;

  if (!negated) {
    const discardPile = s.zones.discardPile;
    const judgedCardId = discardPile[discardPile.length - 1];
    const suit = judgedCardId ? s.cardMap[judgedCardId]?.suit : '♣';

    let tag: string | undefined;
    if (trickName === '乐不思蜀' && suit !== '♥') {
      tag = 'skipPlay';
    } else if (trickName === '兵粮寸断' && suit !== '♣') {
      tag = 'skipDraw';
    }

    if (tag) {
      const tagResult = applyAtoms(s, [{ type: '加标签', player, tag }]);
      s = tagResult.state;
      return { state: s, logEntries: [...result.logEntries, ...tagResult.logEntries] };
    }
  }

  const nextIndex = trickIndex - 1;
  if (nextIndex < 0) {
    return { state: s, logEntries: result.logEntries };
  }

  const playerState = getPlayer(s, player);
  const nextTrick = playerState.pendingTricks[nextIndex];
  if (!nextTrick) {
    return { state: s, logEntries: result.logEntries };
  }

  const aliveOthers = getAlivePlayerNames(s).filter(p => p !== player);
  if (aliveOthers.length === 0) {
    return batchRemainJudgments(s, player, nextIndex);
  }

  const nextPending = createConcurrentTrickResponse(s, {
    sourceCard: nextTrick.card.id,
    attacker: nextTrick.source,
    trickTarget: player,
    responders: aliveOthers,
    depth: 0,
    judgmentContext: { player, trickIndex: nextIndex },
  });
  return applyAtoms(s, [{ type: '推入待定', action: nextPending }]);
}

function batchRemainJudgments(
  state: GameState,
  player: string,
  fromIndex: number,
): EngineResult {
  const playerState = getPlayer(state, player);
  const tricks = playerState.pendingTricks;
  const atoms: Atom[] = [];
  const tags: string[] = [];

  for (let i = fromIndex; i >= 0; i--) {
    const trick = tricks[i];
    atoms.push({ type: '判定', player, varKey: `judgeResult_${trick.name}_${i}` });
    atoms.push({ type: '移除延时锦囊', player, index: i });
  }

  const actionResult = applyAtoms(state, atoms);
  const s = actionResult.state;

  for (let i = fromIndex; i >= 0; i--) {
    const trick = tricks[i];
    const judgedCardId = s.zones.discardPile[s.zones.discardPile.length - 1 - i];
    const suit = judgedCardId ? s.cardMap[judgedCardId]?.suit : '♣';

    if (trick.name === '乐不思蜀' && suit !== '♥') {
      tags.push('skipPlay');
    } else if (trick.name === '兵粮寸断' && suit !== '♣') {
      tags.push('skipDraw');
    }
  }

  if (tags.length > 0) {
    const tagAtoms = tags.map(tag => ({ type: '加标签' as const, player, tag }));
    const tagResult = applyAtoms(s, tagAtoms);
    return { state: tagResult.state, logEntries: [...actionResult.logEntries, ...tagResult.logEntries] };
  }

  return { state: s, logEntries: actionResult.logEntries };
}
