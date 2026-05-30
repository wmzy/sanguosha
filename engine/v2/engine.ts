/**
 * engine/v2/engine.ts — V2 三国杀引擎主入口
 *
 * 纯函数 (state, action) → EngineResult
 * 负责动作分发、待处理动作处理和游戏循环编排。
 */

import type {
  GameState,
  GameAction,
  EngineResult,
  SkillContext,
  SkillPhase,
  Atom,
  PendingResponseWindow,
  PendingSkillPrompt,
  PendingDiscardPhase,
  PendingDyingWindow,
  ServerEvent,
  SkillDef,
  Json,
} from './types';
import { TIMEOUT_DEFAULTS } from './types';
import { broadcast } from './atom';
import { executePlan } from './phase';
import { getPlayer, getAlivePlayerNames } from './state';
import { getDistance, isInAttackRange } from './distance';
import { makeServerEvent } from './event';
import type { Card, CardDef } from '../../shared/types';
import { 基本牌列表 } from '../../shared/cards/basic';
import { 锦囊牌列表 } from '../../shared/cards/tricks';
import { 装备牌列表 } from '../../shared/cards/equipment';

// 注册所有 atom 和 phase 处理器
import './atoms/index';
import './phases/index';

// ─── 卡牌定义查找表 ───────────────────────────────────────────

const cardDefMap = new Map<string, CardDef>();
for (const def of [...基本牌列表, ...锦囊牌列表, ...装备牌列表]) {
  cardDefMap.set(def.name, def);
}

// ─── 技能注册表 ───────────────────────────────────────────────

const skillRegistry = new Map<string, SkillDef>();

export function registerSkill(def: SkillDef): void {
  skillRegistry.set(def.id, def);
}

// ─── 工具函数 ─────────────────────────────────────────────────

/** 应用一组 atom，返回新状态 + 本次生成的服务端事件 */
function applyAtoms(state: GameState, atoms: Atom[]): { state: GameState; events: ServerEvent[] } {
  if (atoms.length === 0) return { state, events: [] };
  const startLen = state.serverLog.length;
  const { state: newState } = broadcast(state, atoms);
  return { state: newState, events: newState.serverLog.slice(startLen) };
}

/** 构造濒死窗口 */
function createDyingPending(state: GameState, dyingPlayer: string, source?: string): PendingDyingWindow {
  const timeout = TIMEOUT_DEFAULTS.dyingResponse;
  return {
    type: 'dyingWindow',
    dyingPlayer,
    currentSaverIndex: 0,
    savers: getAlivePlayerNames(state),
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: 'respond', player: dyingPlayer },
  };
}

/** 武器是否允许无限出杀（诸葛连弩） */
function hasUnlimitedKills(state: GameState, playerName: string): boolean {
  const player = getPlayer(state, playerName);
  if (!player.equipment.weapon) return false;
  const weaponCard = state.cardMap[player.equipment.weapon];
  if (!weaponCard) return false;
  const def = cardDefMap.get(weaponCard.name);
  return def?.weaponEffect?.type === 'unlimitedKills';
}

// ─── 主入口 ───────────────────────────────────────────────────

export function engine(state: GameState, action: GameAction): EngineResult {
  // 有待处理动作 → 优先处理
  if (state.pending) {
    return handlePending(state, action);
  }

  // 验证动作合法性
  const error = validate(state, action);
  if (error) return { state, events: [], error };

  // 分发
  switch (action.type) {
    case 'playCard':
      return handlePlayCard(state, action);
    case 'endTurn':
      return handleEndTurn(state, action);
    case 'useSkill':
      return handleUseSkill(state, action);
    case 'discard':
      return handleDiscard(state, action);
    case 'respond':
      return { state, events: [], error: '响应动作仅在响应窗口中有效' };
    case 'skillChoice':
      return { state, events: [], error: '技能选择仅在技能提示中有效' };
  }
}

// ─── 待处理动作分发 ───────────────────────────────────────────

function handlePending(state: GameState, action: GameAction): EngineResult {
  const pending = state.pending!;
  switch (pending.type) {
    case 'responseWindow':
      return resolveResponse(state, action, pending);
    case 'skillPrompt':
      return resumeSkill(state, action, pending);
    case 'discardPhase':
      return resolveDiscardPhase(state, action, pending);
    case 'dyingWindow':
      return resolveDying(state, action, pending);
  }
}

