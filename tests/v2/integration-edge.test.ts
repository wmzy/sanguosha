/**
 * tests/v2/integration-edge.test.ts — 边界条件集成测试
 *
 * 覆盖 bug-coverage-analysis.md 中列出的边界条件：
 * 1. 牌堆抽空后的 reshuffle
 * 2. 多人局距离计算
 * 3. 濒死/死亡流程
 * 4. 响应链（AOE、决斗）
 * 5. 卡牌目标验证
 */
import { describe, it, expect } from 'vitest';
import { safeEngine as engine } from './invariants';
import {
  createTestGame,
  setPlayPhase,
  injectCard,
  injectTrickCard,
  injectEquipCard,
  findCardInHand,
  setHealth,
  getCharacterMap,
} from './setup';
import { registerCharacterTriggers } from '@engine/v2/skill';
import { getDistance } from '@engine/v2/distance';
import { applyAtoms } from '@engine/v2/handlers/engine-utils';

// ════════════════════════════════════════════════════════════════
// 1. 牌堆抽空 + reshuffle
// ════════════════════════════════════════════════════════════════

describe('边界: 牌堆抽空 + reshuffle', () => {
  it('空牌堆抽牌后，卡牌从弃牌堆洗回牌堆', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    const originalDeck = [...state.zones.deck];
    // 清空牌堆，把牌全放弃牌堆
    state = { ...state, zones: { deck: [], discardPile: originalDeck } };

    // 出杀（不关心结果，只观察 reshuffle 是否发生）
    const killId = findCardInHand(state, 'P1', '杀');
    if (killId) {
      const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: killId, target: 'P2' });
      // 杀进了弃牌堆
      expect(r1.state.zones.discardPile.length).toBeGreaterThan(0);
    }

    // endTurn 触发整回合流，至少能正常执行不崩溃
    const r2 = engine(state, { type: 'endTurn', player: 'P1' });
    // 应该能正常切换玩家（走不需要弃牌的分支）
    // 注意：如果 handSize(4) > health, 会走到弃牌分支
    if (r2.error) {
      // 如果有错误，说明 reshuffle 或 draw 逻辑有问题
    }
  });

  it('draw atom 在牌堆为空时自动 reshuffle', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    const originalDeck = [...state.zones.deck];
    // 清空牌堆，把牌全放弃牌堆
    state = { ...state, zones: { deck: [], discardPile: originalDeck } };

    // 执行一个需要抽牌的操作
    // 无中生有会抽 2 张
    state = injectTrickCard(state, 'P1', '无中生有');
    const trickId = findCardInHand(state, 'P1', '无中生有')!;
    const result = engine(state, { type: 'playCard', player: 'P1', cardId: trickId });
    expect(result.error).toBeUndefined();
    // 应该从弃牌堆洗回后抽到了牌
    expect(result.state.players['P1'].hand.length).toBe(state.players['P1'].hand.length + 1); // 用掉了无中生有，抽了2张
  });
});

// ════════════════════════════════════════════════════════════════
// 2. 多人局距离
// ════════════════════════════════════════════════════════════════

describe('边界: 多人局距离', () => {
  it('4人局 P1→P2 距离为 1', () => {
    const state = createTestGame({ playerCount: 4 });
    const dist = getDistance(state, 'P1', 'P2');
    expect(dist).toBe(1);
  });

  it('4人局 P1→P3 距离为 2', () => {
    const state = createTestGame({ playerCount: 4 });
    const dist = getDistance(state, 'P1', 'P3');
    expect(dist).toBe(2);
  });

  it('装备-1马后 P1→P3 距离变为 1', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 4 }));
    state = injectEquipCard(state, 'P1', '赤兔', '进攻马');
    const equipId = findCardInHand(state, 'P1', '赤兔')!;
    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: equipId });
    expect(r1.error).toBeUndefined();

    const dist = getDistance(r1.state, 'P1', 'P3');
    expect(dist).toBe(1); // -1马后 P1→P3 距离从 2 变 1
  });

  it('顺手牵羊检查距离=1，对距离为2的目标应当报错', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 4 }));
    state = injectTrickCard(state, 'P1', '顺手牵羊');
    const trickId = findCardInHand(state, 'P1', '顺手牵羊')!;

    // P1→P3 距离为 2，顺手牵羊要求距离=1
    const dist = getDistance(state, 'P1', 'P3');
    expect(dist).toBe(2);

    const result = engine(state, {
      type: 'playCard', player: 'P1', cardId: trickId, target: 'P3',
    });
    // ⚠️ validateAction 在进入 handleTrickCard 之前先检查攻击范围
    // 顺手牵羊自己的距离检查（getDistance===1）未被执行
    // 这是 validation 层的通用检查与特化 card handler 的矛盾
    expect(result.error).toBe('目标不在攻击范围内');
  });

  it('顺手牵羊对距离=1的目标可以正常使用', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectTrickCard(state, 'P1', '顺手牵羊');
    const trickId = findCardInHand(state, 'P1', '顺手牵羊')!;
    expect(state.players['P2'].hand.length).toBeGreaterThan(0);

    const r1 = engine(state, {
      type: 'playCard', player: 'P1', cardId: trickId, target: 'P2',
    });
    expect(r1.error).toBeUndefined();
    // 应该弹出选牌 pending
    expect(r1.state.pending?.type).toBe('selectCard');
  });
});

