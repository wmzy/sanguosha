import type { GameState } from './types';

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  const obj: unknown = JSON.parse(json);
  if (!validateGameState(obj)) {
    throw new Error('Invalid GameState structure');
  }
  return obj;
}

export function validateGameState(obj: unknown): obj is GameState {
  if (typeof obj !== 'object' || obj === null) return false;

  const o = obj as Record<string, unknown>;

  if (typeof o['meta'] !== 'object' || o['meta'] === null) return false;
  if (typeof o['phase'] !== 'string') return false;
  if (typeof o['currentPlayer'] !== 'string') return false;
  if (!Array.isArray(o['playerOrder'])) return false;
  if (typeof o['players'] !== 'object' || o['players'] === null) return false;
  if (typeof o['zones'] !== 'object' || o['zones'] === null) return false;
  if (typeof o['cardMap'] !== 'object' || o['cardMap'] === null) return false;
  if (typeof o['turn'] !== 'object' || o['turn'] === null) return false;
  if (!Array.isArray(o['triggers'])) return false;
  if (!Array.isArray(o['serverLog'])) return false;
  if (typeof o['playerLogs'] !== 'object' || o['playerLogs'] === null) return false;
  if (typeof o['rngState'] !== 'number') return false;

  const meta = o['meta'] as Record<string, unknown>;
  if (typeof meta['id'] !== 'string') return false;
  if (typeof meta['seed'] !== 'number') return false;
  if (typeof meta['round'] !== 'number') return false;
  if (typeof meta['turnNumber'] !== 'number') return false;
  if (typeof meta['status'] !== 'string') return false;

  if (o['pending'] !== null && typeof o['pending'] !== 'object') return false;

  return true;
}
