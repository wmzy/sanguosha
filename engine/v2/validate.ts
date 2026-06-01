/**
 * engine/v2/validate.ts — V2 三国杀引擎动作验证模块
 *
 * 提供权威的合法性检查，从 engine.ts 中提取并增强。
 * 服务端验证入口，也用于 computeValidActions 计算可用操作。
 */

import type {
  GameState,
  GameAction,
  ValidAction,
  PlayableCard,
  AvailableSkill,
  PendingPlayPhase,
  PendingResponseWindow,
  PendingSkillPrompt,
  PendingDiscardPhase,
  PendingDyingWindow,
  PendingSelectCard,
  PendingHarvestSelection,
} from './types';
import { getPlayer, getAlivePlayerNames } from './state';
import { isInAttackRange } from './distance';
import type { Card, CardDef } from '../../shared/types';
import { 基本牌列表 } from '../../shared/cards/basic';
import { 锦囊牌列表 } from '../../shared/cards/tricks';
import { 装备牌列表 } from '../../shared/cards/equipment';
import { getSkill } from './skill';

// ─── 卡牌定义查找表 ───────────────────────────────────────────

const cardDefMap = new Map<string, CardDef>();
for (const def of [...基本牌列表, ...锦囊牌列表, ...装备牌列表]) {
  cardDefMap.set(def.name, def);
}

// ─── 工具函数 ─────────────────────────────────────────────────

/** 武器是否允许无限出杀（诸葛连弩等） */
export function hasUnlimitedKills(state: GameState, playerName: string): boolean {
  const player = getPlayer(state, playerName);
  if (!player.equipment.weapon) return false;
  const weaponCard = state.cardMap[player.equipment.weapon];
  if (!weaponCard) return false;
  const def = cardDefMap.get(weaponCard.name);
  return def?.weaponEffect?.type === 'unlimitedKills';
}

/** 检查角色 modifiers 是否包含 unlimitedKills */
function characterHasUnlimitedKills(state: GameState, playerName: string): boolean {
  const player = getPlayer(state, playerName);
  // 检查 vars 中是否有标记允许无限出杀
  return player.vars['unlimitedKills'] === true;
}

/** 综合判断玩家是否可以无限出杀 */
function canKillUnlimited(state: GameState, playerName: string): boolean {
  return hasUnlimitedKills(state, playerName) || characterHasUnlimitedKills(state, playerName);
}

// ─── 技能卡牌转换 ─────────────────────────────────────────────

/** 返回玩家可通过技能转换为 targetType 的手牌 ID（倾国/龙胆/武圣等） */
export function getSkillConvertedCards(
  state: GameState,
  player: string,
  targetType: '闪' | '杀',
): string[] {
  const playerState = getPlayer(state, player);
  const convertedCards: string[] = [];

  for (const cardId of playerState.hand) {
    if (canCardBeConvertedBySkill(state, player, cardId, targetType)) {
      convertedCards.push(cardId);
    }
  }

  return convertedCards;
}

function canCardBeConvertedBySkill(
  state: GameState,
  player: string,
  cardId: string,
  targetType: '闪' | '杀',
): boolean {
  const card = state.cardMap[cardId];
  if (!card) return false;
  const isBlack = card.suit === '♠' || card.suit === '♣';
  const isRed = card.suit === '♥' || card.suit === '♦';

  for (const trigger of state.triggers) {
    if (trigger.player !== player || trigger.source !== 'character') continue;
    let skillId: string;
    try {
      skillId = getSkill(trigger.skillId).id;
    } catch {
      continue;
    }

    if (targetType === '闪' && (trigger.event === 'killResponse' || trigger.event === 'aoeResponse')) {
      if (skillId === '倾国' && isBlack) return true;
      if (skillId === '龙胆' && card.name === '杀') return true;
    }
    if (targetType === '杀') {
      if (skillId === '武圣' && isRed) return true;
      if (skillId === '龙胆' && card.name === '闪') return true;
    }
  }
  return false;
}

// ─── validateAction ───────────────────────────────────────────

/**
 * 验证动作合法性，返回错误信息或 null（合法）。
 * 这是权威验证入口，在 engine 处理前调用。
 */
