import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObservation, playerView, publicSnapshot } from '../../src/arena/observation';
import { completeAction, resolveDecision } from '../../src/arena/decision';
import { ArenaArchive } from '../../src/arena/archive';
import type { ArenaMenuAction, ArenaObservation } from '../../src/arena/types';
import type { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import type { Card, GameView, PendingView } from '../../src/engine/types';
import { ArenaPlayerSession } from '../../src/arena/player';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempArchive(id = 'match'): ArenaArchive {
  const dir = mkdtempSync(join(tmpdir(), 'arena-context-'));
  tempDirs.push(dir);
  return new ArenaArchive(id, dir);
}

function makeCard(id: string, name: string): Card {
  return { id, name, suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
}

function makeView(viewer = 0): GameView {
  const cards = {
    own: makeCard('own', '杀'),
    other: makeCard('other', '桃'),
    dead: makeCard('dead', '闪'),
    peek: makeCard('peek', '无中生有'),
    processing: makeCard('processing', '决斗'),
    judge: makeCard('judge', '乐不思蜀'),
  };
  return {
    viewer,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 3, phase: '出牌', vars: {} },
    players: [
      {
        index: 0, name: '甲', character: '武将甲', faction: '蜀', identity: '忠臣',
        health: 3, maxHealth: 4, alive: true, equipment: { 武器: 'own' }, skills: ['观星'],
        handCount: 1, hand: [cards.own], marks: [], pendingTricks: ['judge'],
        distanceVars: { attackMod: 1, defenseMod: 2, attackRange: 3 },
      },
      {
        index: 1, name: '乙', character: '武将乙', faction: '魏', identity: '反贼',
        health: 4, maxHealth: 4, alive: true, equipment: { 防具: 'other' }, skills: [],
        handCount: 1, hand: [cards.other], marks: [], pendingTricks: [],
        distanceVars: { attackMod: 0, defenseMod: 0, attackRange: 1 },
      },
      {
        index: 2, name: '丙', character: '武将丙', faction: '吴', identity: '内奸',
        health: 0, maxHealth: 4, alive: false, equipment: {}, skills: [],
        handCount: 1, hand: [cards.dead], marks: [], pendingTricks: [],
        distanceVars: { attackMod: 0, defenseMod: 0, attackRange: 1 },
      },
      {
        index: 3, name: '丁', character: '武将丁', faction: '群', identity: '主公',
        health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [],
        handCount: 0, marks: [], pendingTricks: [],
      },
    ],
    cardMap: cards,
    pending: {
      type: 'awaits',
      atom: {
        type: '请求回应', target: 0, requestType: '观星/arrange',
        prompt: { type: 'distribute', title: '观星排列', cardIds: ['peek'], mode: 'select' },
      } as PendingView['atom'],
      prompt: { type: 'distribute', title: '观星排列', cardIds: ['peek'], mode: 'select' },
      target: 0,
      isBlocking: true,
    },
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    zones: { deckCount: 20, discardPileCount: 1, processing: ['processing'] },
    settlementStack: [],
  };
}

function menuAction(overrides: Partial<ArenaMenuAction> = {}): ArenaMenuAction {
  return {
    actionId: 'a0',
    description: '选目标',
    message: { skillId: '测试', actionType: 'use', ownerId: 0, params: { cardId: 'own' }, baseSeq: 1 },
    validTargets: [1, 2, 3],
    minTarget: 2,
    maxTarget: 3,
    category: 'play',
    ...overrides,
  };
}

describe('arena observation privacy', () => {
  it('playerView keeps only own hand and own identity, plus public lord/death identities', () => {
    const view = playerView(makeView(0));
    expect(view.players.map((p) => p.hand?.map((c) => c.id))).toEqual([['own'], undefined, undefined, undefined]);
    expect(view.players[0].identity).toBe('忠臣');
    expect(view.players[1].identity).toBeUndefined();
    expect(view.players[1].identityHidden).toBe(true);
    expect(view.players[2].identity).toBe('内奸');
    expect(view.players[2].identityHidden).toBe(false);
    expect(view.players[3].identity).toBe('主公');
    expect(view.players[3].identityHidden).toBe(false);
  });

  it('publicSnapshot removes every hand and living non-lord identity while retaining public board data', () => {
    const snapshot = publicSnapshot(makeView(0));
    expect(snapshot.players.map((p) => p.hand)).toEqual([undefined, undefined, undefined, undefined]);
    expect(snapshot.players[0].identity).toBeUndefined();
    expect(snapshot.players[1].identity).toBeUndefined();
    expect(snapshot.players[2].identity).toBe('内奸');
    expect(snapshot.players[3].identity).toBe('主公');
    expect(snapshot.players[0]).toMatchObject({
      faction: '蜀',
      equipment: { 武器: 'own' },
      pendingTricks: [makeCard('judge', '乐不思蜀')],
      distanceVars: { attackMod: 1, defenseMod: 2, attackRange: 3 },
    });
    expect(snapshot.processing).toEqual([makeCard('processing', '决斗')]);
  });

  it('adds referenced deck cards privately for the addressed AI and processing cards publicly', () => {
    const ownObservation = createObservation(makeView(0), 12, []);
    expect(ownObservation.privatePrompt?.prompt.type).toBe('distribute');
    expect(ownObservation.visibleCards).toEqual([
      { visibility: 'private', source: '观星排列', cards: [makeCard('peek', '无中生有')] },
      { visibility: 'public', source: '公开处理区', cards: [makeCard('processing', '决斗')] },
    ]);

    const otherObservation = createObservation(makeView(1), 12, []);
    expect(otherObservation.privatePrompt).toBeNull();
    expect(otherObservation.visibleCards).toEqual([
      { visibility: 'public', source: '公开处理区', cards: [makeCard('processing', '决斗')] },
    ]);
    expect(JSON.stringify(otherObservation)).not.toContain('无中生有');
  });

  it('keeps a public reveal distinct from the privately watched deck cards', () => {
    const observation = createObservation(makeView(0), 13, [], [], [{ type: '展示', cardId: 'other', player: 1 }]);
    expect(observation.visibleCards.find((v) => v.source === '公开展示或判定')?.cards[0].id).toBe('other');
    expect(observation.visibleCards.find((v) => v.visibility === 'private')?.cards[0].id).toBe('peek');
  });
});

describe('arena decision contract', () => {
  it('normalizes singular/plural target overrides and rejects conflicting choices', () => {
    const action = menuAction({ minTarget: 1, maxTarget: 1, message: {
      skillId: '杀', actionType: 'use', ownerId: 0, params: { targets: [1], target: 1 }, baseSeq: 1,
    } });
    const observation = { decisionId: '0:8', actions: [action] } as ArenaObservation;
    expect(resolveDecision(observation, { actionId: 'a0', params: { target: 2 } }).params).toMatchObject({ target: 2, targets: [2] });
    expect(resolveDecision(observation, { actionId: 'a0', params: { targets: [3] } }).params).toMatchObject({ target: 3, targets: [3] });
    expect(() => resolveDecision(observation, { actionId: 'a0', params: { target: 1, targets: [2] } })).toThrow('不一致');
  });
  it('completes a multi-target action within its declared target range', () => {
    const action = menuAction();
    expect(completeAction(action).params.targets).toEqual([1, 2]);
    const observation = {
      decisionId: '0:7',
      actions: [action],
    } as ArenaObservation;
    const message = resolveDecision(observation, {
      decisionId: '0:7', actionId: 'a0', params: { targets: [3, 2] },
    });
    expect(message.params.targets).toEqual([3, 2]);
  });

  it('rejects stale decision windows, unknown action ids, and out-of-range targets', () => {
    const observation = { decisionId: '0:8', actions: [menuAction()] } as ArenaObservation;
    expect(() => resolveDecision(observation, { decisionId: '0:7', actionId: 'a0' })).toThrow('决策窗口已变化');
    expect(() => resolveDecision(observation, { actionId: 'missing' })).toThrow('不存在的 actionId');
    expect(() => resolveDecision(observation, { actionId: 'a0', params: { targets: [1, 4] } })).toThrow('目标不在候选范围');
    expect(() => resolveDecision(observation, { actionId: 'a0', params: { targets: [1] } })).toThrow('目标数量不合法');
  });
});

describe('arena player context isolation', () => {
  it('rejects both directed and broadcast windows that change while a model is thinking', async () => {
    const raw = makeView(0);
    raw.pending!.deadline = 100;
    const client = { view: raw, lastSeq: 5, needsAction: () => true, getAvailableActions: () => [], loadSkillActions: async () => {} } as unknown as HeadlessGameClient;
    const session = new ArenaPlayerSession(client, 'window', tempArchive());
    const own = await session.observe();
    expect(session.isCurrent(own!)).toBe(true);
    raw.pending!.deadline = 200;
    expect(session.isCurrent(own!)).toBe(false);
    raw.pending!.target = -2;
    const broadcast = await session.observe();
    expect(session.isCurrent(broadcast!)).toBe(true);
    raw.pending!.deadline = 300;
    expect(session.isCurrent(broadcast!)).toBe(false);
  });
  it('isolates memory/messages by player and reloads each player log from the archive', async () => {
    const archive = tempArchive();
    const rawA = makeView(0);
    const rawB = makeView(1);
    const makeClient = (view: GameView) => ({
      view,
      lastSeq: 5,
      getAvailableActions: () => [],
      loadSkillActions: vi.fn(async () => {}),
    }) as unknown as HeadlessGameClient;
    const a = new ArenaPlayerSession(makeClient(rawA), 'player_a', archive, '甲的风格');
    const b = new ArenaPlayerSession(makeClient(rawB), 'player_b', archive, '乙的风格');

    const obsA = await a.observe();
    const obsB = await b.observe();
    expect(obsA).not.toBeNull();
    expect(obsB).not.toBeNull();
    a.record({
      decisionId: obsA!.decisionId, seq: obsA!.seq, at: 1, playerId: 'player_a', seat: 0,
      decision: { actionId: 'a0', memory: '甲的阵营推测' },
      action: { skillId: '测试', actionType: 'skip', ownerId: 0, params: {}, baseSeq: 5 },
      source: 'model', elapsedMs: 10,
    });
    b.record({
      decisionId: obsB!.decisionId, seq: obsB!.seq, at: 2, playerId: 'player_b', seat: 1,
      decision: { actionId: 'a0', memory: '乙的行动计划' },
      action: { skillId: '测试', actionType: 'skip', ownerId: 1, params: {}, baseSeq: 5 },
      source: 'model', elapsedMs: 11,
    });

    expect(a.memory).toBe('甲的阵营推测');
    expect(b.memory).toBe('乙的行动计划');
    const messagesA = await a.messages(obsA!);
    const messagesB = await b.messages(obsB!);
    expect(JSON.stringify(messagesA)).toContain('甲的阵营推测');
    expect(JSON.stringify(messagesA)).not.toContain('乙的行动计划');
    expect(JSON.stringify(messagesB)).toContain('乙的行动计划');
    expect(JSON.stringify(messagesB)).not.toContain('甲的阵营推测');
    expect(messagesA[0].content).toContain('甲的风格');
    expect(messagesB[0].content).toContain('乙的风格');

    const reloadedA = new ArenaPlayerSession(makeClient(rawA), 'player_a', archive);
    const reloadedB = new ArenaPlayerSession(makeClient(rawB), 'player_b', archive);
    expect(reloadedA.memory).toBe('甲的阵营推测');
    expect(reloadedB.memory).toBe('乙的行动计划');
    const logA = archive.context('player_a').messages;
    const logB = archive.context('player_b').messages;
    expect(JSON.stringify(logA)).toContain('甲的阵营推测');
    expect(JSON.stringify(logA)).not.toContain('乙的行动计划');
    expect(JSON.stringify(logB)).toContain('乙的行动计划');
    expect(JSON.stringify(logB)).not.toContain('甲的阵营推测');
    expect(logA).toHaveLength(2);
    expect(logB).toHaveLength(2);
  });
});
