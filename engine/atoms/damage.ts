import type { GameState, Atom, AtomEventResult, Json, DamageType } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

/** damage type 默认值：所有未显式指定的 damage 视为 normal */
const DEFAULT_DAMAGE_TYPE: DamageType = 'normal';

export function register() {
  registerAtom({
    type: '造成伤害',
    apply(state: GameState, atom: Atom & { type: '造成伤害' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      return updatePlayer(state, target, p => ({
        health: p.health - amount,
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: '造成伤害' }): AtomEventResult {
      const target = atom.target as string;
      const amount = atom.amount as number;
      const source = atom.source as string | undefined;
      const cardId = atom.cardId as string | undefined;
      // Atom 内字段用 damageType（避免和 Atom 联合判别字段 type 冲突），
      // 事件 payload 命名仍为 type（对外协议保持简洁）。
      const damageType = (atom.damageType as DamageType | undefined) ?? DEFAULT_DAMAGE_TYPE;
      const payload: Json = {
        target,
        amount,
        type: damageType,
        ...(source ? { source } : {}),
        ...(cardId ? { cardId } : {}),
      };
      const server = makeServerEvent('造成伤害', payload);
      return [server, new Map(), makePlayerEvent('造成伤害', payload)];
    },
  });
}