export function validateAction(state: GameState, action: GameAction): string | null {
  // 有 pending 时走 pending 验证分支
  if (state.pending) {
    return validatePendingAction(state, action);
  }

  switch (action.type) {
    case 'playCard':
      return validatePlayCard(state, action);
    case 'respond':
      return '响应动作仅在响应窗口中有效';
    case 'endTurn':
      return validateEndTurn(state, action);
    case 'discard':
      return '弃牌操作仅在弃牌阶段有效';
    case 'useSkill':
      return validateUseSkill(state, action);
    case 'skillChoice':
      return '技能选择仅在技能提示中有效';
    case 'startGame':
      return null; // startGame 不需要验证
  }

  return null; // 其他 action type 默认通过
}

// ─── playCard 验证 ────────────────────────────────────────────

function validatePlayCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
): string | null {
  if (action.player !== state.currentPlayer) return '不是你的回合';
  if (state.phase !== '出牌') return '当前不是出牌阶段';

  const player = getPlayer(state, action.player);
  if (!player.info.alive) return '你已阵亡';
  if (!player.hand.includes(action.cardId)) return '手牌中没有此牌';

  const card = state.cardMap[action.cardId];
  if (!card) return '未知卡牌';

  if (card.name === '闪') return '闪不能主动使用';
  if (card.name === '无懈可击') return '无懈可击只能用于响应锦囊';

  if (card.name === '杀') {
    if (!canKillUnlimited(state, action.player) && state.turn.killsPlayed >= 1) {
      return '本回合已使用过杀';
    }
    if (!action.target) return '杀需要指定目标';
    if (action.target === action.player) return '不能对自己使用杀';
    if (!isInAttackRange(state, action.player, action.target)) {
      return '目标不在攻击范围内';
    }
    const targetPlayer = getPlayer(state, action.target);
    if (!targetPlayer.info.alive) return '目标已阵亡';
  }

  if (card.name === '桃' && player.health >= player.maxHealth) {
    return '体力已满';
  }

  // 锦囊牌目标检查
  if (card.type === '锦囊牌') {
    return validateTrickTarget(state, action, card);
  }

  return null;
}

/** 锦囊牌目标合法性检查 */
function validateTrickTarget(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  card: Card,
): string | null {
  const def = cardDefMap.get(card.name);
  if (!def?.targetFilter) return null;

  const filter = def.targetFilter;
  const playerState = getPlayer(state, action.player);
  const noDistanceLimit = playerState.tags.includes('noTrickDistanceLimit');

  switch (filter.type) {
    case 'self':
      if (action.target && action.target !== action.player) return '该牌只能对自己使用';
      break;
    case 'other':
      if (!action.target) return '需要指定目标';
      if (action.target === action.player) return '不能对自己使用';
      if (!getPlayer(state, action.target).info.alive) return '目标已阵亡';
      break;
    case 'inRange':
      if (!action.target) return '需要指定目标';
      if (action.target === action.player) return '不能对自己使用';
      if (!noDistanceLimit && !isInAttackRange(state, action.player, action.target)) return '目标不在攻击范围内';
      if (!getPlayer(state, action.target).info.alive) return '目标已阵亡';
      break;
    case 'none':
    case 'all':
      break;
  }

  return null;
}

// ─── endTurn 验证 ─────────────────────────────────────────────

function validateEndTurn(
  state: GameState,
  action: GameAction & { type: 'endTurn' },
): string | null {
  if (action.player !== state.currentPlayer) return '不是你的回合';
  if (state.phase !== '出牌') return '当前不是出牌阶段';
  return null;
}

// ─── useSkill 验证 ────────────────────────────────────────────

function validateUseSkill(
  state: GameState,
  action: GameAction & { type: 'useSkill' },
): string | null {
  if (action.player !== state.currentPlayer) return '不是你的回合';
  if (state.phase !== '出牌') return '当前不是出牌阶段';

  const player = getPlayer(state, action.player);
  if (!player.info.alive) return '你已阵亡';

  // 检查技能是否属于该玩家的角色
  const trigger = state.triggers.find(
    (t) => t.skillId === action.skillId && t.player === action.player,
  );
  if (!trigger) return `你不拥有技能: ${action.skillId}`;

  // 检查本回合是否已使用过（如果 trigger.optional 不为 true 则限制每回合一次）
  if (state.turn.skillsUsed.includes(action.skillId)) {
    return '本回合已使用过该技能';
  }

  return null;
}

// ─── pending 阶段验证 ─────────────────────────────────────────

