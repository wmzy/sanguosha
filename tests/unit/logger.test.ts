// tests/unit/logger.test.ts — engine/logger.ts 单元测试
//
// 覆盖 eventToServerOp / eventToPlayerOp / actionToOp / GameLogger.recordBatch

import { describe, it, expect, beforeEach } from 'vitest';
import {
  eventToServerOp,
  eventToPlayerOp,
  actionToOp,
  GameLogger,
} from '@engine/logger';
import type { GameState, ServerEvent } from '@engine/types';
import { createTestGame } from '../engine-helpers';

const P1 = 'P1';
const P2 = 'P2';

function fakeState(): GameState {
  const s = createTestGame({ characters: ['曹操', '刘备'] });
  s.cardMap = {
    ...s.cardMap,
    c1: { id: 'c1', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' },
    c2: { id: 'c2', name: '闪', type: '基本牌', subtype: '闪', suit: '♥', rank: 'K', description: '' },
  };
  return s;
}

const ev = (type: string, payload: Record<string, unknown>, id = `e-${type}`, ts = 1000): ServerEvent =>
  ({ id, type, timestamp: ts, payload }) as ServerEvent;

describe('eventToServerOp', () => {
  let state: GameState;
  beforeEach(() => {
    state = fakeState();
  });

  it('damage event 描述含伤害来源、目标、数值', () => {
    const op = eventToServerOp(ev('造成伤害', { target: P2, amount: 1, source: P1, cardId: 'c1' }), state);
    expect(op).not.toBeNull();
    expect(op!.type).toBe('造成伤害');
    expect(op!.description).toContain('P1对P2');
    expect(op!.description).toContain('1点伤害');
    expect(op!.description).toContain('杀');
  });

  it('damage event 无 source 时描述以目标开头', () => {
    const op = eventToServerOp(ev('造成伤害', { target: P2, amount: 2 }), state);
    expect(op!.description).toMatch(/^P2/);
  });

  it('heal event 描述含目标、回复量、当前体力', () => {
    state.players[P2].health = 2;
    const op = eventToServerOp(ev('回复体力', { target: P2, amount: 1 }), state);
    expect(op!.type).toBe('回复体力');
    expect(op!.description).toContain('P2');
    expect(op!.description).toContain('1点体力');
    expect(op!.description).toContain('当前2');
  });

  it('cardsDiscarded event 描述含卡名列表', () => {
    const op = eventToServerOp(ev('弃置', { player: P1, cardIds: ['c1', 'c2'] }), state);
    expect(op!.type).toBe('弃置');
    expect(op!.description).toContain('P1');
    expect(op!.description).toContain('杀、闪');
  });

  it('cardsDiscarded 空牌列表描述仅含数量', () => {
    const op = eventToServerOp(ev('弃置', { player: P1, cardIds: [] }), state);
    expect(op!.description).toBe('P1弃了0张牌');
  });

  it('equip event 描述含卡名 + 槽位中文', () => {
    const op = eventToServerOp(ev('装备', { player: P1, cardId: 'c1', slot: '武器' }), state);
    expect(op!.type).toBe('装备');
    expect(op!.description).toContain('武器');
    expect(op!.description).toContain('杀');
  });

  it('unequip event 描述含槽位中文', () => {
    const op = eventToServerOp(ev('卸下', { player: P1, slot: '防具' }), state);
    expect(op!.description).toBe('P1卸下了防具');
  });

  it('setPhase event 描述含阶段与玩家', () => {
    const op = eventToServerOp(ev('设阶段', { phase: '出牌', player: P1 }), state);
    expect(op!.type).toBe('阶段变更');
    expect(op!.description).toContain('出牌');
    expect(op!.description).toContain('P1');
  });

  it('nextPlayer event 描述含目标、轮次、回合数', () => {
    const op = eventToServerOp(ev('下一玩家', { from: P1, to: P2, turnNumber: 2, round: 1 }), state);
    expect(op!.type).toBe('回合变更');
    expect(op!.description).toContain('P2');
    expect(op!.description).toContain('第1轮');
    expect(op!.description).toContain('第2回合');
  });

  it('turnStart event 返回 null（与 nextPlayer 重复）', () => {
    const op = eventToServerOp(ev('回合开始', { player: P1 }), state);
    expect(op).toBeNull();
  });

  it('kill event 描述含玩家 + 来源', () => {
    const op = eventToServerOp(ev('击杀', { player: P2, source: P1 }), state);
    expect(op!.description).toContain('P2阵亡');
    expect(op!.description).toContain('P1');
  });

  it('dying event 描述含濒死玩家', () => {
    const op = eventToServerOp(ev('濒死', { player: P2 }), state);
    expect(op!.description).toBe('P2濒死');
  });

  it('addSkill event 描述含技能名', () => {
    const op = eventToServerOp(ev('加技能', { player: P1, skillId: '奸雄' }), state);
    expect(op!.type).toBe('技能发动');
    expect(op!.description).toContain('奸雄');
  });

  it('未知事件类型返回 null', () => {
    const op = eventToServerOp(ev('移动牌', { cardId: 'c1' }), state);
    expect(op).toBeNull();
  });
});

describe('eventToPlayerOp — 视角裁剪', () => {
  let state: GameState;
  beforeEach(() => {
    state = fakeState();
  });

  it('draw event：drawer 看到具体卡名', () => {
    const op = eventToPlayerOp(
      ev('摸牌', { player: P1, count: 2, cards: ['c1', 'c2'] }),
      state,
      P1,
    );
    expect(op).not.toBeNull();
    expect(op!.data).toMatchObject({ player: P1, count: 2, cards: ['c1', 'c2'] });
    expect(op!.description).toContain('杀、闪');
  });

  it('draw event：他人只看到数量', () => {
    const op = eventToPlayerOp(
      ev('摸牌', { player: P1, count: 2, cards: ['c1', 'c2'] }),
      state,
      P2,
    );
    expect(op).not.toBeNull();
    expect(op!.data).toMatchObject({ player: P1, count: 2 });
    expect((op!.data as { cards?: unknown }).cards).toBeUndefined();
    expect(op!.description).toBe('P1摸了2张牌');
  });

  it('damage event 对所有人一致', () => {
    const e = ev('造成伤害', { target: P2, amount: 1, source: P1 });
    const op1 = eventToPlayerOp(e, state, P1);
    const op2 = eventToPlayerOp(e, state, P2);
    expect(op1!.description).toBe(op2!.description);
  });
});

describe('actionToOp', () => {
  let state: GameState;
  beforeEach(() => {
    state = fakeState();
  });

  it('startGame → gameStart', () => {
    const op = actionToOp({ type: '开始' }, state);
    expect(op!.type).toBe('游戏开始');
    expect(op!.description).toBe('游戏开始');
  });

  it('playCard 描述含卡名与目标', () => {
    const op = actionToOp({ type: '打出一张牌', player: P1, cardId: 'c1', target: P2 }, state);
    expect(op!.type).toBe('出牌');
    expect(op!.description).toContain('P1');
    expect(op!.description).toContain('杀');
    expect(op!.description).toContain('P2');
  });

  it('playCard 无 target 时描述不含目标', () => {
    const op = actionToOp({ type: '打出一张牌', player: P1, cardId: 'c1' }, state);
    expect(op!.description).not.toContain('目标');
  });

  it('respond 描述含打出卡名', () => {
    const op = actionToOp({ type: '打出', player: P1, cardId: 'c2' }, state);
    expect(op!.type).toBe('出牌');
    expect(op!.description).toContain('闪');
  });

  it('useSkill 描述含技能名', () => {
    const op = actionToOp({ type: '使用技能', player: P1, skillId: '奸雄' }, state);
    expect(op!.description).toContain('奸雄');
  });

  it('endTurn / discard / toggleAutoSkipWuxie 返回 null（被 server events 覆盖）', () => {
    expect(actionToOp({ type: '结束回合', player: P1 }, state)).toBeNull();
    expect(actionToOp({ type: '弃置', player: P1, cardIds: [] }, state)).toBeNull();
    expect(actionToOp({ type: '切换自动跳过无懈可击' }, state)).toBeNull();
  });
});

describe('GameLogger', () => {
  let state: GameState;
  beforeEach(() => {
    state = fakeState();
  });

  it('初始化时 serverOps / playerOps 为空', () => {
    const logger = new GameLogger(
      { version: '1.0', createdAt: 0, playerCount: 2, characters: ['曹操', '刘备'], seed: 0 },
      [P1, P2],
    );
    expect(logger.getServerOps()).toHaveLength(0);
    expect(logger.getPlayerOps(P1)).toHaveLength(0);
  });

  it('recordBatch 单条 event → serverOps / 每个 playerOps 各加 1 条，seq 递增', () => {
    const logger = new GameLogger(
      { version: '1.0', createdAt: 0, playerCount: 2, characters: [], seed: 0 },
      [P1, P2],
    );
    const result = logger.recordBatch(
      null,
      [ev('造成伤害', { target: P2, amount: 1, source: P1 }, 'e1')],
      state,
    );
    expect(result.serverOps).toHaveLength(1);
    expect(result.serverOps[0].seq).toBe(0);
    expect(result.playerOps[P1]).toHaveLength(1);
    expect(result.playerOps[P2]).toHaveLength(1);
    expect(result.playerOps[P1][0].seq).toBe(0);
    expect(result.playerOps[P2][0].seq).toBe(0);
  });

  it('多次 recordBatch 之间 seq 连续递增', () => {
    const logger = new GameLogger(
      { version: '1.0', createdAt: 0, playerCount: 2, characters: [], seed: 0 },
      [P1, P2],
    );
    logger.recordBatch(null, [ev('造成伤害', { target: P2, amount: 1, source: P1 }, 'e1')], state);
    logger.recordBatch(null, [ev('回复体力', { target: P2, amount: 1 }, 'e2')], state);
    logger.recordBatch(null, [ev('设阶段', { phase: '出牌', player: P1 }, 'e3')], state);

    const seqs = logger.getServerOps().map((o) => o.seq);
    expect(seqs).toEqual([0, 1, 2]);

    const p1Seqs = logger.getPlayerOps(P1).map((o) => o.seq);
    expect(p1Seqs).toEqual([0, 1, 2]);
  });

  it('draw 事件按 player 拆分：drawer 看 cards，他人只看 count', () => {
    const logger = new GameLogger(
      { version: '1.0', createdAt: 0, playerCount: 2, characters: [], seed: 0 },
      [P1, P2],
    );
    logger.recordBatch(null, [ev('摸牌', { player: P1, count: 2, cards: ['c1', 'c2'] }, 'e1')], state);

    const p1Ops = logger.getPlayerOps(P1);
    const p2Ops = logger.getPlayerOps(P2);
    expect(p1Ops[0].description).toContain('杀');
    expect(p2Ops[0].description).toBe('P1摸了2张牌');
  });

  it('action 触发：startGame 走 serverOps 与所有 playerOps', () => {
    const logger = new GameLogger(
      { version: '1.0', createdAt: 0, playerCount: 2, characters: [], seed: 0 },
      [P1, P2],
    );
    logger.recordBatch({ type: '开始' }, [], state);
    expect(logger.getServerOps()).toHaveLength(1);
    expect(logger.getServerOps()[0].type).toBe('游戏开始');
    expect(logger.getPlayerOps(P1)[0].type).toBe('游戏开始');
    expect(logger.getPlayerOps(P2)[0].type).toBe('游戏开始');
  });

  it('export 返回完整 GameLog 含 meta + serverOps + playerOps', () => {
    const meta = { version: '1.0', createdAt: 100, playerCount: 2, characters: ['曹操', '刘备'], seed: 42 };
    const logger = new GameLogger(meta, [P1, P2]);
    logger.recordBatch({ type: '开始' }, [], state);
    logger.recordBatch(null, [ev('造成伤害', { target: P2, amount: 1, source: P1 }, 'e1')], state);

    const log = logger.export();
    expect(log.meta).toEqual(meta);
    expect(log.serverOps).toHaveLength(2);
    expect(log.playerOps[P1]).toHaveLength(2);
    expect(log.playerOps[P2]).toHaveLength(2);
  });

  it('rebuildFromLog 从 serverLog 重建（断线重连）', () => {
    const logger = new GameLogger(
      { version: '1.0', createdAt: 0, playerCount: 2, characters: [], seed: 0 },
      state.playerOrder,
    );
    const serverLog = [
      ev('造成伤害', { target: P2, amount: 1, source: P1 }, 'e1', 100),
      ev('回复体力', { target: P2, amount: 1 }, 'e2', 200),
    ];
    logger.rebuildFromLog(state, serverLog);
    expect(logger.getServerOps()).toHaveLength(2);
    expect(logger.getServerOps()[0].timestamp).toBe(100);
  });
});
