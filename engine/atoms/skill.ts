import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { getSkill } from '../skill';

export function register() {
  registerAtom({
    type: '加技能',
    apply(state: GameState, atom: Atom & { type: '加技能' }): GameState {
      const player = atom.player as string;
      const skillId = atom.skillId;
      const source = atom.source as { characterMap: Record<string, import('../../shared/types').CharacterConfig> };

      const def = getSkill(skillId);
      const alreadyHas = state.triggers.some(
        t => t.player === player && t.skillId === skillId && t.source === '角色',
      );
      if (alreadyHas) return state;
      // v3-only skill（无 trigger）不进入 v2 state.triggers。
      if (!def.trigger) return state;

      const newTrigger = {
        event: def.trigger.event,
        source: '角色' as const,
        skillId,
        player,
        priority: 5,
        ...(def.trigger.optional ? { optional: true } : {}),
      };

      return { ...state, triggers: [...state.triggers, newTrigger] };
    },
    toEvents(state: GameState, atom: Atom & { type: '加技能' }): AtomEventResult {
      const player = atom.player as string;
      const skillId = atom.skillId;
      const payload: Json = { player, skillId };
      const server = makeServerEvent('加技能', payload);
      const ownerEvent = makePlayerEvent('加技能', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });
}