function validatePendingAction(state: GameState, action: GameAction): string | null {
  const pending = state.pending!;
  switch (pending.type) {
    case 'playPhase':
      return validatePlayPhasePending(state, action, pending);
    case 'responseWindow':
      return validateResponseWindow(state, action, pending);
    case 'skillPrompt':
      return validateSkillPrompt(state, action, pending);
    case 'discardPhase':
      return validateDiscardPhase(state, action, pending);
    case 'dyingWindow':
      return validateDyingWindow(state, action, pending);
    case 'selectCard':
      return validateSelectCard(state, action, pending);
    case 'harvestSelection':
      return null;
  }
  return null;
}

function validatePlayPhasePending(
  state: GameState,
  action: GameAction,
  _pending: PendingPlayPhase,
): string | null {
  const allowed: GameAction['type'][] = ['playCard', 'useSkill', 'endTurn', 'toggleAutoSkipWuxie'];
  if (!allowed.includes(action.type)) {
    return '出牌阶段不允许此操作';
  }
  if (action.type === 'playCard') return validatePlayCard(state, action);
  if (action.type === 'useSkill') return validateUseSkill(state, action);
  if (action.type === 'endTurn') return validateEndTurn(state, action);
  return null;
}

function validateResponseWindow(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): string | null {
  if (action.type !== 'respond') {
    return '当前需要响应动作';
  }

  if (!action.player) return '缺少玩家标识';

  // 并发 trickResponse：任意 responder（非 passed）都可以响应
  if (pending.window.type === 'trickResponse' && pending.window.responders) {
    const { responders, passedResponders } = pending.window;
    if (!responders.includes(action.player)) {
      return '你不是可响应的玩家';
    }
    if (passedResponders?.includes(action.player)) {
      return '你已经 pass 了';
    }

    const responder = getPlayer(state, action.player);
    if (!responder.info.alive) return '你已阵亡';
    if (!action.cardId) return null;
    if (!responder.hand.includes(action.cardId)) return '手牌中没有该卡牌';
    const card = state.cardMap[action.cardId];
    if (!card) return '未知卡牌';
    if (card.name !== '无懈可击') return '只能用无懈可击响应锦囊';
    return null;
  }

  const { defender } = pending.window;
  if (action.player !== defender) {
    return '只有被指定者可以响应';
  }

  const responder = getPlayer(state, action.player);
  if (!responder.info.alive) return '你已阵亡';

  if (!action.cardId) return null;

  if (!responder.hand.includes(action.cardId)) return '手牌中没有该卡牌';

  const card = state.cardMap[action.cardId];
  if (!card) return '未知卡牌';

  switch (pending.window.type) {
    case 'killResponse':
      if (!isCardValidResponse(state, action.cardId, 'killResponse', action.player)) {
        return '只能用闪响应杀';
      }
      break;
    case 'aoeResponse':
      if (pending.window.validCards.length > 0 && !pending.window.validCards.includes(action.cardId)) {
        return '该牌不能用于此响应';
      }
      break;
    case 'dyingResponse':
      if (card.name !== '桃') return '只能用桃响应濒死';
      break;
    case 'duelResponse':
      if (!isCardValidResponse(state, action.cardId, 'duelResponse', action.player)) {
        return '只能用杀响应决斗';
      }
      break;
    case 'trickResponse':
      if (pending.window.validCards.length > 0 && !pending.window.validCards.includes(action.cardId)) {
        return '该牌不能用于此响应';
      }
      break;
  }

  return null;
}

function validateSkillPrompt(
  state: GameState,
  action: GameAction,
  pending: PendingSkillPrompt,
): string | null {
  if (action.type !== 'skillChoice') {
    return '当前需要技能选择动作';
  }
  if (action.player !== pending.player) {
    return '只有技能发动者可以做选择';
  }
  return null;
}

function validateDiscardPhase(
  state: GameState,
  action: GameAction,
  pending: PendingDiscardPhase,
): string | null {
  if (action.type !== 'discard') {
    return '当前需要弃牌动作';
  }
  if (action.player !== pending.player) {
    return '只有当前玩家可以弃牌';
  }
  if (action.cardIds.length < pending.min || action.cardIds.length > pending.max) {
    return `需要弃 ${pending.min}~${pending.max} 张牌`;
  }

  const playerState = getPlayer(state, action.player);
  for (const id of action.cardIds) {
    if (!playerState.hand.includes(id)) {
      return `卡牌不在手牌中`;
    }
  }

  return null;
}