// ─── 响应窗口处理 ─────────────────────────────────────────────

function resolveResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  switch (pending.window.type) {
    case 'killResponse':
      return resolveKillResponse(state, action, pending);
    case 'aoeResponse':
      return resolveAoeResponse(state, action, pending);
    case 'trickResponse':
      return resolveTrickResponse(state, action, pending);
    case 'duelResponse':
      return resolveDuelResponse(state, action, pending);
    case 'dyingResponse':
      return resolveDyingResponse(state, action, pending);
  }
}

/**
 * 杀响应窗口：
 *  - 出闪 → 杀被闪避
 *  - 不出 → 受到伤害（检查裸衣加成、检查濒死）
 */
function resolveKillResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: '杀响应窗口需要 respond 动作' };
  }

  const { attacker, defender } = pending.window;
  if (action.player !== defender) {
    return { state, events: [], error: '只有被杀者可以响应' };
  }

  // ── 出闪 → 闪避 ──
  if (action.cardId) {
    const responder = getPlayer(state, defender);
    if (!responder.hand.includes(action.cardId)) {
      return { state, events: [], error: '手牌中没有该卡牌' };
    }
    const card = state.cardMap[action.cardId];
    if (card.name !== '闪') {
      return { state, events: [], error: '只能用闪响应杀' };
    }

    const atoms: Atom[] = [
      {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player: defender },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    const dodgedEvent = makeServerEvent('killDodged', {
      attacker: attacker ?? '',
      defender,
    });
    return { state: result.state, events: [...result.events, dodgedEvent] };
  }

  // ── 不出 → 受到伤害 ──
  let damageAmount = 1;
  if (attacker) {
    const attackerState = getPlayer(state, attacker);
    if (attackerState.vars['裸衣/active'] === true) {
      damageAmount = 2;
    }
  }

  const damageAtoms: Atom[] = [
    {
      type: 'damage',
      target: defender,
      amount: damageAmount,
      source: attacker,
      cardId: pending.window.sourceCard,
    },
    { type: 'popPending' },
  ];
  const { state: damagedState, events: damageEvents } = applyAtoms(state, damageAtoms);
  const hitEvent = makeServerEvent('killHit', {
    attacker: attacker ?? '',
    defender,
  });

  // 检查濒死
  const defenderState = getPlayer(damagedState, defender);
  if (defenderState.health <= 0 && defenderState.info.alive) {
    const dyingPending = createDyingPending(damagedState, defender, attacker);
    const { state: dyingState, events: dyingEvents } = applyAtoms(damagedState, [
      { type: 'pushPending', action: dyingPending },
    ]);
    const dyingEvent = makeServerEvent('dying', {
      player: defender,
      ...(attacker ? { source: attacker } : {}),
    });
    return {
      state: dyingState,
      events: [...damageEvents, hitEvent, ...dyingEvents, dyingEvent],
    };
  }

  return { state: damagedState, events: [...damageEvents, hitEvent] };
}

/** AOE 响应（万箭齐发 / 南蛮入侵）— 简化：单目标处理 */
function resolveAoeResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: 'AOE 响应窗口需要 respond 动作' };
  }

  const { defender, attacker } = pending.window;

  if (action.cardId) {
    // 出了正确的牌 → 免疫
    const atoms: Atom[] = [
      {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player: defender },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    return { state: result.state, events: result.events };
  }

  // 没出 → 受伤
  const damageAtoms: Atom[] = [
    { type: 'damage', target: defender, amount: 1, source: attacker },
    { type: 'popPending' },
  ];
  const { state: damagedState, events: damageEvents } = applyAtoms(state, damageAtoms);

  const defenderState = getPlayer(damagedState, defender);
  if (defenderState.health <= 0 && defenderState.info.alive) {
    const dyingPending = createDyingPending(damagedState, defender, attacker);
    const { state: dyingState, events: dyingEvents } = applyAtoms(damagedState, [
      { type: 'pushPending', action: dyingPending },
    ]);
    return { state: dyingState, events: [...damageEvents, ...dyingEvents] };
  }

  return { state: damagedState, events: damageEvents };
}

