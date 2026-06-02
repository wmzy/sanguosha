import { isDeepStrictEqual } from 'node:util';
import type { Expr, Condition, GameState, SkillContext } from './types';
import { isExpr } from './types';
import { getPlayer, getAlivePlayerNames, getCard } from './state';
import { getDistance } from './distance';

const MAX_DEPTH = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getByPath(root: unknown, path: string): unknown {
  let result: unknown = root;
  for (const part of path.split('.')) {
    if (result == null) return undefined;
    if (Array.isArray(result)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      result = result[idx];
    } else if (typeof result === 'object') {
      result = (result as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return result;
}

export function resolve<T>(expr: Expr<T>, state: GameState, ctx?: SkillContext, depth = 0): T {
  if (depth > MAX_DEPTH) {
    throw new Error(`resolve: max recursion depth (${MAX_DEPTH}) exceeded`);
  }

  if (!isExpr(expr)) {
    return expr as T;
  }

  if (!isRecord(expr)) return undefined as T;
  const tag = expr['$'];

  switch (tag) {
    case 'ctx': {
      const path = expr['path'];
      if (typeof path !== 'string') throw new Error('resolve ctx: path must be string');
      if (!ctx) throw new Error('resolve ctx: no SkillContext provided');
      return getByPath(ctx, path) as T;
    }

    case 'event': {
      const path = expr['path'];
      if (typeof path !== 'string') throw new Error('resolve event: path must be string');
      if (!ctx) throw new Error('resolve event: no SkillContext provided');
      return getByPath(ctx.event, path) as T;
    }

    case 'var': {
      const playerName = resolve(expr['player'] as Expr<string>, state, ctx, depth + 1);
      const player = getPlayer(state, playerName);
      return player.vars[expr['key'] as string] as T;
    }

    case 'count': {
      const source = resolve(expr['source'], state, ctx, depth + 1);
      if (Array.isArray(source)) return source.length as T;
      const player = getPlayer(state, source as string);
      if (!player) return 0 as T;
      const zone = player[source as keyof typeof player];
      if (Array.isArray(zone)) return zone.length as T;
      return 0 as T;
    }

    case 'distance': {
      const from = resolve(expr['from'] as Expr<string>, state, ctx, depth + 1);
      const to = resolve(expr['to'] as Expr<string>, state, ctx, depth + 1);
      return getDistance(state, from, to) as T;
    }

    case 'cardProp': {
      const cardId = resolve(expr['card'] as Expr<string>, state, ctx, depth + 1);
      const card = getCard(state, cardId);
      return card[expr['prop'] as keyof typeof card] as T;
    }

    case 'cond': {
      const condResult = checkCondition(expr['check'] as Condition, state, ctx, depth);
      if (condResult) {
        return resolve(expr['then'] as Expr<T>, state, ctx, depth + 1);
      }
      return resolve(expr['else'] as Expr<T>, state, ctx, depth + 1);
    }

    case 'add': {
      const left = resolve(expr['left'] as Expr<number>, state, ctx, depth + 1);
      const right = resolve(expr['right'] as Expr<number>, state, ctx, depth + 1);
      return (left + right) as T;
    }

    case 'sub': {
      const left = resolve(expr['left'] as Expr<number>, state, ctx, depth + 1);
      const right = resolve(expr['right'] as Expr<number>, state, ctx, depth + 1);
      return (left - right) as T;
    }

    case 'handSize': {
      const playerName = resolve(expr['player'] as Expr<string>, state, ctx, depth + 1);
      const player = getPlayer(state, playerName);
      return player.hand.length as T;
    }

    case 'aliveCount': {
      return getAlivePlayerNames(state).length as T;
    }

    default:
      return expr;
  }
}

export function checkCondition(condition: Condition, state: GameState, ctx?: SkillContext, depth = 0): boolean {
  if (depth > MAX_DEPTH) {
    throw new Error(`checkCondition: max recursion depth (${MAX_DEPTH}) exceeded`);
  }

  if ('equals' in condition) {
    const [a, b] = condition.equals;
    const ra = isExpr(a) ? resolve(a, state, ctx, depth + 1) : a;
    const rb = isExpr(b) ? resolve(b, state, ctx, depth + 1) : b;
    return isDeepStrictEqual(ra, rb);
  }

  if ('notEquals' in condition) {
    const [a, b] = condition.notEquals;
    const ra = isExpr(a) ? resolve(a, state, ctx, depth + 1) : a;
    const rb = isExpr(b) ? resolve(b, state, ctx, depth + 1) : b;
    return !isDeepStrictEqual(ra, rb);
  }

  if ('gte' in condition) {
    const a = resolve(condition.gte[0], state, ctx, depth + 1);
    const b = resolve(condition.gte[1], state, ctx, depth + 1);
    return a >= b;
  }

  if ('lte' in condition) {
    const a = resolve(condition.lte[0], state, ctx, depth + 1);
    const b = resolve(condition.lte[1], state, ctx, depth + 1);
    return a <= b;
  }

  if ('gt' in condition) {
    const a = resolve(condition.gt[0], state, ctx, depth + 1);
    const b = resolve(condition.gt[1], state, ctx, depth + 1);
    return a > b;
  }

  if ('lt' in condition) {
    const a = resolve(condition.lt[0], state, ctx, depth + 1);
    const b = resolve(condition.lt[1], state, ctx, depth + 1);
    return a < b;
  }

  if ('hasVar' in condition) {
    const playerName = resolve(condition.hasVar.player, state, ctx, depth + 1);
    const player = getPlayer(state, playerName);
    return condition.hasVar.key in player.vars;
  }

  if ('hasTag' in condition) {
    const playerName = resolve(condition.hasTag.player, state, ctx, depth + 1);
    const player = getPlayer(state, playerName);
    return player.tags.includes(condition.hasTag.tag);
  }

  if ('isAlive' in condition) {
    const playerName = resolve(condition.isAlive, state, ctx, depth + 1);
    const player = getPlayer(state, playerName);
    return player.info.alive;
  }

  if ('handEmpty' in condition) {
    const playerName = resolve(condition.handEmpty, state, ctx, depth + 1);
    const player = getPlayer(state, playerName);
    return player.hand.length === 0;
  }

  if ('hasValue' in condition) {
    const val = resolve(condition.hasValue, state, ctx, depth + 1);
    return val != null;
  }

  if ('and' in condition) {
    return condition.and.every(c => checkCondition(c, state, ctx, depth + 1));
  }

  if ('or' in condition) {
    return condition.or.some(c => checkCondition(c, state, ctx, depth + 1));
  }

  if ('not' in condition) {
    return !checkCondition(condition.not, state, ctx, depth + 1);
  }

  return false;
}