function validateDyingWindow(
  state: GameState,
  action: GameAction,
  pending: PendingDyingWindow,
): string | null {
  if (action.type !== 'respond') {
    return '濒死窗口需要响应动作';
  }

  const currentSaver = pending.savers[pending.currentSaverIndex];
  if (action.player !== currentSaver) {
    return '当前不是你的救助回合';
  }

  if (action.cardId) {
    const saverState = getPlayer(state, currentSaver);
    if (!saverState.hand.includes(action.cardId)) return '手牌中没有该卡牌';
    const card = state.cardMap[action.cardId];
    if (card.name !== '桃') return '只能用桃救人';
  }

  return null;
}

function validateSelectCard(
  state: GameState,
  action: GameAction,
  pending: PendingSelectCard,
): string | null {
  if (action.type !== 'respond') return '选牌需要 respond 动作';
  if (action.player !== pending.player) return '只有出牌者可以选择';

  const selectedIds = action.cardIds ?? (action.cardId ? [action.cardId] : []);
  if (selectedIds.length < pending.min || selectedIds.length > pending.max) {
    return '选择的卡牌数量不符';
  }

  const targetPlayer = getPlayer(state, pending.target);
  for (const cardId of selectedIds) {
    if (!targetPlayer.hand.includes(cardId)) return '所选卡牌不在目标手牌中';
  }

  return null;
}

// ─── computeValidActions ──────────────────────────────────────

/**
 * 计算某玩家的所有合法操作。
 * 用于构建 ClientGameState / GameView 时生成可选操作列表。
 */
export function computeValidActions(state: GameState, player: string): ValidAction[] {
  // 有 pending → 只计算 pending 相关的操作
  if (state.pending) {
    return computePendingActions(state, player);
  }

  // 非当前玩家，出牌阶段没有操作
  if (player !== state.currentPlayer) return [];

  // 出牌阶段
  if (state.phase === '出牌') {
    return computePlayPhaseActions(state, player);
  }

  // 弃牌阶段（有 pending 已在上面处理，此处为安全兜底）
  if (state.phase === '弃牌') {
    const playerState = getPlayer(state, player);
    const discardCount = Math.max(0, playerState.hand.length - playerState.health);
    if (discardCount > 0) {
      return [{
        type: 'discard',
        prompt: `请弃掉 ${discardCount} 张牌`,
        min: discardCount,
        max: discardCount,
        cards: playerState.hand,
      }];
    }
  }

  return [];
}

function computePendingActions(state: GameState, player: string): ValidAction[] {
  const pending = state.pending!;
  switch (pending.type) {
    case 'playPhase':
      return computePlayPhaseActions(state, player);
    case 'responseWindow':
      return computeResponseWindowActions(state, player, pending);
    case 'skillPrompt':
      return computeSkillPromptActions(state, player, pending);
    case 'discardPhase':
      return computeDiscardPhaseActions(state, player, pending);
    case 'dyingWindow':
      return computeDyingWindowActions(state, player, pending);
    case 'selectCard':
      return computeSelectCardActions(state, player, pending);
    case 'harvestSelection':
      return computeHarvestSelectionActions(state, player, pending);
  }
  return [];
}

function computeResponseWindowActions(
  state: GameState,
  player: string,
  pending: PendingResponseWindow,
): ValidAction[] {
  // 并发 trickResponse：所有未 pass 的 responder 都可以响应
  if (pending.window.type === 'trickResponse' && pending.window.responders) {
    const { responders, passedResponders } = pending.window;
    const passed = passedResponders ?? [];
    if (!responders.includes(player) || passed.includes(player)) return [];

    const responder = getPlayer(state, player);
    const validCards = responder.hand.filter(id => state.cardMap[id]?.name === '无懈可击');
    return [{
      type: 'respond',
      prompt: '请选择是否响应',
      required: false,
      cards: validCards,
      canPass: true,
    }];
  }

  if (player !== pending.window.defender) return [];

  const responder = getPlayer(state, player);
  const validCards: string[] = [];

  for (const cardId of responder.hand) {
    if (pending.window.type === 'aoeResponse') {
      if (isCardValidResponse(state, cardId, 'aoeResponse', player)) {
        validCards.push(cardId);
      }
    } else if (isCardValidResponse(state, cardId, pending.window.type, player)) {
      validCards.push(cardId);
    }
  }

  return [{
    type: 'respond',
    prompt: getResponsePrompt(pending.window.type),
    required: false,
    cards: validCards,
    canPass: true,
  }];
}

