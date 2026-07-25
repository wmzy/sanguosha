// tests/ai-mcp/viewProjector.test.ts
import { describe, it, expect } from 'vitest';
import { projectView } from '../../src/ai-mcp/viewProjector';
import type { GameView } from '../../src/engine/types';

function makeFullView(): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: { secret: 'x' } },
    players: [
      {
        index: 0,
        name: 'P0',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['仁德'],
        handCount: 1,
        hand: [{ id: 'c1', name: '杀', suit: '♠', color: '黑', rank: '5', type: '基本牌' }],
        marks: [],
        distanceVars: { attackMod: 0, defenseMod: 0, attackRange: 1 },
      },
    ],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: Array.from({ length: 30 }, (_, i) => ({ time: i, player: 0, text: `evt${i}` })),
    settlementStack: [],
    zones: { deckCount: 50, discardPileCount: 0, processing: [] },
  };
}

describe('projectView', () => {
  it('投影保留决策字段，丢弃引擎细节', () => {
    const snap = projectView(makeFullView());
    expect(snap.viewer).toBe(0);
    expect(snap.players[0].hand).toHaveLength(1);
    expect(snap.log.length).toBeLessThanOrEqual(20); // 截断
    expect((snap.players[0] as { distanceVars?: unknown }).distanceVars).toBeUndefined(); // 丢弃
    expect((snap as { settlementStack?: unknown }).settlementStack).toBeUndefined();
  });

  it('无 zones 时回退为 0', () => {
    const view = makeFullView();
    view.zones = undefined;
    const snap = projectView(view);
    expect(snap.zones).toEqual({ deckCount: 0, discardPileCount: 0 });
  });

  it('pending 投影出 target/isBlocking/requestType', () => {
    const view = makeFullView();
    view.pending = {
      type: 'awaits',
      atom: { type: '询问闪', player: 0 } as unknown as GameView['pending'] extends infer P
        ? P extends { atom: infer A }
          ? A
          : never
        : never,
      prompt: {
        type: 'useCard',
        title: '请出闪',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      } as unknown as GameView['pending'] extends infer P
        ? P extends { prompt: infer PR }
          ? PR
          : never
        : never,
      target: 0,
      isBlocking: true,
    } as unknown as GameView['pending'];
    const snap = projectView(view);
    expect(snap.pending).not.toBeNull();
    expect(snap.pending!.target).toBe(0);
    expect(snap.pending!.isBlocking).toBe(true);
    expect(snap.pending!.promptTitle).toBe('请出闪');
    expect(snap.pending!.requestType).toBe('');
  });

  // ─── Bug 回归:横置(铁索连环)标记必须投影到 AI 视图 ───
  // bug:viewProjector 此前丢弃 marks,AI(经 MCP play/getSnapshot)看不到任何玩家的横置状态,
  // 导致 AI 无法判断铁索连环该横置还是重置(toggle)——“重置不生效”。
  // 修复:projectView 投影 marks(仅 id+scope,丢弃 payload 降 token)。
  it('投影 marks:已横置角色的 chained 标记可见', () => {
    const view = makeFullView();
    // P0 横置(marks 含 chained)
    view.players[0].marks = [{ id: 'chained', scope: 0 }];
    const snap = projectView(view);
    expect(snap.players[0].marks).toEqual([{ id: 'chained', scope: 0 }]);
  });

  it('投影 marks:未横置角色 marks 为空数组', () => {
    const snap = projectView(makeFullView());
    expect(snap.players[0].marks).toEqual([]);
  });

  // ─── Bug 回归:choosePlayer 候选(含自己)必须投影到 AI 视图 ───
  // bug:viewProjector 此前只透传 选将询问 的 candidates,choosePlayer 类 pending
  // (界放权/突袭/激将/奋威 等)的合法目标列表丢失。引擎投影层已把 filter 结果注入
  // prompt.candidates(number[],含自己),但 MCP 视图未透传 → AI 看不到可选目标,
  // 界放权选额外回合目标时不能选自己。修复:projectView 把 prompt.candidates 映射成
  // playerCandidates(index+name)下发。
  it('投影 playerCandidates:choosePlayer 候选(含自己)可见', () => {
    const view = makeFullView();
    // 再加一个玩家,凑出「自己 + 其他」场景
    view.players.push({
      index: 1,
      name: 'P1',
      character: '张飞',
      health: 4,
      maxHealth: 4,
      alive: true,
      equipment: {},
      skills: ['咆哮'],
      handCount: 2,
      hand: [],
      marks: [],
      distanceVars: { attackMod: 0, defenseMod: 0, attackRange: 1 },
    });
    // 界放权 chooseTarget:filter=(view,t)=>alive → candidates 含自己(0)
    view.pending = {
      type: 'awaits',
      atom: {
        type: '请求回应',
        requestType: '界放权/chooseTarget',
        target: 0,
        prompt: { type: 'choosePlayer', title: '放权:选择一名角色进行一个额外回合', min: 1, max: 1, candidates: [0, 1] },
      } as unknown as GameView['pending'] extends infer P
        ? P extends { atom: infer A }
          ? A
          : never
        : never,
      prompt: {
        type: 'choosePlayer',
        title: '放权:选择一名角色进行一个额外回合',
        min: 1,
        max: 1,
        candidates: [0, 1],
      } as unknown as GameView['pending'] extends infer P
        ? P extends { prompt: infer PR }
          ? PR
          : never
        : never,
      target: 0,
      isBlocking: true,
    } as unknown as GameView['pending'];
    const snap = projectView(view);
    expect(snap.pending).not.toBeNull();
    // 关键断言:候选含自己(index=0)且映射成 index+name
    expect(snap.pending!.playerCandidates).toEqual([
      { index: 0, name: 'P0' },
      { index: 1, name: 'P1' },
    ]);
    // 选将 candidates 仍为 undefined(非选将询问,不受影响)
    expect(snap.pending!.candidates).toBeUndefined();
  });

  it('投影 playerCandidates:非 choosePlayer pending 为 undefined', () => {
    const view = makeFullView();
    view.pending = {
      type: 'awaits',
      atom: { type: '询问闪', player: 0 } as unknown as GameView['pending'] extends infer P
        ? P extends { atom: infer A }
          ? A
          : never
        : never,
      prompt: {
        type: 'useCard',
        title: '请出闪',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      } as unknown as GameView['pending'] extends infer P
        ? P extends { prompt: infer PR }
          ? PR
          : never
        : never,
      target: 0,
      isBlocking: true,
    } as unknown as GameView['pending'];
    const snap = projectView(view);
    expect(snap.pending!.playerCandidates).toBeUndefined();
  });
});
