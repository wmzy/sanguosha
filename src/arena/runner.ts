import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import type { ChatMessage } from '../client/headless/types';
import { DEFAULT_ROOM_CONFIG } from '../server/protocol';
import { runPlay } from '../ai-mcp/playHandler';
import { rankActions } from '../ai-mcp/heuristics';
import { ArenaArchive } from './archive';
import { publicSnapshot } from './observation';
import { ArenaPlayerSession } from './player';
import { resolveDecision } from './decision';
import { callModel } from './providers';
import type { ArenaConfig, ArenaDecision, ArenaManifest, ArenaPlayerConfig, ArenaObservation, ModelReply } from './types';

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function fallbackDecision(observation: ArenaObservation, error?: string): ArenaDecision {
  const ranked = rankActions(observation.state, observation.actions);
  const action = ranked[0];
  if (!action) throw new Error('当前没有可提交动作');
  return {
    decisionId: observation.decisionId,
    actionId: observation.actions.find((a) => a.message === action.message)?.actionId ?? observation.actions[0].actionId,
    strategySummary: error ? '模型本次未能完成决策，由启发式策略接管。' : '启发式基线玩家选择当前动作。',
  };
}

export async function runArena(config: ArenaConfig, options: { signal?: AbortSignal; log?: (message: string) => void } = {}): Promise<ArenaManifest> {
  if (config.players.length < 2 || config.players.length > 8) throw new Error('AI 对局人数必须为 2–8');
  if (new Set(config.players.map((p) => p.id)).size !== config.players.length) throw new Error('玩家 id 不能重复');
  for (const p of config.players) {
    if (p.mode === 'api' && (!p.api || !process.env[p.api.apiKeyEnv])) throw new Error(`${p.name}: 请配置 API 和 ${p.api?.apiKeyEnv ?? 'apiKeyEnv'}`);
  }
  const server = (config.serverUrl ?? 'http://localhost:3930').replace(/\/$/, '');
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const archive = new ArenaArchive(id, config.archiveDir);
  const manifest: ArenaManifest = {
    id, name: config.name, roomId: null, startedAt: Date.now(), status: 'preparing',
    players: config.players.map((p) => ({ id: p.id, name: p.name, mode: p.mode, model: p.api?.model })),
  };
  archive.write('manifest.json', manifest);
  archive.write('config.json', config); // Config refers to key env names; never stores key values.
  const log = options.log ?? (() => {});
  const clients: HeadlessGameClient[] = [];
  const modelAbort = new AbortController();
  let observer: HeadlessGameClient | undefined;
  let finished = false;
  let decisions = 0;
  let externalDecisions = 0;
  let lastAudienceSeq = -1;
  let publicChat: ChatMessage[] = [];
  const started = Date.now();
  const stopped = () => finished || options.signal?.aborted === true || Date.now() - started > (config.maxDurationMs ?? 1_800_000) || decisions + externalDecisions >= (config.maxDecisions ?? 4000);
  const request = async (path: string, token?: string, body?: unknown, method?: string) => {
    const response = await fetch(`${server}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
    return response.json();
  };
  const account = async (name: string, index: number) => {
    const result = await request('/api/auth/register', undefined, {
      username: `ai-${id.slice(-10)}-${index}`,
      password: randomBytes(16).toString('hex'),
    }) as { token: string };
    await request('/api/auth/profile', result.token, { displayName: name.replace(/\s+/g, '').slice(0, 24) }, 'PATCH');
    return result.token;
  };
  const captureAudience = async (token: string) => {
    const frame = await request(`/api/rooms/${manifest.roomId}/audience`, token) as { seq: number; view: unknown } | null;
    if (frame && frame.seq !== lastAudienceSeq) {
      lastAudienceSeq = frame.seq;
      archive.write('audience.json', frame);
      archive.append('audience.jsonl', frame);
    }
  };

  const playPlayer = async (player: ArenaPlayerConfig, session: ArenaPlayerSession) => {
    let previousSubmission = '';
    let repeated = 0;
    while (!stopped()) {
      const result = await runPlay(session.hgc, { waitTimeoutMs: 500 });
      session.noteEvents(result.newLog);
      if (result.gameOver) return;
      if (!result.needsAction) continue;
      const observation = await session.observe();
      if (!observation?.actions.length) { await pause(60); continue; }
      let decision: ArenaDecision;
      let usage: ModelReply['usage'];
      let error: string | undefined;
      let source: 'model' | 'heuristic' | 'fallback' = player.mode === 'api' ? 'model' : 'heuristic';
      const at = Date.now();
      try {
        if (player.mode === 'api') {
          const deadline = observation.state.deadline;
          const budget = Math.min(config.decisionTimeoutMs ?? 25000, deadline ? Math.max(500, deadline - Date.now() - 350) : Infinity);
          const signal = AbortSignal.any([AbortSignal.timeout(budget), modelAbort.signal, ...(options.signal ? [options.signal] : [])]);
          const reply = await callModel(player.api!, await session.messages(observation), signal);
          decision = reply.decision;
          usage = reply.usage;
        } else decision = fallbackDecision(observation);
        resolveDecision(observation, decision);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        source = 'fallback';
        decision = fallbackDecision(observation, error);
      }
      if (stopped()) {
        session.record({ decisionId: observation.decisionId, seq: observation.seq, at, playerId: player.id,
          seat: observation.state.viewer, decision, action: resolveDecision(observation, decision),
          source, elapsedMs: Date.now() - at, result: 'cancelled', error, usage });
        break;
      }
      // A response window may have expired while the model was thinking. Do not replay it
      // into the next window; make a new observation instead.
      if (!session.isCurrent(observation)) {
        session.record({ decisionId: observation.decisionId, seq: observation.seq, at, playerId: player.id,
          seat: observation.state.viewer, decision, action: resolveDecision(observation, decision),
          source, elapsedMs: Date.now() - at, result: 'stale', error, usage });
        continue;
      }
      const action = resolveDecision(observation, decision);
      const signature = JSON.stringify(action.params) + action.skillId + observation.state.pending?.requestType;
      repeated = signature === previousSubmission ? repeated + 1 : 0;
      previousSubmission = signature;
      if (repeated > 2) {
        const skip = observation.actions.find((a) => a.category === 'skip');
        if (skip) {
          decision = { actionId: skip.actionId, strategySummary: '重复动作未推进，跳过当前可选操作。' };
          source = 'fallback';
        }
      }
      let speechError: string | undefined;
      if (decision.publicSpeech?.trim()) {
        try { await session.hgc.sendChat(decision.publicSpeech.trim().slice(0, 30)); }
        catch (e) { speechError = `公开发言未发送：${e instanceof Error ? e.message : String(e)}`; }
      }
      if (!session.isCurrent(observation)) {
        session.record({ decisionId: observation.decisionId, seq: observation.seq, at, playerId: player.id,
          seat: observation.state.viewer, decision, action: resolveDecision(observation, decision),
          source, elapsedMs: Date.now() - at, result: 'stale', error, usage });
        continue;
      }
      const submitted = resolveDecision(observation, decision);
      const response = await runPlay(session.hgc, { action: { message: submitted }, waitTimeoutMs: 500 });
      session.noteEvents(response.newLog);
      session.record({ decisionId: observation.decisionId, seq: observation.seq, at, playerId: player.id,
        seat: observation.state.viewer, decision, action: submitted, source, elapsedMs: Date.now() - at,
        result: response.lastActionResult, error: [error, speechError].filter(Boolean).join('; ') || undefined, usage });
      decisions++;
    }
  };

  try {
    const tokens: string[] = [];
    const sessions: ArenaPlayerSession[] = [];
    const roomConfig = { ...DEFAULT_ROOM_CONFIG, managedByArena: true, name: config.name, timeoutSec: config.timeoutSec ?? 45, charPool: config.charPool ?? 'standard' };
    for (const [index, player] of config.players.entries()) {
      const token = await account(player.name, index);
      tokens.push(token);
      const hgc = new HeadlessGameClient(server, {
        onChat: (messages, source) => session?.addChat(messages, source),
        onError: (e) => archive.append(`players/${player.id}/errors.jsonl`, { at: Date.now(), error: e.message }),
      }, { token });
      clients.push(hgc);
      const session = new ArenaPlayerSession(hgc, player.id, archive, player.persona);
      sessions.push(session);
      if (index === 0) {
        await hgc.createRoom(config.name, config.players.length, roomConfig, undefined, 'quick');
        manifest.roomId = hgc.roomId;
        archive.write('manifest.json', manifest);
      } else await hgc.joinRoom(manifest.roomId!);
      if (player.mode === 'mcp') {
        archive.write(`mcp/${player.id}/mcp.json`, {
          mcpServers: { sanguosha: { command: process.execPath,
            args: [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/ai-mcp/server.ts')],
            env: { SGS_SERVER_URL: server, SGS_MCP_TOKEN: token, SGS_ARENA_ID: id,
              SGS_ARENA_PLAYER_ID: player.id, SGS_ARENA_DIR: resolve(archive.dir, '..'), SGS_ARENA_PERSONA: player.persona ?? '' } } },
        });
        archive.write(`mcp/${player.id}/join.json`, {
          tool: 'joinRoom', arguments: { roomId: manifest.roomId },
          instructions: '先用上述参数调用 joinRoom，再持续调用 play；从 observation.actions 自主选择，优先用 actionId 提交。每次附 memory、strategySummary，可选 publicSpeech。不要读取本机其他玩家日志或观众端点。',
        });
        log(`${player.name}: MCP 配置 ${archive.dir}/mcp/${player.id}/mcp.json，等待外部 agent 加入`);
      } else await hgc.sendReady();
    }
    const observerToken = await account('观众记录员', config.players.length);
    observer = new HeadlessGameClient(server, {
      onView: (view, events) => {
        archive.append('public.jsonl', { at: Date.now(), seq: observer?.lastSeq ?? 0, state: publicSnapshot(view), events });
      },
      onChat: (messages, source) => {
        publicChat = (source === 'history' ? messages : [...publicChat, ...messages]).slice(-200);
        archive.write('chat.json', publicChat);
        if (source === 'chat') messages.forEach((message) => archive.append('chat.jsonl', message));
      },
      onGameOver: (winner) => { manifest.winner = winner; finished = true; },
    }, { token: observerToken });
    await observer.joinAsSpectator(manifest.roomId!);
    log(`对局 ${id}，房间 ${manifest.roomId}，观众页 ${server}/arena/${id}`);
    // External MCP players ready themselves. API/heuristic seats are already ready.
    while (!stopped()) {
      const state = observer.roomState;
      if (state?.readyPlayers.length === config.players.length && state.playerIds.length === config.players.length) break;
      await pause(200);
    }
    if (stopped()) throw new Error('等待玩家加入时终止或超时');
    await clients[0].sendStartGame();
    manifest.status = 'playing';
    archive.write('manifest.json', manifest);
    const loops = config.players.flatMap((p, i) => p.mode === 'mcp' ? [] : [playPlayer(p, sessions[i])]);
    let loopError: unknown;
    const playersDone = Promise.all(loops).catch((error: unknown) => { loopError = error; finished = true; });
    while (!stopped()) {
      externalDecisions = config.players.filter((p) => p.mode === 'mcp').reduce((sum, p) => {
        const path = resolve(archive.dir, `players/${p.id}/decisions.jsonl`);
        return sum + (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).length : 0);
      }, 0);
      await captureAudience(observerToken);
      await pause(250);
    }
    if (loopError) throw loopError;
    finished = true;
    modelAbort.abort();
    await playersDone;
    await captureAudience(observerToken);
    manifest.status = manifest.winner ? 'completed' : 'interrupted';
    if (!manifest.winner) manifest.error = options.signal?.aborted ? '用户取消对局'
      : decisions + externalDecisions >= (config.maxDecisions ?? 4000) ? '达到决策数量上限' : '达到对局时长上限';
    const replay = await request(`/api/rooms/${manifest.roomId}/arena-replay`, observerToken);
    if (replay) archive.write('replay.json', replay);
    // History persistence is asynchronous; allow its final write to finish before exporting.
    for (let attempt = 0; attempt < 20; attempt++) {
      const history = await request(`/api/rooms/${manifest.roomId}/history`, observerToken) as { entries: Array<{ id: string; hasReplay: boolean; winnerLabel?: string }> };
      const entry = history.entries.find((e) => e.hasReplay);
      if (entry) {
        archive.write('replay.json', await request(`/api/rooms/${manifest.roomId}/history/${entry.id}?download=1`, observerToken));
        archive.write('result.json', history.entries[0]);
        if (manifest.winner && entry.winnerLabel) manifest.winner = entry.winnerLabel;
        break;
      }
      if (!manifest.winner) break;
      await pause(150);
    }
  } catch (e) {
    finished = true;
    manifest.status = 'interrupted';
    manifest.error = e instanceof Error ? e.message : String(e);
    log(`对局中止：${manifest.error}`);
  } finally {
    finished = true;
    modelAbort.abort();
    clients.forEach((hgc) => hgc.disconnect());
    observer?.disconnect();
    manifest.endedAt = Date.now();
    archive.write('manifest.json', manifest);
    log(`${manifest.status}: ${archive.dir}`);
  }
  return manifest;
}