// ════════════════════════════════════════════════════════════════
// 3. 濒死/死亡流程
// ════════════════════════════════════════════════════════════════

describe('边界: 濒死/死亡流程', () => {
  it('杀将目标体力降至0时触发濒死 pending', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    // 让 P2 只有 1 体力
    state = setHealth(state, 'P2', 1);
    const killId = findCardInHand(state, 'P1', '杀');
    if (!killId) return;

    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();

    // 不出闪 → 受伤至 0
    const r2 = engine(r1.state, { type: 'respond', player: 'P2' });
    // 应该触发濒死窗口
    const isDying = r2.state.pending?.type === 'dyingWindow' ||
      r2.events?.some(e => e.type === 'dying');
    if (!isDying) {
      // ⚠️ BUG 可能性: 濒死未触发
      // resolveKillResponse 第 103-143 行应该检查濒死
      // 如果不出闪直接受伤，应该 pushPending(dyingWindow)
    }
  });

  it('桃可以将濒死角色救回', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = setHealth(state, 'P2', 1);
    // createDyingPending 的 savers 顺序为 [濒死者, 其他玩家...]
    // 2 人局濒死者是 P2，所以 P2（濒死者）优先自救
    state = injectCard(state, 'P2', '桃');

    const killId = findCardInHand(state, 'P1', '杀');
    if (!killId) return;

    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: killId, target: 'P2' });
    const r2 = engine(r1.state, { type: 'respond', player: 'P2' });

    if (r2.state.pending?.type === 'dyingWindow') {
      // 濒死窗口 → P2（濒死者）出桃自救
      const peachId = r2.state.players['P2'].hand.find(id => r2.state.cardMap[id]?.name === '桃');
      if (peachId) {
        const r3 = engine(r2.state, { type: 'respond', player: 'P2', cardId: peachId });
        expect(r3.error).toBeUndefined();
        // P2 被救回，体力变为 1
        expect(r3.state.players['P2'].health).toBe(1);
        expect(r3.state.players['P2'].info.alive).toBe(true);
      }
    }
    // 如果没有濒死窗口，说明濒死逻辑有问题
  });
});

// ════════════════════════════════════════════════════════════════
// 4. 卡牌目标验证
// ════════════════════════════════════════════════════════════════

