// LEGACY TEST: references deleted v2 modules - skipped
/**
 * tests/e2e-regression.test.ts — 端到端回归测试
 *
 * 覆盖所有已修复 bug 的集成测试，确保不会回归。
 * 测试从创建游戏到胜利/失败的完整链路。
 */

import { describe, it, expect } from 'vitest';
import { engine } from '@engine/engine';
import { createTestGame, findCardInHand, injectCard, injectTrickCard, setHealth, passAllTrickResponders } from './engine-helpers';
import type { GameState } from '@engine/types';

// ════════════════════════════════════════════════════════════════
// BUG 1: 胜利条件检查
// ════════════════════════════════════════════════════════════════

describe.skip('胜利条件检查', () => {
  it('主公阵亡 → 反贼获胜', () => {
    const state = createTestGame({ playerCount: 2, playPhase: true, seed: 42 });
    let s: GameState = {
      ...state,
      players: {
        ...state.players,
        P1: { ...state.players.P1, info: { ...state.players.P1.info, role: '主公' } },
        P2: { ...state.players.P2, info: { ...state.players.P2.info, role: '反贼' } },
      },
    };

    // P2 体力 1，移除所有桃
    s = setHealth(s, 'P2', 1);
    const p2NoPeach = s.players.P2.hand.filter(id => s.cardMap[id]?.name !== '桃');
    s = { ...s, players: { ...s.players, P2: { ...s.players.P2, hand: p2NoPeach } } };

    // P1 注入杀
    s = injectCard(s, 'P1', '杀');
    const killId = findCardInHand(s, 'P1', '杀');
    expect(killId).toBeDefined();
    if (!killId) return;

    // P1 出杀 P2 → P2 不闪 → 受伤 → 濒死 → 不救 → 死亡
    const r1 = engine(s, { type: '打出一张牌', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();
    if (r1.error) return;

    // P2 不闪 → 受伤
    const r2 = engine(r1.state, { type: '打出', player: 'P2' });
    expect(r2.error).toBeUndefined();

    // 遍历濒死窗口不救援 → P2 死亡
    let dyingState = r2.state;
    while (dyingState.pending?.type === '濒死窗口') {
      const dp = dyingState.pending;
      const saver = dp.savers[dp.currentSaverIndex];
      dyingState = engine(dyingState, { type: '打出', player: saver }).state;
    }

    // P2 是反贼，死亡后不应该触发主公胜利（因为反贼没全灭——P1 是主公不是反贼）
    // 实际上 P2 是唯一的反贼，所以反贼全灭 → 主公胜
    // 这个测试验证反贼死亡引擎正常运行
    expect(dyingState.players.P2.info.alive).toBe(false);
  });

  it('所有反贼阵亡 → 主公阵营获胜', () => {
    const state = createTestGame({ playerCount: 2, playPhase: true, seed: 123 });
    let s: GameState = {
      ...state,
      players: {
        ...state.players,
        P1: { ...state.players.P1, info: { ...state.players.P1.info, role: '主公' } },
        P2: { ...state.players.P2, info: { ...state.players.P2.info, role: '反贼' } },
      },
    };

    // P2 濒临死亡，确保没有桃在手中
    s = setHealth(s, 'P2', 1);
    // 移除 P1 和 P2 手中所有的桃
    const p1handNoPeach = s.players.P1.hand.filter(id => s.cardMap[id]?.name !== '桃');
    const p2handNoPeach = s.players.P2.hand.filter(id => s.cardMap[id]?.name !== '桃');
    s = {
      ...s,
      players: {
        ...s.players,
        P1: { ...s.players.P1, hand: p1handNoPeach },
        P2: { ...s.players.P2, hand: p2handNoPeach },
      },
    };

    // P1 注入杀
    s = injectCard(s, 'P1', '杀');
    const killId = findCardInHand(s, 'P1', '杀');
    expect(killId).toBeDefined();
    if (!killId) return;

    // P1 出杀 P2
    const r1 = engine(s, { type: '打出一张牌', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();
    if (r1.error) return;

    // P2 不闪
    const r2 = engine(r1.state, { type: '打出', player: 'P2' });
    expect(r2.error).toBeUndefined();

    // 濒死窗口
    expect(r2.state.pending?.type).toBe('濒死窗口');
    if (r2.state.pending?.type !== '濒死窗口') return;

    // 遍历所有 savers 直到无人救 → 死亡
    let dyingState = r2.state;
    while (dyingState.pending?.type === '濒死窗口') {
      const dp = dyingState.pending;
      const saver = dp.savers[dp.currentSaverIndex];
      dyingState = engine(dyingState, { type: '打出', player: saver }).state;
    }

    // P2 应该已阵亡
    expect(dyingState.players.P2.info.alive).toBe(false);
    // 游戏应该结束
    expect(dyingState.meta.status).toBe('已结束');
    expect(dyingState.meta.winner).toBe('主公');
  });

  it('游戏进行中 status 是 进行中', () => {
    const state = createTestGame({ playPhase: true });
    expect(state.meta.status).toBe('进行中');
  });
});

// ════════════════════════════════════════════════════════════════
// BUG 2: AOE 濒死后响应链恢复
// ════════════════════════════════════════════════════════════════

describe.skip('AOE 濒死后响应链恢复', () => {
  it('南蛮入侵濒死后继续询问下一个玩家', () => {
    const state = createTestGame({ playerCount: 3, playPhase: true, seed: 456 });
    let s = state;

    // P2 和 P3 都只有 1 体力
    s = setHealth(s, 'P2', 1);
    s = setHealth(s, 'P3', 1);

    // 移除所有桃
    const cardMap = s.cardMap;
    for (const p of ['P1', 'P2', 'P3']) {
      const noPeach = s.players[p].hand.filter(id => cardMap[id]?.name !== '桃');
      s = {
        ...s,
        players: {
          ...s.players,
          [p]: { ...s.players[p], hand: noPeach },
        },
      };
    }

    // 给 P1 注入南蛮入侵
    s = injectTrickCard(s, 'P1', '南蛮入侵');
    const aoeId = findCardInHand(s, 'P1', '南蛮入侵');
    expect(aoeId).toBeDefined();

    // P1 出南蛮入侵
    const r1pre = engine(s, { type: '打出一张牌', player: 'P1', cardId: aoeId! });
    expect(r1pre.error).toBeUndefined();
    // 先进入 trickResponse 窗口（无懈可击窗口）
    expect(r1pre.state.pending?.type).toBe('响应窗口');
    if (r1pre.state.pending?.type === '响应窗口') {
      expect(r1pre.state.pending.window.type).toBe('trickResponse');
    }

    // 所有玩家 pass 过无懈可击窗口
    const r1state = passAllTrickResponders(r1pre.state);

    expect(r1state.pending).not.toBeNull();
    const pending = r1state.pending!;
    expect(pending.type).toBe('响应窗口');
    if (pending.type !== '响应窗口') return;
    expect(pending.window.type).toBe('aoeResponse');
    if (pending.window.type !== 'aoeResponse') return;

    // P2 不出杀 → 受伤 → 濒死
    const r2 = engine(r1state, { type: '打出', player: pending.window.defender });
    expect(r2.error).toBeUndefined();

    const defender = pending.window.defender;
    const defenderState = r2.state.players[defender];
    expect(defenderState.health).toBe(0);
    if (defenderState.health > 0) return;

    // 濒死窗口
    expect(r2.state.pending?.type).toBe('濒死窗口');
    if (r2.state.pending?.type !== '濒死窗口') return;

    // 验证 resumeAoe 存在
    expect(r2.state.pending.resumeAoe).toBeDefined();
    expect(r2.state.pending.resumeAoe!.remainingTargets.length).toBeGreaterThan(0);

    // 遍历所有 saver 直到死亡或救活
    let dyingState = r2.state;
    while (dyingState.pending?.type === '濒死窗口') {
      const dp = dyingState.pending;
      const saver = dp.savers[dp.currentSaverIndex];
      dyingState = engine(dyingState, { type: '打出', player: saver }).state;
    }

    // 死亡后应该恢复 AOE 链（先进入下一个目标的无懈可击窗口）
    if (dyingState.pending) {
      expect(dyingState.pending.type).toBe('响应窗口');
      if (dyingState.pending.type === '响应窗口') {
        // per-target 无懈可击：先进入 trickResponse，pass 后才是 aoeResponse
        if (dyingState.pending.window.type === 'trickResponse') {
          dyingState = passAllTrickResponders(dyingState);
        }
        if (dyingState.pending?.type === '响应窗口') {
          expect(dyingState.pending.window.type).toBe('aoeResponse');
        }
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════
// BUG 4: 桃园结义/五谷丰登
// ════════════════════════════════════════════════════════════════

describe.skip('桃园结义', () => {
  it('所有受伤玩家各回 1 点体力', () => {
    let s = createTestGame({ playerCount: 2, playPhase: true });
    const p1max = s.players.P1.maxHealth;
    s = setHealth(s, 'P1', p1max - 2);
    s = setHealth(s, 'P2', s.players.P2.maxHealth - 2);

    s = injectTrickCard(s, 'P1', '桃园结义');
    const cardId = findCardInHand(s, 'P1', '桃园结义');

    const r = engine(s, { type: '打出一张牌', player: 'P1', cardId: cardId! });
    expect(r.error).toBeUndefined();
    expect(r.state.players.P1.health).toBe(p1max - 1);
    expect(r.state.players.P2.health).toBe(s.players.P2.maxHealth - 1);
  });

  it('体力满的玩家不再回复', () => {
    let s = createTestGame({ playerCount: 2, playPhase: true });
    s = setHealth(s, 'P2', s.players.P2.maxHealth - 1);
    // P1 满血

    s = injectTrickCard(s, 'P1', '桃园结义');
    const cardId = findCardInHand(s, 'P1', '桃园结义');

    const r = engine(s, { type: '打出一张牌', player: 'P1', cardId: cardId! });
    expect(r.error).toBeUndefined();
    expect(r.state.players.P1.health).toBe(s.players.P1.maxHealth); // 不变
    expect(r.state.players.P2.health).toBe(s.players.P2.maxHealth); // +1
  });
});

describe.skip('五谷丰登', () => {
  it('翻出存活玩家数量的牌，从当前回合玩家开始逆时针选牌', () => {
    let s = createTestGame({ playerCount: 3, playPhase: true, seed: 789 });
    const deckBefore = s.zones.deck.length;
    const aliveCount = 3;

    s = injectTrickCard(s, 'P1', '五谷丰登');
    const cardId = findCardInHand(s, 'P1', '五谷丰登');
    expect(cardId).toBeDefined();
    if (!cardId) return;

    const r1 = engine(s, { type: '打出一张牌', player: 'P1', cardId, target: 'P1' });
    expect(r1.error).toBeUndefined();

    // 应该进入 harvestSelection pending
    expect(r1.state.pending?.type).toBe('收获选牌');
    if (r1.state.pending?.type !== '收获选牌') return;
    const harvest = r1.state.pending;

    // 翻出了 aliveCount 张牌
    expect(harvest.revealedCards.length).toBe(aliveCount);
    // 选牌顺序：P1（当前回合玩家）→ P3 → P2（逆时针）
    expect(harvest.pickOrder).toEqual(['P1', 'P3', 'P2']);
    // 牌堆减少了 aliveCount 张
    expect(r1.state.zones.deck.length).toBe(deckBefore - aliveCount);

    // P1 选第 1 张
    const pick1 = harvest.revealedCards[0];
    const r2 = engine(r1.state, { type: '打出', player: 'P1', cardId: pick1 });
    expect(r2.error).toBeUndefined();
    // P1 手牌应该多了这张
    expect(r2.state.players.P1.hand).toContain(pick1);

    // 轮到 P3 选牌
    expect(r2.state.pending?.type).toBe('收获选牌');
    if (r2.state.pending?.type !== '收获选牌') return;
    const h2 = r2.state.pending;
    expect(h2.currentPickerIndex).toBe(1);
    expect(h2.pickOrder[h2.currentPickerIndex]).toBe('P3');
    // revealed 少了 1 张
    expect(h2.revealedCards.length).toBe(aliveCount - 1);

    // P3 选第 2 张
    const pick2 = h2.revealedCards[0];
    const r3 = engine(r2.state, { type: '打出', player: 'P3', cardId: pick2 });
    expect(r3.error).toBeUndefined();
    expect(r3.state.players.P3.hand).toContain(pick2);

    // 轮到 P2 选牌
    expect(r3.state.pending?.type).toBe('收获选牌');
    if (r3.state.pending?.type !== '收获选牌') return;
    const h3 = r3.state.pending;
    expect(h3.currentPickerIndex).toBe(2);
    expect(h3.pickOrder[h3.currentPickerIndex]).toBe('P2');
    expect(h3.revealedCards.length).toBe(aliveCount - 2);

    // P2 选最后 1 张
    const pick3 = h3.revealedCards[0];
    const r4 = engine(r3.state, { type: '打出', player: 'P2', cardId: pick3 });
    expect(r4.error).toBeUndefined();
    expect(r4.state.players.P2.hand).toContain(pick3);

    // 选完后回到出牌阶段
    expect(r4.state.pending?.type).toBe('出牌阶段');
  });

  it('牌堆不足时只翻出可用数量的牌', () => {
    let s = createTestGame({ playerCount: 5, playPhase: true, seed: 111 });
    // 清空牌堆只剩 2 张
    s = { ...s, zones: { deck: s.zones.deck.slice(0, 2), discardPile: s.zones.discardPile } };

    s = injectTrickCard(s, 'P1', '五谷丰登');
    const cardId = findCardInHand(s, 'P1', '五谷丰登');
    expect(cardId).toBeDefined();
    if (!cardId) return;

    const r = engine(s, { type: '打出一张牌', player: 'P1', cardId, target: 'P1' });
    expect(r.error).toBeUndefined();

    // 只翻了 2 张（牌堆只有 2 张，但 5 个存活玩家）
    expect(r.state.pending?.type).toBe('收获选牌');
    if (r.state.pending?.type !== '收获选牌') return;
    expect(r.state.pending.revealedCards.length).toBe(2);
  });

  it('选牌玩家不能选别人的牌', () => {
    let s = createTestGame({ playerCount: 2, playPhase: true, seed: 222 });

    s = injectTrickCard(s, 'P1', '五谷丰登');
    const cardId = findCardInHand(s, 'P1', '五谷丰登');
    expect(cardId).toBeDefined();
    if (!cardId) return;

    const r1 = engine(s, { type: '打出一张牌', player: 'P1', cardId, target: 'P1' });
    expect(r1.error).toBeUndefined();
    expect(r1.state.pending?.type).toBe('收获选牌');
    if (r1.state.pending?.type !== '收获选牌') return;

    // P2 尝试选牌（应该是 P1 的回合）
    const r2 = engine(r1.state, { type: '打出', player: 'P2', cardId: r1.state.pending.revealedCards[0] });
    expect(r2.error).toBeDefined();
  });

  it('五谷丰登上限为存活玩家数', () => {
    let s = createTestGame({ playerCount: 2, playPhase: true, seed: 333 });

    s = injectTrickCard(s, 'P1', '五谷丰登');
    const cardId = findCardInHand(s, 'P1', '五谷丰登');
    expect(cardId).toBeDefined();
    if (!cardId) return;

    const r = engine(s, { type: '打出一张牌', player: 'P1', cardId, target: 'P1' });
    expect(r.error).toBeUndefined();

    // 2 个存活玩家 → 翻 2 张
    expect(r.state.pending?.type).toBe('收获选牌');
    if (r.state.pending?.type !== '收获选牌') return;
    expect(r.state.pending.revealedCards.length).toBe(2);
    expect(r.state.pending.pickOrder.length).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// BUG 3: clearTurnVars
// ════════════════════════════════════════════════════════════════

describe.skip('回合重置', () => {
  it('killsPlayed 在新回合重置为 0', () => {
    const s = createTestGame({ playerCount: 2, playPhase: true });

    const killId = findCardInHand(s, 'P1', '杀');
    expect(killId).toBeDefined();
    if (!killId) return;

    // P1 出杀
    const r1 = engine(s, { type: '打出一张牌', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();
    if (r1.error) return;

    // P2 不闪
    const r2 = engine(r1.state, { type: '打出', player: 'P2' });
    expect(r2.error).toBeUndefined();
    if (r2.error) return;

    expect(r2.state.turn.killsPlayed).toBe(1);

    // P1 结束回合
    const r3 = engine(r2.state, { type: '结束回合', player: 'P1' });
    if (r3.error) return;

    // P2 回合 → P2 出牌阶段
    // killsPlayed 应该为 0（新回合）
    expect(r3.state.turn.killsPlayed).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 完整游戏流程（2人简化局）
// ════════════════════════════════════════════════════════════════

describe.skip('完整游戏流程', () => {
  it('2人局从出牌到游戏结束', () => {
    let s = createTestGame({
      playerCount: 2,
      playPhase: true,
      characters: ['曹操', '刘备'],
      seed: 123,
    });

    // 设定身份
    s = {
      ...s,
      players: {
        ...s.players,
        P1: { ...s.players.P1, info: { ...s.players.P1.info, role: '主公' } },
        P2: { ...s.players.P2, info: { ...s.players.P2.info, role: '反贼' } },
      },
    };

    // P2 体力 1，移除所有桃
    s = setHealth(s, 'P2', 1);
    const p1noPeach = s.players.P1.hand.filter(id => s.cardMap[id]?.name !== '桃');
    const p2noPeach = s.players.P2.hand.filter(id => s.cardMap[id]?.name !== '桃');
    s = {
      ...s,
      players: {
        ...s.players,
        P1: { ...s.players.P1, hand: p1noPeach },
        P2: { ...s.players.P2, hand: p2noPeach },
      },
    };

    // P1 注入杀
    s = injectCard(s, 'P1', '杀');
    const killId = findCardInHand(s, 'P1', '杀');
    expect(killId).toBeDefined();

    // P1 出杀 P2
    const r1 = engine(s, { type: '打出一张牌', player: 'P1', cardId: killId!, target: 'P2' });
    expect(r1.error).toBeUndefined();
    expect(r1.state.pending?.type).toBe('响应窗口');

    // P2 不闪
    const r2 = engine(r1.state, { type: '打出', player: 'P2' });
    expect(r2.error).toBeUndefined();

    // 遍历濒死窗口
    let currentState = r2.state;
    while (currentState.pending?.type === '濒死窗口') {
      const dp = currentState.pending;
      const saver = dp.savers[dp.currentSaverIndex];
      currentState = engine(currentState, { type: '打出', player: saver }).state;
    }

    // P2 死亡 → 反贼全灭 → 主公胜
    expect(currentState.players.P2.info.alive).toBe(false);
    expect(currentState.meta.status).toBe('已结束');
    expect(currentState.meta.winner).toBe('主公');
  });

  it('弃牌阶段 → 下一玩家 → 阶段自动推进', () => {
    let s = createTestGame({ playerCount: 2, playPhase: true });

    // P1 体力 1，手牌多
    s = setHealth(s, 'P1', 1);
    // 确保手牌比体力多
    s = injectCard(s, 'P1', '杀');
    s = injectCard(s, 'P1', '闪');

    const p1hand = s.players.P1.hand;
    const discardCount = p1hand.length - 1;
    expect(discardCount).toBeGreaterThan(0);

    // P1 结束回合
    const r1 = engine(s, { type: '结束回合', player: 'P1' });
    expect(r1.error).toBeUndefined();

    // 应该进入弃牌阶段
    expect(r1.state.pending?.type).toBe('弃牌阶段');
    if (r1.state.pending?.type !== '弃牌阶段') return;

    expect(r1.state.pending.min).toBe(discardCount);
    expect(r1.state.pending.max).toBe(discardCount);

    // 弃牌
    const discardIds = p1hand.slice(0, discardCount);
    const r2 = engine(r1.state, { type: '弃置', player: 'P1', cardIds: discardIds });
    expect(r2.error).toBeUndefined();

    // 弃牌后应该自动切换到 P2 并推进到出牌阶段
    expect(r2.state.currentPlayer).toBe('P2');
    expect(r2.state.phase).toBe('出牌');
  });
});

// ════════════════════════════════════════════════════════════════
// 决斗完整流程
// ════════════════════════════════════════════════════════════════

describe.skip('决斗完整流程', () => {
  it('决斗双方交替出杀', () => {
    let s = createTestGame({ playerCount: 2, playPhase: true });

    // 给双方各注入决斗和杀
    s = injectTrickCard(s, 'P1', '决斗');
    s = injectCard(s, 'P1', '杀');
    s = injectCard(s, 'P2', '杀');

    const duelId = findCardInHand(s, 'P1', '决斗');
    expect(duelId).toBeDefined();
    if (!duelId) return;

    // P1 对 P2 用决斗
    const r1 = engine(s, { type: '打出一张牌', player: 'P1', cardId: duelId, target: 'P2' });
    expect(r1.error).toBeUndefined();
    if (r1.error) return;

    // 跳过无懈可击
    let currentState = r1.state;
    while (currentState.pending?.type === '响应窗口' && currentState.pending.window.type === 'trickResponse') {
      currentState = engine(currentState, { type: '打出', player: currentState.pending.window.defender }).state;
    }

    // 应该是 duelResponse
    expect(currentState.pending?.type).toBe('响应窗口');
    if (currentState.pending?.type !== '响应窗口') return;
    expect(currentState.pending.window.type).toBe('duelResponse');
    if (currentState.pending.window.type !== 'duelResponse') return;

    // P2 出杀
    const p2kill = findCardInHand(currentState, 'P2', '杀');
    expect(p2kill).toBeDefined();
    if (!p2kill) return;
    const r2 = engine(currentState, { type: '打出', player: 'P2', cardId: p2kill });
    expect(r2.error).toBeUndefined();

    // 应该交换攻守，轮到 P1 出杀
    expect(r2.state.pending?.type).toBe('响应窗口');
    if (r2.state.pending?.type !== '响应窗口') return;
    expect(r2.state.pending.window.type).toBe('duelResponse');
    expect(r2.state.pending.window.defender).toBe('P1');

    // P1 不出 → 受伤
    const r3 = engine(r2.state, { type: '打出', player: 'P1' });
    expect(r3.error).toBeUndefined();
    expect(r3.state.players.P1.health).toBeLessThan(s.players.P1.maxHealth);
  });
});

// ════════════════════════════════════════════════════════════════
// 濒死救援完整流程
// ════════════════════════════════════════════════════════════════

describe.skip('濒死救援', () => {
  it('出桃救人 → 体力恢复 → 游戏继续', () => {
    let s = createTestGame({ playerCount: 2, playPhase: true });
    s = setHealth(s, 'P2', 1);

    // 标准规则：求桃从当前回合玩家开始，濒死者最后自救
    // 当前回合是 P1（用杀者），所以桃给 P1
    s = injectCard(s, 'P1', '桃');
    // 给 P1 注入杀
    s = injectCard(s, 'P1', '杀');

    const killId = findCardInHand(s, 'P1', '杀');
    expect(killId).toBeDefined();
    if (!killId) return;

    // P1 出杀 P2
    const r1 = engine(s, { type: '打出一张牌', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();
    if (r1.error) return;

    // P2 不闪 → 受伤 → 濒死
    const r2 = engine(r1.state, { type: '打出', player: 'P2' });
    expect(r2.error).toBeUndefined();

    expect(r2.state.pending?.type).toBe('濒死窗口');
    if (r2.state.pending?.type !== '濒死窗口') return;
    expect(r2.state.pending.dyingPlayer).toBe('P2');

    // P1 有桃，先救
    const peachId = findCardInHand(r2.state, 'P1', '桃');
    expect(peachId).toBeDefined();
    if (!peachId) return;

    const r3 = engine(r2.state, { type: '打出', player: 'P1', cardId: peachId });
    expect(r3.error).toBeUndefined();

    // P2 应该被救回
    expect(r3.state.players.P2.info.alive).toBe(true);
    expect(r3.state.players.P2.health).toBeGreaterThan(0);

    // 游戏不应该结束
    expect(r3.state.meta.status).toBe('进行中');
  });
});