export function isCardValidResponse(
  state: GameState,
  cardId: string,
  windowType: string,
  player?: string,
): boolean {
  const card = state.cardMap[cardId];
  if (!card) return false;

  switch (windowType) {
    case 'killResponse':
      if (card.name === '闪') return true;
      return player ? canCardBeConvertedBySkill(state, player, cardId, '闪') : false;
    case 'aoeResponse': {
      const pending = state.pending;
      const required = pending?.type === 'responseWindow' && pending.window.type === 'aoeResponse'
        ? pending.window.requiredCard as '杀' | '闪'
        : undefined;
      if (required) {
        if (card.name === required) return true;
        return player ? canCardBeConvertedBySkill(state, player, cardId, required) : false;
      }
      return card.name === '闪' || card.name === '杀';
    }
    case 'dyingResponse': return card.name === '桃';
    case 'duelResponse':
      if (card.name === '杀') return true;
      return player ? canCardBeConvertedBySkill(state, player, cardId, '杀') : false;
    case 'trickResponse': return card.name === '无懈可击';
    default: return false;
  }
}

function getResponsePrompt(windowType: string): string {
  switch (windowType) {
    case 'killResponse': return '请选择是否出闪';
    case 'aoeResponse': return '请选择是否响应';
    case 'dyingResponse': return '请选择是否出桃';
    case 'duelResponse': return '请选择是否出杀';
    case 'trickResponse': return '请选择是否响应';
    default: return '请响应';
  }
}

function computeSkillPromptActions(
  state: GameState,
  player: string,
  pending: PendingSkillPrompt,
): ValidAction[] {
  if (player !== pending.player) return [];

  return [{
    type: 'skillChoice',
    prompt: pending.prompt.text,
    options: pending.prompt.options,
  }];
}

function computeDiscardPhaseActions(
  state: GameState,
  player: string,
  pending: PendingDiscardPhase,
): ValidAction[] {
  if (player !== pending.player) return [];

  const playerState = getPlayer(state, player);
  return [{
    type: 'discard',
    prompt: `请弃掉 ${pending.min}~${pending.max} 张牌`,
    min: pending.min,
    max: pending.max,
    cards: playerState.hand,
  }];
}

function computeDyingWindowActions(
  state: GameState,
  player: string,
  pending: PendingDyingWindow,
): ValidAction[] {
  const currentSaver = pending.savers[pending.currentSaverIndex];
  if (player !== currentSaver) return [];

  const saverState = getPlayer(state, player);
  const peachCards = saverState.hand.filter(
    (id) => state.cardMap[id]?.name === '桃',
  );

  return [{
    type: 'respond',
    prompt: `${pending.dyingPlayer} 濒死，是否出桃？`,
    required: false,
    cards: peachCards,
    canPass: true,
  }];
}

function computeSelectCardActions(
  state: GameState,
  player: string,
  pending: PendingSelectCard,
): ValidAction[] {
  if (player !== pending.player) return [];
  return [{
    type: 'respond',
    prompt: `请选择 ${pending.target} 的一张手牌`,
    required: true,
    cards: pending.cardIds,
    canPass: false,
  }];
}

function computeHarvestSelectionActions(
  state: GameState,
  player: string,
  pending: PendingHarvestSelection,
): ValidAction[] {
  const currentPicker = pending.pickOrder[pending.currentPickerIndex];
  if (player !== currentPicker) return [];
  return [{
    type: 'respond',
    prompt: `五谷丰登选牌：从 ${pending.revealedCards.length} 张牌中选择一张`,
    required: true,
    cards: pending.revealedCards,
    canPass: false,
  }];
}

function computePlayPhaseActions(state: GameState, player: string): ValidAction[] {
  const actions: ValidAction[] = [];
  const playerState = getPlayer(state, player);

  if (!playerState.info.alive) {
    return [{ type: 'endTurn', prompt: '结束回合' }];
  }

  // 可出的牌
  const playableCards = computePlayableCards(state, player);
  if (playableCards.length > 0) {
    actions.push({
      type: 'playCard',
      prompt: '请出牌',
      cards: playableCards,
    });
  }

  // 可用的技能
  const availableSkills = computeAvailableSkills(state, player);
  if (availableSkills.length > 0) {
    actions.push({
      type: 'useSkill',
      prompt: '使用技能',
      skills: availableSkills,
    });
  }

  // 结束回合
  actions.push({ type: 'endTurn', prompt: '结束回合' });

  return actions;
}

function computePlayableCards(state: GameState, player: string): PlayableCard[] {
  const playerState = getPlayer(state, player);
  const cards: PlayableCard[] = [];

  for (const cardId of playerState.hand) {
    if (isCardPlayable(state, player, cardId)) {
      const targets = getValidTargetsForCard(state, player, cardId);
      cards.push({
        cardId,
        targets,
      });
    }
  }

  return cards;
}

