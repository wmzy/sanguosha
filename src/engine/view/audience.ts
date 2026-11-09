import type { GameState, GameView } from '../types';
import { buildView } from './buildView';

/** Build the shared audience view: public game state plus every player's hand. */
export function buildAudienceView(state: GameState): GameView {
  const view = buildView(state, -1);
  view.players = view.players.map((playerView, index) => ({
    ...playerView,
    name: state.players[index].nickname ?? playerView.name,
    hand: state.players[index].hand
      .map((cardId) => state.cardMap[cardId])
      .filter((card) => card !== undefined),
  }));
  return view;
}
