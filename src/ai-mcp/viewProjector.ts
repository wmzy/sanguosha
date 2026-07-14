// src/ai-mcp/viewProjector.ts
// GameView → AiViewSnapshot 投影 + 增量 diff 计算。
// projectView: 完整投影（getSnapshot 工具用）。
// projectDiff: 两次投影之间的增量（play 工具用，降低 token）。
// 纯函数。见 spec §4.4。
import type { GameView } from '../engine/types';
import type { AiViewSnapshot } from '../client/headless/types';
import { getPendingRequestType } from '../client/utils/pendingRespond';

const MAX_LOG = 20;

/** 完整视图投影。getSnapshot 工具调用。 */
export function projectView(view: GameView): AiViewSnapshot {
  return {
    viewer: view.viewer,
    currentPlayerIndex: view.currentPlayerIndex,
    phase: view.phase,
    turn: { round: view.turn.round },
    players: view.players.map((p) => ({
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
          promptTitle:
            (view.pending.prompt as { title?: string }).title ?? view.pending.prompt.type,
          requestType: getPendingRequestType(view.pending),
          candidates:
            (
              view.pending.atom as {
                type: string;
                candidates?: Array<{ name: string; skills: string[] }>;
              }
            ).type === '选将询问'
              ? (view.pending.atom as { candidates: Array<{ name: string; skills: string[] }> })
                  .candidates
              : undefined,
        }
      : null,
    zones: view.zones
      ? { deckCount: view.zones.deckCount, discardPileCount: view.zones.discardPileCount }
      : { deckCount: 0, discardPileCount: 0 },
    log: view.log.slice(-MAX_LOG),
  };
}

// ── 增量 diff ──────────────────────────────────────────────────

/** 单个玩家的变化字段（只含发生变化的字段 + index）。 */
export interface PlayerStateDiff {
  index: number;
  name?: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  handCount?: number;
  hand?: AiViewSnapshot['players'][number]['hand'];
  equipment?: AiViewSnapshot['players'][number]['equipment'];
  skills?: string[];
  faction?: string;
  identity?: string;
}

/** 状态增量：只含变化的玩家和区域。 */
export interface ViewStateDiff {
  players: PlayerStateDiff[];
  zones?: { deckCount: number; discardPileCount: number };
}

/** 深比较两个 JSON 可序列化值。 */
function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 比较单个玩家，返回变化字段。prev 为 undefined 时返回全量。 */
function diffPlayer(
  prev: AiViewSnapshot['players'][number] | undefined,
  curr: AiViewSnapshot['players'][number],
): PlayerStateDiff | null {
  if (!prev) return { ...curr };
  const d: PlayerStateDiff = { index: curr.index };
  let changed = false;
  if (prev.name !== curr.name) { d.name = curr.name; changed = true; }
  if (prev.character !== curr.character) { d.character = curr.character; changed = true; }
  if (prev.health !== curr.health) { d.health = curr.health; changed = true; }
  if (prev.maxHealth !== curr.maxHealth) { d.maxHealth = curr.maxHealth; changed = true; }
  if (prev.alive !== curr.alive) { d.alive = curr.alive; changed = true; }
  if (prev.handCount !== curr.handCount) { d.handCount = curr.handCount; changed = true; }
  if (!jsonEq(prev.hand, curr.hand)) { d.hand = curr.hand; changed = true; }
  if (!jsonEq(prev.equipment, curr.equipment)) { d.equipment = curr.equipment; changed = true; }
  if (!jsonEq(prev.skills, curr.skills)) { d.skills = curr.skills; changed = true; }
  if (prev.faction !== curr.faction) { d.faction = curr.faction; changed = true; }
  if (prev.identity !== curr.identity) { d.identity = curr.identity; changed = true; }
  return changed ? d : null;
}

/**
 * 计算两次投影之间的状态增量。
 * prev 为 null 时，所有玩家字段都视为"新增"（首次全量 diff）。
 * 只比较 players 和 zones；pending / log / currentPlayerIndex / turn 由调用方全量返回。
 */
export function projectDiff(prev: AiViewSnapshot | null, curr: AiViewSnapshot): ViewStateDiff {
  const prevPlayers = new Map(prev?.players.map((p) => [p.index, p]));
  const playerDiffs: PlayerStateDiff[] = [];
  for (const cp of curr.players) {
    const pp = prevPlayers.get(cp.index);
    const d = diffPlayer(pp, cp);
    if (d) playerDiffs.push(d);
  }
  const result: ViewStateDiff = { players: playerDiffs };
  const pz = prev?.zones;
  const cz = curr.zones;
  if (!pz || pz.deckCount !== cz.deckCount || pz.discardPileCount !== cz.discardPileCount) {
    result.zones = cz;
  }
  return result;
}
