import type { GameState, Atom, GameEvent } from './types';

type DamageAtom = Extract<Atom, { type: 'damage' }>;
type HealAtom = Extract<Atom, { type: 'heal' }>;

type GameEventGenerator = (state: GameState, atom: Atom) => GameEvent[];

const damageEvents: GameEventGenerator = (_state, atom) => {
  const d = atom as DamageAtom;
  const event: GameEvent = {
    type: 'damageReceived',
    target: d.target as string,
    source: (d.source as string) ?? '',
    amount: d.amount as number,
    ...(d.cardId != null ? { cardId: d.cardId as string } : {}),
  };
  return [event];
};

const healEvents: GameEventGenerator = (_state, atom) => {
  const h = atom as HealAtom;
  const event: GameEvent = {
    type: 'heal',
    target: h.target as string,
    amount: h.amount as number,
  };
  if (h.source != null) {
    (event as Record<string, unknown>).source = h.source;
  }
  return [event];
};

export const ATOM_GAME_EVENTS: Record<string, GameEventGenerator> = {
  damage: damageEvents,
  heal: healEvents,
};
