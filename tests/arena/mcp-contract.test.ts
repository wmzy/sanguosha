import { describe, expect, it, vi } from 'vitest';
import { handleMcpRequest, type McpHandlerContext } from '../../src/ai-mcp/mcpServer';
import type { ArenaPlayerSession } from '../../src/arena/player';
import type { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import type { ArenaObservation } from '../../src/arena/types';

describe('MCP decision window contract', () => {
  it.each(['before speech', 'during speech'])('does not execute a stale decision %s', async (when) => {
    let current = when !== 'before speech';
    const observation = { decisionId: '0:3', seq: 3, actions: [{ actionId: 'a0',
      message: { skillId: '杀', actionType: 'use', ownerId: 0, params: { targets: [1] }, baseSeq: 3 }, validTargets: [1], category: 'play',
    }] } as unknown as ArenaObservation;
    const sendAction = vi.fn();
    const hgc = { phase: 'playing', view: null, seatIndex: 0, lastSeq: 6, roomId: 'r', playerId: 'p',
      needsAction: () => true, getAvailableActions: () => [], consumeActionRejected: () => false,
      drainNewEvents: () => [], sendAction, sendChat: async () => { current = false; },
    } as unknown as HeadlessGameClient;
    const record = vi.fn();
    const arena = { current: observation, playerId: 'one', memory: '', isCurrent: () => current,
      observe: async () => ({ ...observation, decisionId: '0:6' }), record,
    } as unknown as ArenaPlayerSession;
    const ctx = { hgc, arena, isStarted: () => true } as unknown as McpHandlerContext;
    const response = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'play', arguments: { actionId: 'a0', decisionId: '0:3', publicSpeech: '进攻', waitTimeoutMs: 10 } },
    }, ctx);
    expect(sendAction).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).toContain('staleDecision');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ result: 'stale' }));
  });
});
