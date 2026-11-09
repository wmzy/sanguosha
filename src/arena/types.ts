import type { GameView, ClientMessage, Card, ViewEvent } from '../engine/types';
import type { AiViewSnapshot, AvailableAction, ChatMessage } from '../client/headless/types';

export interface ApiPlayerConfig {
  protocol: 'openai-compatible' | 'gemini';
  model: string;
  baseUrl?: string;
  apiKeyEnv: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ArenaPlayerConfig {
  id: string;
  name: string;
  mode: 'api' | 'mcp' | 'heuristic';
  api?: ApiPlayerConfig;
  persona?: string;
}

export interface ArenaConfig {
  name: string;
  serverUrl?: string;
  players: ArenaPlayerConfig[];
  timeoutSec?: number;
  decisionTimeoutMs?: number;
  maxDurationMs?: number;
  maxDecisions?: number;
  charPool?: 'standard' | 'extended' | 'all';
  archiveDir?: string;
}

export interface ArenaMenuAction extends AvailableAction {
  actionId: string;
  /** Concrete legal options for distribute actions, kept separate from their default params. */
  selection?: {
    mode: 'allocate' | 'select';
    cardIds: string[];
    targets?: number[];
    minTotal: number;
    maxTotal: number;
    minPerTarget?: number;
    maxPerTarget?: number;
    allowSelf?: boolean;
  };
}

export interface VisibleCards {
  visibility: 'private' | 'public';
  source: string;
  cards: Card[];
}

export interface ArenaObservation {
  decisionId: string;
  windowId?: string;
  seq: number;
  state: AiViewSnapshot;
  privatePrompt: GameView['pending'];
  visibleCards: VisibleCards[];
  publicChat: ChatMessage[];
  recentEvents?: ViewEvent[];
  actions: ArenaMenuAction[];
}

export interface ArenaDecision {
  decisionId?: string;
  actionId: string;
  params?: ClientMessage['params'];
  memory?: string;
  strategySummary?: string;
  publicSpeech?: string;
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelReply {
  decision: ArenaDecision;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ArenaManifest {
  id: string;
  name: string;
  roomId: string | null;
  startedAt: number;
  endedAt?: number;
  status: 'preparing' | 'playing' | 'completed' | 'interrupted';
  winner?: string;
  players: Array<{ id: string; name: string; mode: ArenaPlayerConfig['mode']; model?: string }>;
  error?: string;
}

export interface ArenaDecisionRecord {
  decisionId: string;
  seq: number;
  at: number;
  playerId: string;
  seat: number;
  decision: ArenaDecision;
  action: ClientMessage;
  source: 'model' | 'mcp' | 'fallback' | 'heuristic';
  elapsedMs: number;
  result?: string;
  error?: string;
  usage?: ModelReply['usage'];
}