/** 锦囊响应 — 简化处理 */
function resolveTrickResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  const cardId = action.type === 'respond' ? action.cardId : undefined;
  if (cardId) {
    const atoms: Atom[] = [
      {
        type: 'moveCard',
        cardId,
        from: { zone: 'hand', player: pending.window.defender },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    return { state: result.state, events: result.events };
  }

  const atoms: Atom[] = [{ type: 'popPending' }];
  const result = applyAtoms(state, atoms);
  return { state: result.state, events: result.events };
}

/** 决斗响应 — 简化处理 */
function resolveDuelResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  const { defender, attacker } = pending.window;
  const cardId = action.type === 'respond' ? action.cardId : undefined;

  if (cardId) {
    const atoms: Atom[] = [
      {
        type: 'moveCard',
        cardId,
        from: { zone: 'hand', player: defender },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    return { state: result.state, events: result.events };
  }

  // 没出杀 → 受伤
  const atoms: Atom[] = [
    { type: 'damage', target: defender, amount: 1, source: attacker },
    { type: 'popPending' },
  ];
  const result = applyAtoms(state, atoms);
  return { state: result.state, events: result.events };
}

/** 濒死桃响应 — 委托给 resolveDying */
function resolveDyingResponse(
  state: GameState,
  _action: GameAction,
  _pending: PendingResponseWindow,
): EngineResult {
  // 濒死桃响应在 resolveDying 中处理，此处不应到达
  const atoms: Atom[] = [{ type: 'popPending' }];
  const result = applyAtoms(state, atoms);
  return { state: result.state, events: result.events };
}

// ─── 技能恢复 ─────────────────────────────────────────────────

function resumeSkill(
  state: GameState,
  action: GameAction,
  pending: PendingSkillPrompt,
): EngineResult {
  if (action.type !== 'skillChoice') {
    return { state, events: [], error: '技能提示需要 skillChoice 动作' };
  }
  if (action.player !== pending.player) {
    return { state, events: [], error: '只有技能发动者可以做选择' };
  }

  const skill = skillRegistry.get(pending.skillId);
  if (!skill) return { state, events: [], error: `未知技能: ${pending.skillId}` };

  const ctx: SkillContext = {
    ...pending.execution.ctx,
    choice: action.choice,
  };

  // 重新执行 handler 获取完整 plan，从暂停点之后继续
  const phases = skill.handler(ctx, state);
  return executePlan(
    { ...state, pending: null },
    phases,
    ctx,
    pending.execution.phaseIndex + 1,
  );
}

// ─── 弃牌阶段处理 ─────────────────────────────────────────────

function resolveDiscardPhase(
  state: GameState,
  action: GameAction,
  pending: PendingDiscardPhase,
): EngineResult {
  if (action.type !== 'discard') {
    return { state, events: [], error: '弃牌阶段需要 discard 动作' };
  }
  if (action.player !== pending.player) {
    return { state, events: [], error: '只有当前玩家可以弃牌' };
  }
  if (action.cardIds.length < pending.min || action.cardIds.length > pending.max) {
    return { state, events: [], error: `需要弃 ${pending.min}~${pending.max} 张牌` };
  }

  // 验证卡牌在手牌中
  const playerState = getPlayer(state, action.player);
  for (const id of action.cardIds) {
    if (!playerState.hand.includes(id)) {
      return { state, events: [], error: `卡牌 ${id} 不在手牌中` };
    }
  }

  // 弃牌 → 弹出 pending → 下一玩家
  const discardAtoms: Atom[] = [
    ...action.cardIds.map(
      (cardId) =>
        ({
          type: 'moveCard',
          cardId,
          from: { zone: 'hand', player: action.player },
          to: { zone: 'discardPile' },
        }) satisfies Atom,
    ),
    { type: 'popPending' },
    { type: 'nextPlayer' },
    { type: 'setPhase', phase: '出牌' },
  ];
  const result = applyAtoms(state, discardAtoms);
  const discardEvent = makeServerEvent('cardDiscarded', {
    player: action.player,
    cardIds: action.cardIds,
  });
  const turnStartEvent = makeServerEvent('turnStart', {
    player: result.state.currentPlayer,
  });
  return {
    state: result.state,
    events: [...result.events, discardEvent, turnStartEvent],
  };
}

// ─── 濒死窗口处理 ─────────────────────────────────────────────

function resolveDying(
  state: GameState,
  action: GameAction,
  pending: PendingDyingWindow,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: '濒死窗口需要 respond 动作' };
  }

  const currentSaver = pending.savers[pending.currentSaverIndex];
  if (action.player !== currentSaver) {
    return { state, events: [], error: '当前不是你的救助回合' };
  }

  // ── 出桃救人 ──
  if (action.cardId) {
    const saverState = getPlayer(state, currentSaver);
    if (!saverState.hand.includes(action.cardId)) {
      return { state, events: [], error: '手牌中没有该卡牌' };
    }
    const card = state.cardMap[action.cardId];
    if (card.name !== '桃') {
      return { state, events: [], error: '只能出桃救人' };
    }

    const atoms: Atom[] = [
      {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player: currentSaver },
        to: { zone: 'discardPile' },
      },
      {
        type: 'heal',
        target: pending.dyingPlayer,
        amount: 1,
        source: currentSaver,
      },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    const healEvent = makeServerEvent('heal', {
      target: pending.dyingPlayer,
      amount: 1,
      source: currentSaver,
    });
    return { state: result.state, events: [...result.events, healEvent] };
  }

  // ── 不出桃 → 下一个救助者 ──
  const nextIndex = pending.currentSaverIndex + 1;

  if (nextIndex >= pending.savers.length) {
    // 无人救助 → 死亡
    const atoms: Atom[] = [
      { type: 'kill', player: pending.dyingPlayer },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    const deathEvent = makeServerEvent('death', { player: pending.dyingPlayer });
    return { state: result.state, events: [...result.events, deathEvent] };
  }

  // 移到下一个救助者
  return {
    state: {
      ...state,
      pending: { ...pending, currentSaverIndex: nextIndex },
    },
    events: [],
  };
}

// ─── 出牌处理 ─────────────────────────────────────────────────

function handlePlayCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
): EngineResult {
  const card = state.cardMap[action.cardId];
  if (!card) return { state, events: [], error: '未知卡牌' };

  switch (card.type) {
    case '基本牌':
      return handleBasicCard(state, action, card);
    case '锦囊牌':
      return handleTrickCard(state, action, card);
    case '装备牌':
      return handleEquipCard(state, action, card);
  }
}