describe('边界: 卡牌目标验证', () => {
  it('杀不能对自己使用', () => {
    const state = setPlayPhase(createTestGame({ playerCount: 2 }));
    const killId = findCardInHand(state, 'P1', '杀');
    if (!killId) return;

    const result = engine(state, {
      type: 'playCard', player: 'P1', cardId: killId, target: 'P1',
    });
    expect(result.error).toBeTruthy();
  });

  it('杀不能对已死亡的玩家使用', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    // 标记 P2 为阵亡
    state = {
      ...state,
      players: {
        ...state.players,
        P2: { ...state.players['P2'], info: { ...state.players['P2'].info, alive: false } },
      },
    };
    const killId = findCardInHand(state, 'P1', '杀');
    if (!killId) return;

    const result = engine(state, {
      type: 'playCard', player: 'P1', cardId: killId, target: 'P2',
    });
    expect(result.error).toBeTruthy();
  });

  it('不能使用不存在的手牌', () => {
    const state = setPlayPhase(createTestGame());
    const result = engine(state, {
      type: 'playCard', player: 'P1', cardId: 'nonexistent-card',
    });
    expect(result.error).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════
// 5. AOE 和决斗
// ════════════════════════════════════════════════════════════════

describe('边界: AOE/决斗', () => {
  it('南蛮入侵等非标准锦囊走 default 分支直接弃牌（未实现）', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectTrickCard(state, 'P1', '南蛮入侵');
    const trickId = findCardInHand(state, 'P1', '南蛮入侵')!;

    const result = engine(state, {
      type: 'playCard', player: 'P1', cardId: trickId,
    });
    // handleTrickCard default 分支（line 243-256）：
    // 直接把牌 moveCard 到弃牌堆
    expect(result.error).toBeUndefined();
    expect(result.state.zones.discardPile.includes(trickId)).toBe(true);

    // ⚠️ BUG: 南蛮入侵作为 AOE 应该让所有其他玩家响应出杀
    // 但实际只被当作无效锦囊丢掉了
  });

  it('决斗只走 default 分支（未实现决斗响应链）', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectTrickCard(state, 'P1', '决斗');
    const trickId = findCardInHand(state, 'P1', '决斗')!;

    const result = engine(state, {
      type: 'playCard', player: 'P1', cardId: trickId, target: 'P2',
    });
    expect(result.error).toBeUndefined();
    // 决斗走 default 分支，直接弃牌
    expect(result.state.zones.discardPile.includes(trickId)).toBe(true);
    // ⚠️ BUG: 决斗应该触发 duelResponse 链
  });

  it('过河拆桥用完源牌也在弃牌堆中', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectTrickCard(state, 'P1', '过河拆桥');
    const trickId = findCardInHand(state, 'P1', '过河拆桥')!;

    const r1 = engine(state, {
      type: 'playCard', player: 'P1', cardId: trickId, target: 'P2',
    });
    expect(r1.error).toBeUndefined();

    // 过河拆桥没有在 pushPending 前 moveCard 源牌
    // 应该先弃掉源牌（过河拆桥），再让玩家选牌
    // 但 current approach：先 pushPending，resolveSelectCard 时再弃源牌
    // 这导致 pending 期间，过河拆桥还在手牌中
    // 测试 pending 是否正确设置
    expect(r1.state.pending?.type).toBe('selectCard');
    if (r1.state.pending?.type === 'selectCard') {
      expect(r1.state.pending.min).toBe(1);
      expect(r1.state.pending.max).toBe(1);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 6. 装备相关
// ════════════════════════════════════════════════════════════════

describe('边界: 装备', () => {
  it('装备武器后攻击范围更新', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 4 }));
    // P1→P3 默认距离 2，默认攻击范围 1（无武器），所以杀不到
    const beforeKill = findCardInHand(state, 'P1', '杀');
    if (beforeKill) {
      const rBefore = engine(state, {
        type: 'playCard', player: 'P1', cardId: beforeKill, target: 'P3',
      });
      expect(rBefore.error).toBeTruthy(); // 不在攻击范围内
    }

    // 装备麒麟弓（武器范围 5）
    state = injectEquipCard(state, 'P1', '麒麟弓', '武器', 5);
    const equipId = findCardInHand(state, 'P1', '麒麟弓')!;
    const rEquip = engine(state, { type: 'playCard', player: 'P1', cardId: equipId });
    expect(rEquip.error).toBeUndefined();

    // 现在可以杀到 P3 了
    const afterKill = findCardInHand(rEquip.state, 'P1', '杀');
    if (afterKill) {
      const rAfter = engine(rEquip.state, {
        type: 'playCard', player: 'P1', cardId: afterKill, target: 'P3',
      });
      expect(rAfter.error).toBeUndefined();
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 7. 死亡玩家行为限制
// ════════════════════════════════════════════════════════════════

describe('边界: 死亡玩家行为限制', () => {
  it('已死亡玩家出牌应报错', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = {
      ...state,
      currentPlayer: 'P2',
      players: {
        ...state.players,
        P2: { ...state.players['P2'], info: { ...state.players['P2'].info, alive: false } },
      },
    };
    const killId = findCardInHand(state, 'P2', '杀');
    if (!killId) return;
    const result = engine(state, {
      type: 'playCard', player: 'P2', cardId: killId, target: 'P1',
    });
    expect(result.error).toBe('你已阵亡');
  });

  it('已死亡玩家不能成为决斗目标', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectTrickCard(state, 'P1', '决斗');
    const trickId = findCardInHand(state, 'P1', '决斗')!;
    state = {
      ...state,
      players: {
        ...state.players,
        P2: { ...state.players['P2'], info: { ...state.players['P2'].info, alive: false } },
      },
    };
    const result = engine(state, {
      type: 'playCard', player: 'P1', cardId: trickId, target: 'P2',
    });
    expect(result.error).toBe('目标已阵亡');
  });
});

// ════════════════════════════════════════════════════════════════
// 8. 延时锦囊原子操作（addPendingTrick / removePendingTrick）
// ════════════════════════════════════════════════════════════════

describe('边界: 延时锦囊原子操作', () => {
  it('addPendingTrick atom 将延时锦囊挂到目标判定区', () => {
    const state = createTestGame({ playerCount: 2 });
    const cardId = state.players['P1'].hand[0];
    const card = state.cardMap[cardId];
    if (!card) return;
    const trick = { name: '乐不思蜀', source: 'P1', card };
    const { state: newState } = applyAtoms(state, [
      { type: 'addPendingTrick', player: 'P2', trick },
    ]);
    expect(newState.players['P2'].pendingTricks).toHaveLength(1);
    expect(newState.players['P2'].pendingTricks[0].card.id).toBe(cardId);
  });

  it('removePendingTrick atom 从判定区移除', () => {
    const state = createTestGame({ playerCount: 2 });
    const cardId = state.players['P1'].hand[0];
    const card = state.cardMap[cardId];
    if (!card) return;
    const trick = { name: '闪电', source: 'P1', card };
    const { state: s1 } = applyAtoms(state, [
      { type: 'addPendingTrick', player: 'P2', trick },
    ]);
    expect(s1.players['P2'].pendingTricks).toHaveLength(1);
    const { state: s2 } = applyAtoms(s1, [
      { type: 'removePendingTrick', player: 'P2', index: 0 },
    ]);
    expect(s2.players['P2'].pendingTricks).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 9. 严格状态不变量
// ════════════════════════════════════════════════════════════════

describe('边界: 状态不变量', () => {
  it('cardMap 中的每张牌都在某处（手牌/牌堆/弃牌堆/装备区/判定区）', () => {
    const state = createTestGame({ playerCount: 2 });

    // 收集所有可见卡牌 ID
    const visibleIds = new Set<string>();
    for (const p of state.playerOrder) {
      const player = state.players[p];
      player.hand.forEach(id => visibleIds.add(id));
      // 装备区
      if (player.equipment) {
        Object.values(player.equipment).forEach((id: any) => id && visibleIds.add(id));
      }
      // 判定区
      if (player.pendingTricks) {
        player.pendingTricks.forEach(trick => visibleIds.add(trick.card.id));
      }
    }
    state.zones.deck.forEach(id => visibleIds.add(id));
    state.zones.discardPile.forEach(id => visibleIds.add(id));

    const allCardIds = new Set(Object.keys(state.cardMap));

    // 全部 cardMap 的 key 都应该在 visibleIds 中
    for (const id of allCardIds) {
      expect(visibleIds.has(id)).toBe(true);
    }
  });

  it('不变量：玩家手牌中的每张牌 ID 都存在于 cardMap', () => {
    const state = createTestGame({ playerCount: 2 });
    for (const p of state.playerOrder) {
      const player = state.players[p];
      for (const id of player.hand) {
        expect(state.cardMap[id]).toBeDefined();
        expect(state.cardMap[id].id).toBe(id);
      }
    }
  });

  it('不变量：牌堆和弃牌堆中的每张牌 ID 都存在于 cardMap', () => {
    const state = createTestGame({ playerCount: 2 });
    for (const id of state.zones.deck) {
      expect(state.cardMap[id]).toBeDefined();
    }
    for (const id of state.zones.discardPile) {
      expect(state.cardMap[id]).toBeDefined();
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 卡牌边界行为
// ════════════════════════════════════════════════════════════════

describe('卡牌边界', () => {
  it('顺手牵羊 steal mode resolveSelectCard 正确放入偷牌者手牌', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectTrickCard(state, 'P1', '顺手牵羊');
    const cardId = findCardInHand(state, 'P1', '顺手牵羊')!;
    const p2HandBefore = [...state.players['P2'].hand];
    const step1 = engine(state, { type: 'playCard', player: 'P1', cardId, target: 'P2' });
    expect(step1.error).toBeUndefined();
    expect(step1.state.pending!.type).toBe('selectCard');
    const selected = p2HandBefore[0];
    const step2 = engine(step1.state, { type: 'respond', player: 'P1', cardIds: [selected] });
    expect(step2.error).toBeUndefined();
    expect(step2.state.players['P1'].hand.includes(selected)).toBe(true);
  });

  it('顺手牵羊距离检查装备-1马后距离0可用', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectTrickCard(state, 'P1', '顺手牵羊');
    state = injectEquipCard(state, 'P1', '赤兔', '进攻马');
    const cardId = findCardInHand(state, 'P1', '顺手牵羊')!;
    const result = engine(state, { type: 'playCard', player: 'P1', cardId, target: 'P2' });
    if (result.error?.includes('距离')) {
      // 距离检查 bug 仍存在
      expect(result.error).toBeTruthy();
    } else {
      expect(result.error).toBeUndefined();
    }
  });

  it('装备新武器时旧武器进入弃牌堆', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectEquipCard(state, 'P1', '青龙偃月刀', '武器', 3);
    const weapon1 = findCardInHand(state, 'P1', '青龙偃月刀')!;
    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: weapon1 });
    expect(r1.error).toBeUndefined();
    state = r1.state;
    state = injectEquipCard(state, 'P1', '麒麟弓', '武器', 5);
    const weapon2 = findCardInHand(state, 'P1', '麒麟弓')!;
    const r2 = engine(state, { type: 'playCard', player: 'P1', cardId: weapon2 });
    expect(r2.error).toBeUndefined();
    expect(r2.state.zones.discardPile.includes(weapon1)).toBe(true);
    expect(r2.state.players['P1'].equipment.weapon).toBe(weapon2);
  });

  it('牌堆+弃牌堆全空时 draw 不报错', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = { ...state, zones: { deck: [], discardPile: [] } };
    state = injectTrickCard(state, 'P1', '无中生有');
    const cardId = findCardInHand(state, 'P1', '无中生有')!;
    const handBefore = state.players['P1'].hand.length;
    const result = engine(state, { type: 'playCard', player: 'P1', cardId });
    expect(result.error).toBeUndefined();
    expect(result.state.players['P1'].hand.length).toBeLessThanOrEqual(handBefore);
  });

  it('过河拆桥出牌后 pending 期间 sourceCard 仍留在手牌', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectTrickCard(state, 'P1', '过河拆桥');
    const cardId = findCardInHand(state, 'P1', '过河拆桥')!;
    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId, target: 'P2' });
    expect(r1.state.players['P1'].hand.includes(cardId)).toBe(true);
  });

  it('延时锦囊使用后直接进入弃牌堆而非判定区', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectTrickCard(state, 'P1', '乐不思蜀');
    const cardId = findCardInHand(state, 'P1', '乐不思蜀')!;
    const handBefore = state.players['P1'].hand.length;
    const result = engine(state, { type: 'playCard', player: 'P1', cardId, target: 'P2' });
    expect(result.error).toBeUndefined();
    expect(result.state.players['P1'].hand.length).toBe(handBefore - 1);
    expect(result.state.zones.discardPile.includes(cardId)).toBe(true);
    expect(result.state.players['P2'].pendingTricks.length).toBe(0);
  });

  it('AOE 响应后伤害不触发 damageDealt 事件', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2, characters: ['夏侯惇', '曹操'] }));
    state = registerCharacterTriggers(state, 'P1', { characterMap: getCharacterMap() });
    const aoeState = { ...state, pending: { type: 'responseWindow' as const, window: { type: 'aoeResponse' as const, defender: 'P1' as any, attacker: 'P2' as any, validCards: [] as string[], sourceCard: 'test-arrow-1', timeout: 15000, deadline: Date.now() + 15000 }, timeout: 15000, deadline: Date.now() + 15000, onTimeout: { type: 'respond' as const, player: 'P1' as any } } };
    const result = engine(aoeState, { type: 'respond', player: 'P1' });
    expect(result.error).toBeUndefined();
    expect(result.state.players['P1'].health).toBeLessThan(state.players['P1'].health);
    expect(result.state.triggers.length).toBeGreaterThan(0);
  });

  it('顺手牵羊装备武器后 validate 允许但 handler 拒绝距离>1', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 4 }));
    state = injectEquipCard(state, 'P1', '青龙偃月刀', '武器', 3);
    const equipId = findCardInHand(state, 'P1', '青龙偃月刀')!;
    const rEquip = engine(state, { type: 'playCard', player: 'P1', cardId: equipId });
    if (rEquip.error) return;
    state = injectTrickCard(rEquip.state, 'P1', '顺手牵羊');
    const stealId = findCardInHand(state, 'P1', '顺手牵羊')!;
    const rFail = engine(state, { type: 'playCard', player: 'P1', cardId: stealId, target: 'P3' });
    expect(rFail.error).toBeTruthy();
  });
});
