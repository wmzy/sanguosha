// src/ai-mcp/viewProjector.ts
// GameView → AiViewSnapshot 投影：精简决策所需字段，降低 MCP token 占用。
// 见 spec §4.4。纯函数。
import type { GameView } from '../engine/types';
import type { AiViewSnapshot } from '../client/headless/types';
import { getPendingRequestType } from '../client/utils/pendingRespond';

const MAX_LOG = 20;

export function projectView(view: GameView): AiViewSnapshot {
  return {
    viewer: view.viewer,
    currentPlayerIndex: view.currentPlayerIndex,
    phase: view.phase,
    turn: { round: view.turn.round },
    players: view.players.map(p => ({
      index: p.index,
      name: p.name,
      character: p.character,
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      handCount: p.handCount,
      hand: p.hand,
      equipment: p.equipment,
      skills: p.skills,
      identity: p.identity,
    })),
    pending: view.pending
      ? {
          target: view.pending.target,
          isBlocking: view.pending.isBlocking !== false,
          promptTitle: (view.pending.prompt as { title?: string }).title ?? view.pending.prompt.type,
          requestType: getPendingRequestType(view.pending),
        }
      : null,
    zones: view.zones
      ? { deckCount: view.zones.deckCount, discardPileCount: view.zones.discardPileCount }
      : { deckCount: 0, discardPileCount: 0 },
    log: view.log.slice(-MAX_LOG),
  };
}
