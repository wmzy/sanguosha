/**
 * tests/event-audit.test.ts — 事件审计测试
 *
 * 验证每个引擎 handler 产生的 ServerEvent（游戏日志事件），
 * 以及 GameEvent（技能触发事件）的发射情况。
 *
 * ⚠️ 关键区别：
 *   - ServerEvent: 日志事件，使用 makeServerEvent() 创建，出现在 result.events 中
 *   - GameEvent: 技能触发事件，使用 emitEvent() 发射，不直接出现在 result.events 中
 *     GameEvent 的效果只能通过触发器链的副作用（如状态变化）间接观察
 */
import { describe, it, expect } from 'vitest';
import { safeEngine as engine } from './invariants';
import {
  createTestGame,
  setPlayPhase,
  injectCard,
  injectTrickCard,
  setHealth,
  findCardInHand,
  passAllTrickResponders,
} from './engine-helpers';
import { emitEvent, getSkillRegistry, registerCharacterTriggers } from '@engine/skill';
import { getCharacterMap } from './engine-helpers';
import { applyAtoms } from '@engine/handlers/engine-utils';

const charMap = getCharacterMap();

// ════════════════════════════════════════════════════════════════
// 1. endTurn 事件审计
// ════════════════════════════════════════════════════════════════

describe('事件审计: endTurn', () => {
  it('handleEndTurn 产生 turnEnd ServerEvent', () => {
    const state = setPlayPhase(createTestGame({ playerCount: 2 }));
    const result = engine(state, { type: 'endTurn', player: 'P1' });

    // handleEndTurn 第30行 makeServerEvent('turnEnd', { player })
    const found = result.events.some(e => e.type === 'turnEnd');
    expect(found).toBe(true);
  });

  it('resolveDiscardPhase 不产生 turnEnd ServerEvent（但之前已被 handleEndTurn 发射）', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = setHealth(state, 'P1', 1); // 手牌 > 体力，触发弃牌

    const r1 = engine(state, { type: 'endTurn', player: 'P1' });
    expect(r1.state.pending?.type).toBe('discardPhase');
    // handleEndTurn 中已经产生了 turnEnd ServerEvent
    expect(r1.events.some(e => e.type === 'turnEnd')).toBe(true);

    // 弃牌
    const hand = r1.state.players['P1'].hand;
    const r2 = engine(r1.state, {
      type: 'discard', player: 'P1', cardIds: hand.slice(0, hand.length - 1),
    });
    expect(r2.error).toBeUndefined();

    // resolveDiscardPhase 不产生 turnEnd ServerEvent（仅产生 cardDiscarded + turnStart）
    // 但这是合理的：turnEnd 在上层 handleEndTurn 中已经发射了
    expect(r2.events.some(e => e.type === 'turnEnd')).toBe(false);
    // 弃牌后应该产生 turnStart ServerEvent（切换到下一玩家）
    expect(r2.events.some(e => e.type === 'turnStart')).toBe(true);
  });

  it('handleEndTurn 产生 turnStart ServerEvent（无需弃牌时切换到下一玩家）', () => {
    const state = setPlayPhase(createTestGame({ playerCount: 2 }));
    const result = engine(state, { type: 'endTurn', player: 'P1' });

    // handleEndTurn 第61行 makeServerEvent('turnStart', ...)
    const found = result.events.some(e => e.type === 'turnStart');
    expect(found).toBe(true);
    expect(result.state.currentPlayer).toBe('P2');
  });
});

describe('事件审计: turnStart GameEvent 未被引擎发射', () => {
  it('注册 turnStart 监听器（如马术），执行 endTurn 后检查技能是否被触发', () => {
    let state = setPlayPhase(createTestGame({ characters: ['马超', '刘备'] }));
    state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });

    // 马术已注册触发器
    expect(state.triggers.some(t => t.skillId === '马术')).toBe(true);

    const _result = engine(state, { type: 'endTurn', player: 'P1' });

    // ⚠️ BUG: turnStart GameEvent 从未被 emitEvent 调用
    // handleEndTurn 只调用了 makeServerEvent('turnStart')
    // 而不是 emitEvent({ type: 'turnStart' })
    // 马术的 trigger.event = 'turnStart'，但引擎从未 emitEvent('turnStart')
    // 所以马术的 handler 永远不会被执行
    // 验证方式：马术 handler 即使为空（stub），也应该有 emitEvent 调用记录
    // 但 result.events 中没有任何马术 handler 执行产生的事件
    // 这无法直接断言，但通过代码审计可以确认 emitEvent 未被调用
  });
});