function getValidTargetsForCard(state: GameState, player: string, cardId: string): string[] {
  const card = state.cardMap[cardId];
  if (!card) return [];

  const alivePlayers = getAlivePlayerNames(state);
  const targets: string[] = [];

  for (const target of alivePlayers) {
    if (isValidTarget(state, player, cardId, target)) {
      targets.push(target);
    }
  }

  return targets;
}

function computeAvailableSkills(state: GameState, player: string): AvailableSkill[] {
  const playerTriggers = state.triggers.filter(
    (t) => t.player === player && t.source === 'character' && !state.turn.skillsUsed.includes(t.skillId),
  );

  return playerTriggers.map((trigger) => ({
    skillId: trigger.skillId,
    name: trigger.skillId,
    description: '',
    canActivate: true,
  }));
}

// ─── isCardPlayable ───────────────────────────────────────────

/**
 * 判断某张牌是否可被打出。
 * 检查卡牌类型、使用限制、条件等。
 */
export function isCardPlayable(state: GameState, player: string, cardId: string): boolean {
  const playerState = getPlayer(state, player);
  if (!playerState.hand.includes(cardId)) return false;

  const card = state.cardMap[cardId];
  if (!card) return false;

  switch (card.name) {
    case '杀':
      return canKillUnlimited(state, player) || state.turn.killsPlayed < 1;
    case '闪':
      return false; // 闪只能被动使用
    case '无懈可击':
      return false; // 无懈可击只能用于响应锦囊
    case '桃':
      return playerState.health < playerState.maxHealth;
    default:
      break;
  }

  // 装备牌：总是可出
  if (card.type === '装备牌') return true;

  // 锦囊牌：检查是否有合法目标
  if (card.type === '锦囊牌') {
    return hasValidTargetForTrick(state, player, card);
  }

  return true;
}

/** 检查锦囊牌是否有合法目标 */
function hasValidTargetForTrick(state: GameState, player: string, card: Card): boolean {
  const def = cardDefMap.get(card.name);
  if (!def?.targetFilter) return true;

  const filter = def.targetFilter;
  const alivePlayers = getAlivePlayerNames(state);
  const playerState = getPlayer(state, player);
  const noDistanceLimit = playerState.tags.includes('noTrickDistanceLimit');

  switch (filter.type) {
    case 'self':
    case 'none':
      return true;
    case 'other':
      return alivePlayers.some((t) => t !== player && getPlayer(state, t).info.alive);
    case 'inRange':
      if (noDistanceLimit) {
        return alivePlayers.some((t) => t !== player && getPlayer(state, t).info.alive);
      }
      return alivePlayers.some(
        (t) => t !== player && isInAttackRange(state, player, t),
      );
    case 'all':
      return true;
    default:
      return false;
  }
}

// ─── isValidTarget ────────────────────────────────────────────

/**
 * 判断某张牌对某个目标是否合法。
 */
export function isValidTarget(state: GameState, player: string, cardId: string, target: string): boolean {
  const card = state.cardMap[cardId];
  if (!card) return false;

  // 目标必须存活
  const targetPlayer = getPlayer(state, target);
  if (!targetPlayer.info.alive) return false;

  switch (card.name) {
    case '杀':
      // 杀：不能对自己，距离检查
      if (target === player) return false;
      return isInAttackRange(state, player, target);

    case '桃':
      // 桃：只能对自己
      return target === player;

    default:
      break;
  }

  if (card.type === '装备牌') {
    // 装备不需要目标（对自己使用）
    return target === player;
  }

  if (card.type === '锦囊牌') {
    return isValidTrickTarget(state, player, card, target);
  }

  // 默认：不能对自己
  return target !== player;
}

function isValidTrickTarget(state: GameState, player: string, card: Card, target: string): boolean {
  const def = cardDefMap.get(card.name);
  if (!def?.targetFilter) return target !== player;

  const filter = def.targetFilter;
  const playerState = getPlayer(state, player);
  const noDistanceLimit = playerState.tags.includes('noTrickDistanceLimit');

  switch (filter.type) {
    case 'self':
      return target === player;
    case 'other':
      return target !== player && getPlayer(state, target).info.alive;
    case 'inRange':
      if (noDistanceLimit) {
        return target !== player && getPlayer(state, target).info.alive;
      }
      return target !== player && isInAttackRange(state, player, target);
    case 'none':
      return false;
    case 'all':
      return target !== player;
    default:
      return false;
  }
}
