import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { getSkill } from '../skill';

export function register() {
  registerAtom({
    type: 'addSkill',
    apply(state: GameState, atom: Atom & { type: 'addSkill' }): GameState {
      const player = atom.player as string;
      const skillId = atom.skillId as string;
      const source = atom.source as { characterMap: Record<string, import('../../shared/types').CharacterConfig> };

      const def = getSkill(skillId);
      const alreadyHas = state.triggers.some(
        t => t.player === player && t.skillId === skillId && t.source === 'character',
      );
      if (alreadyHas) return state;

      const newTrigger = {
        event: def.trigger.event,
        source: 'character' as const,
        skillId,
        player,
        priority: 5,
        ...(def.trigger.optional ? { optional: true } : {}),
      };

      return { ...state, triggers: [...state.triggers, newTrigger] };
    },
    toEvents(state: GameState, atom: Atom & { type: 'addSkill' }): AtomEventResult {
      const player = atom.player as string;
      const skillId = atom.skillId as string;
      const payload: Json = { player, skillId };
      const server = makeServerEvent('addSkill', payload);
      const ownerEvent = makePlayerEvent('addSkill', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });
}