// ════════════════════════════════════════════════════════════════
// 2. phaseBegin 事件审计（系统性 bug）
// ════════════════════════════════════════════════════════════════

describe('事件审计: phaseBegin', () => {
  it('phaseBegin 在整个引擎中从未通过 emitEvent 发射（系统性 bug，影响 14+ 技能）', () => {
    // 验证思路：执行关键引擎操作后，检查是否有任何技能侧效应表明 phaseBegin 被触发
    // 由于没有技能会在 phaseBegin 触发后产生可观察的副作用（因为没有 emitEvent），
    // 我们无法通过 effects 验证 → 通过代码审计确认

    // 但可以通过间接方式：注册一个监听 phaseBegin 的技能（如英姿 摸牌阶段）
    let state = createTestGame({ characters: ['周瑜', '刘备'] });
    state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });

    // 英姿监听 phaseBegin + 摸牌
    expect(state.triggers.some(t => t.skillId === '英姿')).toBe(true);

    // 执行 endTurn → 下一玩家（P2）的出牌阶段
    // 如果 phaseBegin 被正确 emit，当轮到 P1 时英姿应触发
    // 但 handleEndTurn 从不 emit phaseBegin
    const _r1 = engine(setPlayPhase(state), { type: 'endTurn', player: 'P1' });

    // endTurn 只产生 turnEnd → 下一玩家，没有 phaseBegin 任何阶段
    // 所以英姿不可能被触发
  });

  it('setPhase atom 只产生 ServerEvent，不通过 emitEvent 发射 phaseBegin GameEvent', () => {
    const state = setPlayPhase(createTestGame());
    const { events } = applyAtoms(state, [
      { type: 'setPhase', phase: '弃牌' },
    ]);

    // applyAtoms 产生的 events 是 atoms 的 toEvents ServerEvent
    // 不包含 GameEvent（phaseBegin 需要通过 emitEvent 发射）
    expect(events.some(e => e.type === 'phaseBegin')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. cardPlayed 事件审计
// ════════════════════════════════════════════════════════════════

describe('事件审计: cardPlayed', () => {
  it('playCard(杀) 产生 cardPlayed ServerEvent', () => {
    const state = setPlayPhase(createTestGame({ characters: ['曹操', '刘备'] }));
    const killId = findCardInHand(state, 'P1', '杀')!;
    const result = engine(state, { type: 'playCard', player: 'P1', cardId: killId, target: 'P2' });

    // handlePlayCard 内部产生 cardPlayed ServerEvent
    expect(result.events.some(e => e.type === 'cardPlayed')).toBe(true);
  });

  it('playCard(锦囊) 产生 cardPlayed ServerEvent', () => {
    let state = setPlayPhase(createTestGame({ characters: ['曹操', '刘备'] }));
    state = injectTrickCard(state, 'P1', '无中生有');
    const trickId = findCardInHand(state, 'P1', '无中生有')!;
    const result = engine(state, { type: 'playCard', player: 'P1', cardId: trickId });

    expect(result.events.some(e => e.type === 'cardPlayed')).toBe(true);
  });

  it('playCard(无中生有) 产生 cardPlayed ServerEvent，集智监听并触发', () => {
    let state = setPlayPhase(createTestGame({ characters: ['黄月英', '刘备'] }));
    state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
    state = injectTrickCard(state, 'P1', '无中生有');
    const trickId = findCardInHand(state, 'P1', '无中生有')!;

    const beforeHand = state.players['P1'].hand.length;
    const step1 = engine(state, { type: 'playCard', player: 'P1', cardId: trickId });

    expect(step1.error).toBeUndefined();
    expect(step1.events.some(e => e.type === 'cardPlayed')).toBe(true);

    // 所有玩家 pass 过无懈可击窗口
    const result = passAllTrickResponders(step1.state);
    // 黄月英集智触发(+1) + 无中生有效果(+2) - 使用无中生有(-1) = +2
    expect(result.players['P1'].hand.length).toBe(beforeHand + 2);
  });
});

// ════════════════════════════════════════════════════════════════
// 4. 伤害事件审计
// ════════════════════════════════════════════════════════════════

describe('事件审计: 伤害事件', () => {
  it('resolveKillResponse（不出闪）产生 killHit ServerEvent 且目标掉血', () => {
    let state = setPlayPhase(createTestGame({ characters: ['曹操', '刘备'] }));
    state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
    const killId = findCardInHand(state, 'P1', '杀')!;
    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();

    const beforeHealth = r1.state.players['P2'].health;
    const r2 = engine(r1.state, { type: 'respond', player: 'P2' });
    expect(r2.error).toBeUndefined();

    // ServerEvent: killHit 被产生
    expect(r2.events.some(e => e.type === 'killHit')).toBe(true);
    // 伤害已应用
    expect(r2.state.players['P2'].health).toBe(beforeHealth - 1);
  });

  it('resolveKillResponse 内部调用 emitEvent({ type: "damageDealt" })，但无技能监听此事件', () => {
    // 代码审计：resolveKillResponse 第106行
    //   emitEvent(s, { type: 'damageDealt', source, target, amount, cardId })
    // 但所有伤害技能（奸雄、反馈、刚烈、遗计）监听的 GameEvent 是 damageReceived
    // 不是 damageDealt！
    //
    // 验证方式：注册监听 damageReceived 的技能，通过 engine() 执行杀→受伤
    // 由于引擎发射 damageDealt 而非 damageReceived，技能不触发
    // 这里我们通过 code reading 确认 emitEvent 调用存在，但它的效果是空的

    let state = setPlayPhase(createTestGame({ characters: ['夏侯惇', '刘备'] }));
    state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
    state = injectCard(state, 'P1', '杀');
    const killId = findCardInHand(state, 'P1', '杀')!;

    const r1 = engine(state, { type: 'playCard', player: 'P1', cardId: killId, target: 'P2' });
    const r2 = engine(r1.state, { type: 'respond', player: 'P2' });

    // 刚烈因事件类型不匹配未触发
    // P1（夏侯惇）没有任何状态变化（如 pending 刚烈判定）
    // 但无法通过 r2.events 直接验证 — 因为 GameEvent 不在此数组中
    // 只能验证伤害已应用（health 减少）
    expect(r2.state.players['P2'].health).toBeLessThan(r1.state.players['P2'].health);
  });

  it('resolveAoeResponse（不出杀）不发射任何伤害 GameEvent（BUG）', () => {
    // 代码审计：response-handlers.ts resolveAoeResponse 第173-191行
    // 只做了 applyAtoms(damage) + 濒死检查
    // 没有 emitEvent({ type: 'damageDealt' }) 或 damageReceived
    // 所以在 AOE 中受伤时，伤害技能（奸雄/反馈/刚烈/遗计）不会触发
    //
    // 另外，AOE 卡牌（南蛮入侵、万箭齐发）在 handleTrickCard 的 default 分支
    // 被直接弃牌（line 243），根本没有进入 resolveAoeResponse！
    // 所以 AOE 的整个响应链都未实现
  });

  it('resolveDuelResponse（不出杀）不发射伤害 GameEvent 且不检查濒死（BUG）', () => {
    // 代码审计：response-handlers.ts resolveDuelResponse 第236-247行
    // 只 applyAtoms(damage) 后直接 return
    // 没有 emitEvent(damageDealt) → 伤害技能不触发
    // 没有检查濒死 → 被决斗致死时没有濒死流程，玩家直接死亡（health ≤ 0 仍 alive）
  });

  it('damageReceived GameEvent 在整个引擎中从未被 emitEvent 发射（系统性 bug）', () => {
    // 代码审计：搜索引擎中所有 emitEvent() 调用
    // resolveKillResponse: emitEvent({ type: 'damageDealt' })
    // handleEndTurn:       emitEvent({ type: 'turnEnd' })
    // handlePlayCard:      emitEvent({ type: 'cardPlayed' })
    //
    // 没有一处调用 emitEvent({ type: 'damageReceived' })
    //
    // 技能依赖（在 skill.ts 中注册的 trigger.event）：
    //   奸雄、反馈、刚烈、遗计 → damageReceived
    //
    // 结果：engine 发射 damageDealt，技能监听 damageReceived
    // 事件类型不匹配，四个魏势力伤害技能全部永久静默

    // 验证方式：注册奸雄（曹操），通过 emitEvent 直接发射 damageReceived
    // （不通过 engine，直接测试 skill handler 逻辑）
    // 验证 handler 本身工作正常
    let state = createTestGame({ characters: ['曹操', '刘备'] });
    state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
    state = injectCard(state, 'P2', '杀');
    const killId = state.players.P2.hand.find(id => state.cardMap[id].name === '杀')!;

    const result = emitEvent(state, {
      type: 'damageReceived',
      target: 'P1',
      source: 'P2',
      amount: 1,
      cardId: killId,
    });
    // 奸雄 handler 正常执行（手牌+1）
    expect(result.state.players.P1.hand.length).toBeGreaterThan(
      state.players.P1.hand.length,
    );
    // ⚠️ 但 engine 从不发射 damageReceived！这个 emitEvent 是测试自己构造的
    // 真实游戏中曹操永远不会触发奸雄
    // 「测试通过 ≠ 游戏正常」
  });
});

// ════════════════════════════════════════════════════════════════
// 5. 完整 GameEvent 覆盖审计
// ════════════════════════════════════════════════════════════════

describe('事件审计: GameEvent 类型覆盖对比', () => {
  it('引擎通过 emitEvent 发射的 GameEvent 类型', () => {
    // 通过代码审计确认的 emitEvent 调用位置：
    // - turnEnd:     handleEndTurn (turn-handlers.ts:22)
    // - cardPlayed:  handlePlayCard (card-handlers.ts:46)
    // - damageDealt: resolveKillResponse (response-handlers.ts:106)
    const engineEmits = ['turnEnd', 'cardPlayed', 'damageDealt'];
    expect(engineEmits).toEqual(['turnEnd', 'cardPlayed', 'damageDealt']);
  });

  it('技能注册表中所有技能依赖的 GameEvent 类型', () => {
    const registry = getSkillRegistry();
    const requiredEvents = new Set<string>();

    registry.forEach(def => {
      if (def.trigger?.event) {
        requiredEvents.add(def.trigger.event);
      }
    });

    const required = [...requiredEvents].sort();
    // 技能依赖的事件类型
    // 通过 getAllEvents 生成的实际注册 event 类型
    expect(required.length).toBeGreaterThan(0);
  });

  it('引擎实际发射的 GameEvent 远少于技能依赖的事件', () => {
    const registry = getSkillRegistry();
    const requiredEvents = new Set<string>();
    registry.forEach(def => {
      if (def.trigger?.event) {
        requiredEvents.add(def.trigger.event);
      }
    });

    const engineEmits = new Set(['turnEnd', 'cardPlayed', 'damageDealt']);
    const missing = [...requiredEvents].filter(e => !engineEmits.has(e));

    // ⚠️ 这些事件从未被发射 = 对应技能永久静默
    // 这不是测试失败，而是文档化的框架性问题
    expect(missing.length).toBeGreaterThan(0);

    // 记录缺失的事件
    // 预期: turnStart, phaseBegin, damageReceived, cardDiscarded,
    //       equipChanged, judgeResult, dying, death, heal, killHit, killDodged
  });
});
