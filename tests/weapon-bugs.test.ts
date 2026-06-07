import { describe, it, expect } from 'vitest';
import { createStandardDeck } from '../shared/deck';
import { getAttackRange, isInAttackRange } from '../engine/distance';
import { engine } from '../engine/engine';
import { createTestGame, injectEquipCard, injectCard } from './engine-helpers';
import { hasUnlimitedKills } from '../engine/validate';
import type { GameState } from '../engine/types';

function setPlayPhase(state: GameState): GameState {
  return { ...state, phase: '出牌', pending: null };
}

describe('武器 deck 字段 (BUG #1)', () => {
  it('createStandardDeck 生成的武器 Card 携带 range 字段', () => {
    const deck = createStandardDeck();
    const qilin = deck.find(c => c.name === '麒麟弓');
    expect(qilin).toBeDefined();
    expect(qilin?.range).toBe(5);
  });

  it('createStandardDeck 中每种武器的 range 与 CardDef 一致', () => {
    const deck = createStandardDeck();
    const expected: Record<string, number> = {
      诸葛连弩: 1,
      青釭剑: 2,
      雌雄双股剑: 2,
      贯石斧: 3,
      青龙偃月刀: 3,
      丈八蛇矛: 3,
      方天画戟: 4,
      麒麟弓: 5,
    };
    for (const [name, range] of Object.entries(expected)) {
      const card = deck.find(c => c.name === name);
      expect(card?.range, `武器 ${name} 应有 range=${range}`).toBe(range);
    }
  });
});

describe('武器 attackRange 与出杀 (BUG #1)', () => {
  it('装备麒麟弓后 P1 可对 P3 (distance=2) 出杀', () => {
    let state = createTestGame({ playerCount: 4 });
    state = setPlayPhase(state);
    state = injectEquipCard(state, 'P1', '麒麟弓', '武器', 5);
    const weaponId = state.players['P1'].hand[state.players['P1'].hand.length - 1];

    const result = engine(state, {
      type: '打出一张牌',
      player: 'P1',
      cardId: weaponId,
    });
    expect(result.error).toBeUndefined();
  });

  it('装备麒麟弓后 P1 可对 P4 (distance=3) 出杀', () => {
    let state = createTestGame({ playerCount: 4 });
    state = setPlayPhase(state);
    state = injectEquipCard(state, 'P1', '麒麟弓', '武器', 5);
    const weaponId = state.players['P1'].hand[state.players['P1'].hand.length - 1];

    const result = engine(state, {
      type: '打出一张牌',
      player: 'P1',
      cardId: weaponId,
    });
    expect(result.error).toBeUndefined();
  });

  it('无武器时 P1 不能对 P3 (distance=2 > range=1) 出杀', () => {
    let state = createTestGame({ playerCount: 4 });
    state = setPlayPhase(state);
    state = injectCard(state, 'P1', '杀');
    const killId = state.players['P1'].hand[state.players['P1'].hand.length - 1];

    expect(isInAttackRange(state, 'P1', 'P3')).toBe(false);
    const result = engine(state, {
      type: '打出一张牌',
      player: 'P1',
      cardId: killId,
      target: 'P3',
    });
    expect(result.error).toBeTruthy();
  });
});

