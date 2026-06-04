// shared/typeGuards.ts
import type { PendingAction, Json } from '../engine/types';
import type { CardInfo } from '../engine/view/types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasStringProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, string> {
  return isRecord(value) && typeof value[key] === 'string';
}

export function isCardInfo(value: unknown): value is CardInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.subtype === 'string'
  );
}

export function isPendingAction(value: unknown): value is PendingAction {
  if (!isRecord(value)) return false;
  const type = value.type;
  return (
    typeof type === 'string' &&
    ['playPhase', 'responseWindow', 'skillPrompt', 'discardPhase', 'dyingWindow', 'selectCard', 'harvestSelection'].includes(type)
  );
}

export function isJsonValue(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

export function assertDefined<T>(value: T | undefined | null, message?: string): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message ?? 'Expected defined value');
  }
}

export function narrowArray<T>(value: unknown, guard: (v: unknown) => v is T): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(guard);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function isRecordOf<T>(value: unknown, guard: (v: unknown) => v is T): value is Record<string, T> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(guard);
}

export function asJson<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value));
}
