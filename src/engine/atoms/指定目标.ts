// src/engine/atoms/指定目标.ts
// 指定目标:事件标记(目标关系在事件流中记录)
import type { AtomDefinition } from '../types';
import { requirePlayer } from './_helpers';
import { HIGHLIGHT_EFFECT, makeEventMarkerAtom, targetEventView } from './_eventMarker';

export const 指定目标: AtomDefinition<{ source: number; cardId?: string; target: number }> =
  makeEventMarkerAtom('指定目标', {
    validate: (state, atom) =>
      requirePlayer(state, atom.source, 'source') ?? requirePlayer(state, atom.target, 'target'),
    buildView: targetEventView,
    effect: HIGHLIGHT_EFFECT,
    toViewLog(event, _viewer, resolveName) {
      const target = event.target as number;
      const targetName = resolveName?.(target) ?? `P${target}`;
      const source = event.source as number;
      const _sourceName = resolveName?.(source) ?? `P${source}`;
      const cardName = event.cardName ?? event.cardId;
      const cardPart = cardName ? `使用 ${cardName} ` : '';
      return {
        player: source,
        text: `${cardPart}指定 ${targetName} 为目标`,
      };
      // 原先走以下路径但未使用,保留未使用文案以防回归——
      // return event.cardId
      //   ? { player: event.source as number, text: `使用 ${event.cardName ?? event.cardId} 指定 P${target} 为目标` }
      //   : { player: event.source as number, text: `指定 P${target} 为目标` };
    },
  });