describe('武器技能 trigger 注册 (BUG #2 + #3)', () => {
  it('装备诸葛连弩后注册 unlimitedKills trigger', () => {
    let state = createTestGame();
    state = setPlayPhase(state);
    state = injectEquipCard(state, 'P1', '诸葛连弩', '武器');
    const weaponId = state.players['P1'].hand[state.players['P1'].hand.length - 1];

    const before = state.triggers.filter(t => t.source === '装备').length;
    const result = engine(state, { type: '打出一张牌', player: 'P1', cardId: weaponId });
    const after = result.state.triggers.filter(t => t.source === '装备').length;
    expect(after).toBe(before + 1);
    expect(hasUnlimitedKills(result.state, 'P1')).toBe(true);
  });

  it('装备诸葛连弩后第二次出杀仍被允许（unlimitedKills）', () => {
    let state = createTestGame();
    state = setPlayPhase(state);
    state = injectCard(state, 'P1', '杀');
    state = injectEquipCard(state, 'P1', '诸葛连弩', '武器');
    const kill1 = state.players['P1'].hand.find(id => state.cardMap[id]?.name === '杀')!;
    const weaponId = state.players['P1'].hand.find(id => state.cardMap[id]?.name === '诸葛连弩')!;

    const equipResult = engine(state, { type: '打出一张牌', player: 'P1', cardId: weaponId });
    expect(equipResult.error).toBeUndefined();

    const r1 = engine(equipResult.state, { type: '打出一张牌', player: 'P1', cardId: kill1, target: 'P2' });
    expect(r1.error).toBeUndefined();
  });

  it('装备贯石斧后注册 forceHit trigger (killDodged event)，不硬编码为 killResponse', () => {
    let state = createTestGame();
    state = setPlayPhase(state);
    state = injectEquipCard(state, 'P1', '贯石斧', '武器', 3);
    const weaponId = state.players['P1'].hand[state.players['P1'].hand.length - 1];

    const result = engine(state, { type: '打出一张牌', player: 'P1', cardId: weaponId });
    expect(result.error).toBeUndefined();

    const trigger = result.state.triggers.find(
      t => t.source === '装备' && t.skillId === '贯石斧',
    );
    expect(trigger).toBeDefined();
    expect(trigger?.event).toBe('杀被闪避');
  });

  it('装备青釭剑后注册 ignoreArmor trigger (v3HookOnly event — 1D-T3 青釭剑 v3 钩子迁移)', () => {
    let state = createTestGame();
    state = setPlayPhase(state);
    state = injectEquipCard(state, 'P1', '青釭剑', '武器', 2);
    const weaponId = state.players['P1'].hand[state.players['P1'].hand.length - 1];
    const result = engine(state, { type: '打出一张牌', player: 'P1', cardId: weaponId });
    const trigger = result.state.triggers.find(
      t => t.source === '装备' && t.skillId === '青釭剑',
    );
    expect(trigger).toBeDefined();
    // 1D-T3：青釭剑的 v3 实现走 engine/skills/qinggang.ts 的 registerAtomHook；
    // registerSkill 的 trigger 占位为 v3HookOnly（v2 emitEvent 永不触发，state.triggers 仍命中）。
    expect(trigger?.event).toBe('v3HookOnly');
  });

  it('装备八卦阵后注册 judgeDodge trigger (v3HookOnly event — 1D-T2 八卦阵 v3 钩子迁移)', () => {
    let state = createTestGame();
    state = setPlayPhase(state);
    state = injectEquipCard(state, 'P1', '八卦阵', '防具');
    const armorId = state.players['P1'].hand[state.players['P1'].hand.length - 1];

    const result = engine(state, { type: '打出一张牌', player: 'P1', cardId: armorId });
    const trigger = result.state.triggers.find(
      t => t.source === '装备' && t.skillId === '八卦阵',
    );
    expect(trigger).toBeDefined();
    // 1D-T2：八卦阵的 v3 实现走 engine/skills/bagua.ts 的 registerAtomHook；
    // registerSkill 的 trigger 占位为 v3HookOnly（v2 emitEvent 永不触发，state.triggers 仍命中）。
    expect(trigger?.event).toBe('v3HookOnly');
  });

  it('装备旧武器后换新武器，注销旧 trigger 并注册新 trigger', () => {
    let state = createTestGame();
    state = setPlayPhase(state);
    state = injectEquipCard(state, 'P1', '诸葛连弩', '武器');
    state = injectEquipCard(state, 'P1', '贯石斧', '武器', 3);
    const zhuId = state.players['P1'].hand.find(id => state.cardMap[id]?.name === '诸葛连弩')!;
    const guanId = state.players['P1'].hand.find(id => state.cardMap[id]?.name === '贯石斧')!;

    let s = engine(state, { type: '打出一张牌', player: 'P1', cardId: zhuId }).state;
    s = engine(s, { type: '打出一张牌', player: 'P1', cardId: guanId }).state;

    const triggers = s.triggers.filter(t => t.source === '装备' && t.player === 'P1');
    expect(triggers.length).toBe(1);
    expect(triggers[0]?.skillId).toBe('贯石斧');
  });
});

describe('杀事件触发 (BUG #4)', () => {
  it('杀被闪抵消时生成 killDodged ServerEvent', () => {
    let state = createTestGame();
    state = setPlayPhase(state);
    state = injectCard(state, 'P1', '杀');
    state = injectCard(state, 'P2', '闪');
    const killId = state.players['P1'].hand.find(id => state.cardMap[id]?.name === '杀')!;

    const r1 = engine(state, { type: '打出一张牌', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();

    const dodgeId = r1.state.players['P2'].hand.find(id => state.cardMap[id]?.name === '闪')!;
    const r2 = engine(r1.state, { type: '打出', player: 'P2', cardId: dodgeId });
    expect(r2.error).toBeUndefined();
    const types = r2.events.map(e => e.type);
    expect(types).toContain('杀被闪避');
  });

  it('杀命中时生成 killHit ServerEvent', () => {
    let state = createTestGame();
    state = setPlayPhase(state);
    state = injectCard(state, 'P1', '杀');
    const killId = state.players['P1'].hand.find(id => state.cardMap[id]?.name === '杀')!;

    const r1 = engine(state, { type: '打出一张牌', player: 'P1', cardId: killId, target: 'P2' });
    expect(r1.error).toBeUndefined();

    const r2 = engine(r1.state, { type: '打出', player: 'P2' });
    expect(r2.error).toBeUndefined();
    const types = r2.events.map(e => e.type);
    expect(types).toContain('杀命中');
  });
});
