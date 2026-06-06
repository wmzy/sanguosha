import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

/** damage type 默认值：所有未显式指定的 damage 视为 normal */
const DEFAULT_DAMAGE_TYPE = 'normal' as const;

export function register() {
  registerAtom({
    type: 'damage',
    apply(state: GameState, atom: Atom & { type: 'damage' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      return updatePlayer(state, target, p => ({
        health: p.health - amount,
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'damage' }): AtomEventResult {
      const target = atom.target as string;
      const amount = atom.amount as number;
      const source = atom.source as string | undefined;
      const cardId = atom.cardId as string | undefined;
      // Atom 内字段用 damageType（避免和 Atom 联合判别字段 type 冲突），
      // 事件 payload 命名仍为 type（对外协议保持简洁）。
      const damageType = (atom.damageType as 'normal' | 'fire' | 'thunder' | undefined) ?? DEFAULT_DAMAGE_TYPE;
      const payload: Json = {
        target,
        amount,
        type: damageType,
        ...(source ? { source } : {}),
        ...(cardId ? { cardId } : {}),
      };
      const server = makeServerEvent('damage', payload);
      return [server, new Map(), makePlayerEvent('damage', payload)];
    },
  });
}
