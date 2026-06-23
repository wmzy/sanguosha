// 展示型 ViewEvent 测试:验证未 dispatch 但用于 othersView 的事件类型
// 已注册为 atom(空 applyView),前端 viewReducer 不会因 getAtomDef 抛错。
import { describe, it, expect } from 'vitest';
import { viewReducer } from '../../src/client/view/reducer';
import { getAtomDef } from '../../src/engine/atom';
import type { GameView, ViewEvent } from '../../src/engine/types';
import '../../src/client/engine-imports';

function makeView(): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '准备',
    turn: { round: 1, phase: '准备', vars: {} },
    players: [
      { index: 0, name: 'P1', character: '', faction: '群', health: 4, maxHealth: 4, alive: true, handCount: 0, equipment: {}, skills: [], marks: [], identity: '主公' },
    ],
    zones: { deckCount: 0, discardCount: 0, processingCount: 0 },
    log: [],
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
  } as unknown as GameView;
}

describe('展示型 ViewEvent 注册', () => {
  it('等待选将 已注册,viewReducer 不抛错', () => {
    expect(() => getAtomDef('等待选将')).not.toThrow();
    const view = makeView();
    const event = { type: '等待选将', waitingFor: 0, effect: { duration: 200 } } as unknown as ViewEvent;
    expect(() => viewReducer(view, event)).not.toThrow();
    // view 不应被改变
    expect(view.phase).toBe('准备');
  });

  it('打出 已注册,viewReducer 不抛错', () => {
    expect(() => getAtomDef('打出')).not.toThrow();
    const view = makeView();
    const event = { type: '打出', player: 0, effect: { duration: 800 } } as unknown as ViewEvent;
    expect(() => viewReducer(view, event)).not.toThrow();
  });

  it('注册的实体 atom(分配武将) 正常 applyView', () => {
    const view = makeView();
    const event = { type: '分配武将', target: 0, character: '刘备', skills: ['仁德'], effect: { duration: 200 } } as unknown as ViewEvent;
    viewReducer(view, event);
    expect(view.players[0].character).toBe('刘备');
  });
});
