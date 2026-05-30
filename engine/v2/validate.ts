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
  PendingAction,
  PendingResponseWindow,
  PendingSkillPrompt,
  PendingDiscardPhase,
  PendingDyingWindow,
  PendingSelectCard,
  PromptOption,
} from './types';
import { getPlayer, getAlivePlayerNames } from './state';
import { getDistance, getAttackRange, isInAttackRange } from './distance';
import type { Card, CardDef } from '../../shared/types';
import { 基本牌列表 } from '../../shared/cards/basic';
import { 锦囊牌列表 } from '../../shared/cards/tricks';
import { 装备牌列表 } from '../../shared/cards/equipment';

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
  }
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
      if (!isInAttackRange(state, action.player, action.target)) return '目标不在攻击范围内';
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
    case 'responseWindow':
      return validateResponseWindow(state, action, pending);
    case 'skillPrompt':
      return validateSkillPrompt(state, action, pending);
    case 'discardPhase':
      return validateDiscardPhase(state, action, pending);
    case 'dyingWindow':
      return validateDyingWindow(state, action, pending);
    case 'selectCard':
      return null;
  }
}

function validateResponseWindow(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): string | null {
  if (action.type !== 'respond') {
    return '当前需要响应动作';
  }

  const { defender } = pending.window;
  if (action.player !== defender) {
    return '只有被指定者可以响应';
  }

  if (!action.player) return '缺少玩家标识';

  const responder = getPlayer(state, action.player);
  if (!responder.info.alive) return '你已阵亡';

  // 不出牌（pass）总是合法的
  if (!action.cardId) return null;

  if (!responder.hand.includes(action.cardId)) return '手牌中没有该卡牌';

  const card = state.cardMap[action.cardId];
  if (!card) return '未知卡牌';

  // 根据响应窗口类型检查卡牌是否合法
  switch (pending.window.type) {
    case 'killResponse':
      if (card.name !== '闪') return '只能用闪响应杀';
      break;
    case 'aoeResponse':
      // AOE 响应要求特定牌（万箭→闪，南蛮→杀）
      if (pending.window.validCards.length > 0 && !pending.window.validCards.includes(action.cardId)) {
        return '该牌不能用于此响应';
      }
      break;
    case 'dyingResponse':
      if (card.name !== '桃') return '只能用桃响应濒死';
      break;
    case 'duelResponse':
      if (card.name !== '杀') return '只能用杀响应决斗';
      break;
    case 'trickResponse':
      // 锦囊响应检查 validCards
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
  }
}

function computeResponseWindowActions(
  state: GameState,
  player: string,
  pending: PendingResponseWindow,
): ValidAction[] {
  if (player !== pending.window.defender) return [];

  const responder = getPlayer(state, player);
  const validCards: string[] = [];

  for (const cardId of responder.hand) {
    if (isCardValidResponse(state, cardId, pending.window.type)) {
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

function isCardValidResponse(
  state: GameState,
  cardId: string,
  windowType: string,
): boolean {
  const card = state.cardMap[cardId];
  if (!card) return false;

  switch (windowType) {
    case 'killResponse': return card.name === '闪';
    case 'aoeResponse': return card.name === '闪' || card.name === '杀'; // 简化
    case 'dyingResponse': return card.name === '桃';
    case 'duelResponse': return card.name === '杀';
    case 'trickResponse': return true; // 锦囊响应简化
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

  switch (filter.type) {
    case 'self':
    case 'none':
      return true;
    case 'other':
      return alivePlayers.some((t) => t !== player && getPlayer(state, t).info.alive);
    case 'inRange':
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

  switch (filter.type) {
    case 'self':
      return target === player;
    case 'other':
      return target !== player && getPlayer(state, target).info.alive;
    case 'inRange':
      return target !== player && isInAttackRange(state, player, target);
    case 'none':
      return false; // 无目标牌，任何目标都不合法
    case 'all':
      return target !== player; // 全体目标，选具体人不合理
    default:
      return false;
  }
}
