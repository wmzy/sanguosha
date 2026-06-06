import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

/**
 * useCard: 旧 v2 路径"使用一张牌"的钩子点。
 *
 * 现状：[T-13] 决策下被 specifyTarget → becomeTarget → resolveCard 三原子取代，
 * 本原子保留为"v2 兼容"——v3 钩子（leiji / 火杀 +1 等）按 useCard 字面量注册，
 * 等旧 v2 useCard GameEvent 路径上 emit 本原子时自动接入。
 *
 * 本占位原子：apply 不改 state，toEvents 输出 server event 'useCard' 供 log/审计。
 * 完整 v2 useCard 路径还原留 P2 follow-up。
 */
export function register() {
  registerAtom({
    type: 'useCard',
    apply(s: GameState) {
      return s;
    },
    toEvents(_s, atom): AtomEventResult {
      const a = atom as Atom & { type: 'useCard' };
      const source = (a as { source?: unknown }).source as string | undefined;
      const target = (a as { target?: unknown }).target as string | undefined;
      const cardId = (a as { cardId?: unknown }).cardId as string | undefined;
      const payload: Record<string, string> = {};
      if (source !== undefined) payload.source = source;
      if (target !== undefined) payload.target = target;
      if (cardId !== undefined) payload.cardId = cardId;
      return [makeServerEvent('useCard', payload), new Map(), null];
    },
  });
}
