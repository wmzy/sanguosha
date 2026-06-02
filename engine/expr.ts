import type { Expr, Condition, GameState, SkillContext } from './types';
import { isExpr } from './types';
import { getPlayer, getAlivePlayerNames, getCard } from './state';
import { getDistance } from './distance';

const MAX_DEPTH = 20;

export function resolve<T>(expr: Expr<T>, state: GameState, ctx?: SkillContext, depth = 0): T {
  if (depth > MAX_DEPTH) {
    throw new Error(`resolve: max recursion depth (${MAX_DEPTH}) exceeded`);
  }

  if (!isExpr(expr)) {
    return expr as T;
  }

  const e = expr as Record<string, unknown>;
  const tag = e.$ as string;

  switch (tag) {
    case 'ctx': {
      const path = e.path as string;
      if (!ctx) throw new Error('resolve ctx: no SkillContext provided');
      const parts = path.split('.');
      let result: unknown = ctx;
      for (const part of parts) {
        if (result == null || typeof result !== 'object') return undefined as T;
        result = (result as Record<string, unknown>)[part];
      }
      return result as T;
    }

    case 'event': {
      const path = e.path as string;
      if (!ctx) throw new Error('resolve event: no SkillContext provided');
      return (ctx.event as unknown as Record<string, unknown>)[path] as T;
    }

    case 'var': {
      const playerName = resolve(e.player as Expr<string>, state, ctx, depth + 1);
      const player = getPlayer(state, playerName);
      return player.vars[e.key as string] as T;
    }

    case 'count': {
      const source = resolve(e.source, state, ctx, depth + 1);
      // source 可能是数组（从 ctx 获取），也可能是玩家名
      if (Array.isArray(source)) return source.length as T;
      const player = getPlayer(state, source as string);
      if (!player) return 0 as T;
      const zone = player[source as keyof typeof player];
      if (Array.isArray(zone)) return zone.length as T;
      return 0 as T;
    }

    case 'distance': {
      const from = resolve(e.from as Expr<string>, state, ctx, depth + 1);
      const to = resolve(e.to as Expr<string>, state, ctx, depth + 1);
      return getDistance(state, from, to) as T;
    }

    case 'cardProp': {
      const cardId = resolve(e.card as Expr<string>, state, ctx, depth + 1);
      const card = getCard(state, cardId);
      return card[e.prop as keyof typeof card] as T;
    }

    case 'cond': {
      const condResult = checkCondition(e.check as Condition, state, ctx, depth);
      if (condResult) {
        return resolve(e.then as Expr<T>, state, ctx, depth + 1);
      }
      return resolve(e.else as Expr<T>, state, ctx, depth + 1);
    }

    case 'add': {
      const left = resolve(e.left as Expr<number>, state, ctx, depth + 1);
      const right = resolve(e.right as Expr<number>, state, ctx, depth + 1);
      return (left + right) as T;
    }

    case 'sub': {
      const left = resolve(e.left as Expr<number>, state, ctx, depth + 1);
      const right = resolve(e.right as Expr<number>, state, ctx, depth + 1);
      return (left - right) as T;
    }

    case 'handSize': {
      const playerName = resolve(e.player as Expr<string>, state, ctx, depth + 1);
      const player = getPlayer(state, playerName);
      return player.hand.length as T;
    }

    case 'aliveCount': {
      return getAlivePlayerNames(state).length as T;
    }

    default:
      return expr as T;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = Object.keys(aObj);
  if (keys.length !== Object.keys(bObj).length) return false;
  return keys.every(k => deepEqual(aObj[k], bObj[k]));
}

export function checkCondition(condition: Condition, state: GameState, ctx?: SkillContext, depth = 0): boolean {
  if (depth > MAX_DEPTH) {
    throw new Error(`checkCondition: max recursion depth (${MAX_DEPTH}) exceeded`);
  }

  if ('equals' in condition) {
    const [a, b] = condition.equals;
    const ra = isExpr(a) ? resolve(a, state, ctx, depth + 1) : a;
    const rb = isExpr(b) ? resolve(b, state, ctx, depth + 1) : b;
    return deepEqual(ra, rb);
  }

  if ('notEquals' in condition) {
    const [a, b] = condition.notEquals;
    const ra = isExpr(a) ? resolve(a, state, ctx, depth + 1) : a;
    const rb = isExpr(b) ? resolve(b, state, ctx, depth + 1) : b;
    return !deepEqual(ra, rb);
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