// ── 基本牌 ──

function handleBasicCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  card: Card,
): EngineResult {
  switch (card.name) {
    case '杀':
      return handleKillCard(state, action, card);
    case '桃':
      return handlePeachCard(state, action, card);
    case '闪':
      return { state, events: [], error: '闪不能主动使用' };
    default:
      return { state, events: [], error: `不能主动使用 ${card.name}` };
  }
}

function handleKillCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  _card: Card,
): EngineResult {
  const player = action.player;
  const target = action.target;

  if (!target) return { state, events: [], error: '杀需要指定目标' };
  if (target === player) return { state, events: [], error: '不能对自己使用杀' };
  if (!isInAttackRange(state, player, target)) {
    return { state, events: [], error: '目标不在攻击范围内' };
  }

  const targetPlayer = getPlayer(state, target);
  if (!targetPlayer.info.alive) return { state, events: [], error: '目标已阵亡' };

  // 计算目标可用闪
  const validCards = targetPlayer.hand.filter(
    (id) => state.cardMap[id].name === '闪',
  );

  const timeout = TIMEOUT_DEFAULTS.killResponse;
  const responseWindow: PendingResponseWindow = {
    type: 'responseWindow',
    window: {
      type: 'killResponse',
      attacker: player,
      defender: target,
      validCards,
      sourceCard: action.cardId,
      timeout,
      deadline: Date.now() + timeout,
    },
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: 'respond', player: target },
  };

  const atoms: Atom[] = [
    {
      type: 'moveCard',
      cardId: action.cardId,
      from: { zone: 'hand', player },
      to: { zone: 'discardPile' },
    },
    { type: 'pushPending', action: responseWindow },
  ];
  const result = applyAtoms(state, atoms);

  // 更新回合杀计数
  const newState: GameState = {
    ...result.state,
    turn: {
      ...result.state.turn,
      killsPlayed: result.state.turn.killsPlayed + 1,
    },
  };

  const cardPlayedEvent = makeServerEvent('cardPlayed', {
    player,
    cardId: action.cardId,
    target,
  });
  return { state: newState, events: [...result.events, cardPlayedEvent] };
}

function handlePeachCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  _card: Card,
): EngineResult {
  const player = action.player;
  const playerState = getPlayer(state, player);

  if (playerState.health >= playerState.maxHealth) {
    return { state, events: [], error: '体力已满，不能使用桃' };
  }

  const atoms: Atom[] = [
    {
      type: 'moveCard',
      cardId: action.cardId,
      from: { zone: 'hand', player },
      to: { zone: 'discardPile' },
    },
    { type: 'heal', target: player, amount: 1, source: player },
  ];
  const result = applyAtoms(state, atoms);
  const cardPlayedEvent = makeServerEvent('cardPlayed', {
    player,
    cardId: action.cardId,
  });
  return { state: result.state, events: [...result.events, cardPlayedEvent] };
}

// ── 锦囊牌 ──

function handleTrickCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  card: Card,
): EngineResult {
  const player = action.player;
  const cardPlayedEvent = makeServerEvent('cardPlayed', {
    player,
    cardId: action.cardId,
    ...(action.target ? { target: action.target } : {}),
  });

  switch (card.name) {
    case '无中生有': {
      const atoms: Atom[] = [
        {
          type: 'moveCard',
          cardId: action.cardId,
          from: { zone: 'hand', player },
          to: { zone: 'discardPile' },
        },
        { type: 'draw', player, count: 2 },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    case '过河拆桥': {
      const target = action.target;
      if (!target) return { state, events: [], error: '过河拆桥需要指定目标' };
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) {
        return { state, events: [], error: '目标没有手牌' };
      }
      // 简化：弃第一张
      const discardCardId = targetPlayer.hand[0];
      const atoms: Atom[] = [
        {
          type: 'moveCard',
          cardId: action.cardId,
          from: { zone: 'hand', player },
          to: { zone: 'discardPile' },
        },
        {
          type: 'moveCard',
          cardId: discardCardId,
          from: { zone: 'hand', player: target },
          to: { zone: 'discardPile' },
        },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    case '顺手牵羊': {
      const target = action.target;
      if (!target) return { state, events: [], error: '顺手牵羊需要指定目标' };
      if (getDistance(state, player, target) !== 1) {
        return { state, events: [], error: '顺手牵羊目标距离必须为 1' };
      }
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.hand.length === 0) {
        return { state, events: [], error: '目标没有手牌' };
      }
      const stolenCardId = targetPlayer.hand[0];
      const atoms: Atom[] = [
        {
          type: 'moveCard',
          cardId: action.cardId,
          from: { zone: 'hand', player },
          to: { zone: 'discardPile' },
        },
        {
          type: 'moveCard',
          cardId: stolenCardId,
          from: { zone: 'hand', player: target },
          to: { zone: 'hand', player },
        },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }

    default: {
      // 其他锦囊牌（简化处理：弃掉使用的牌）
      const atoms: Atom[] = [
        {
          type: 'moveCard',
          cardId: action.cardId,
          from: { zone: 'hand', player },
          to: { zone: 'discardPile' },
        },
      ];
      const result = applyAtoms(state, atoms);
      return { state: result.state, events: [...result.events, cardPlayedEvent] };
    }
  }
}

// ── 装备牌 ──

function handleEquipCard(
  state: GameState,
  action: GameAction & { type: 'playCard' },
  _card: Card,
): EngineResult {
  const player = action.player;
  const atoms: Atom[] = [{ type: 'equip', player, cardId: action.cardId }];
  const result = applyAtoms(state, atoms);
  const cardPlayedEvent = makeServerEvent('cardPlayed', {
    player,
    cardId: action.cardId,
  });
  return { state: result.state, events: [...result.events, cardPlayedEvent] };
}

// ─── 结束回合 ─────────────────────────────────────────────────

function handleEndTurn(
  state: GameState,
  action: GameAction & { type: 'endTurn' },
): EngineResult {
  const player = action.player;
  const playerState = getPlayer(state, player);
  const handSize = playerState.hand.length;
  const health = playerState.health;
  const turnEndEvent = makeServerEvent('turnEnd', { player });

  if (handSize > health) {
    // 需要弃牌
    const discardCount = handSize - health;
    const pending: PendingDiscardPhase = {
      type: 'discardPhase',
      player,
      min: discardCount,
      max: discardCount,
      timeout: TIMEOUT_DEFAULTS.discardPhase,
      deadline: Date.now() + TIMEOUT_DEFAULTS.discardPhase,
      onTimeout: { type: 'discard', player, cardIds: [] },
    };
    const atoms: Atom[] = [
      { type: 'setPhase', phase: '弃牌' },
      { type: 'pushPending', action: pending },
    ];
    const result = applyAtoms(state, atoms);
    return { state: result.state, events: [...result.events, turnEndEvent] };
  }

  // 不需要弃牌 → 下一玩家
  const atoms: Atom[] = [
    { type: 'nextPlayer' },
    { type: 'setPhase', phase: '出牌' },
  ];
  const result = applyAtoms(state, atoms);
  const turnStartEvent = makeServerEvent('turnStart', {
    player: result.state.currentPlayer,
  });
  return {
    state: result.state,
    events: [...result.events, turnEndEvent, turnStartEvent],
  };
}

// ─── 使用技能 ─────────────────────────────────────────────────

function handleUseSkill(
  state: GameState,
  action: GameAction & { type: 'useSkill' },
): EngineResult {
  const skill = skillRegistry.get(action.skillId);
  if (!skill) return { state, events: [], error: `未知技能: ${action.skillId}` };

  const ctx: SkillContext = {
    skillId: action.skillId,
    self: action.player,
    target: action.target,
    localVars: {},
  };

  const phases = skill.handler(ctx, state);
  const activatedEvent = makeServerEvent('skillActivated', {
    player: action.player,
    skillId: action.skillId,
  });
  const planResult = executePlan(state, phases, ctx);

  // 记录技能使用
  const newState: GameState = {
    ...planResult.state,
    turn: {
      ...planResult.state.turn,
      skillsUsed: [...planResult.state.turn.skillsUsed, action.skillId],
    },
  };

  return { state: newState, events: [...planResult.events, activatedEvent] };
}

// ─── 弃牌（非弃牌阶段直接调用） ─────────────────────────────

function handleDiscard(
  state: GameState,
  _action: GameAction & { type: 'discard' },
): EngineResult {
  return { state, events: [], error: '弃牌操作仅在弃牌阶段有效' };
}

// ─── 动作验证 ─────────────────────────────────────────────────

function validate(state: GameState, action: GameAction): string | null {
  switch (action.type) {
    case 'playCard': {
      if (action.player !== state.currentPlayer) return '不是你的回合';
      if (state.phase !== '出牌') return '当前不是出牌阶段';
      const player = getPlayer(state, action.player);
      if (!player.info.alive) return '你已阵亡';
      if (!player.hand.includes(action.cardId)) return '手牌中没有此牌';

      const card = state.cardMap[action.cardId];
      if (!card) return '未知卡牌';

      if (card.name === '闪') return '闪不能主动使用';

      if (card.name === '杀') {
        if (!hasUnlimitedKills(state, action.player) && state.turn.killsPlayed >= 1) {
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

      return null;
    }

    case 'endTurn': {
      if (action.player !== state.currentPlayer) return '不是你的回合';
      if (state.phase !== '出牌') return '当前不是出牌阶段';
      return null;
    }

    case 'useSkill': {
      if (action.player !== state.currentPlayer) return '不是你的回合';
      if (!skillRegistry.has(action.skillId)) return `未知技能: ${action.skillId}`;
      return null;
    }

    case 'respond': {
      return '响应动作仅在响应窗口中有效';
    }

    case 'discard': {
      return '弃牌操作仅在弃牌阶段有效';
    }

    case 'skillChoice': {
      return '技能选择仅在技能提示中有效';
    }
  }
}
