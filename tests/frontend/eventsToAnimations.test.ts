// LEGACY TEST: references deleted v2 modules - skipped
import { describe, it, expect, beforeEach } from 'vitest';
// import { eventsToAnimations } from '@engine/view/reducer';  // LEGACY: removed (v2 module deleted)
import { makePlayerEvent, resetEventCounter } from './helpers';

describe.skip('eventsToAnimations', () => {
  const PID = 'P1';

  beforeEach(() => {
    resetEventCounter();
  });

  it('damage event → damagePopup animation', () => {
    const events = [makePlayerEvent('造成伤害', { target: 'P2', amount: 2 })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'damagePopup', target: 'P2', amount: 2 },
    ]);
  });

  it('heal event → healGlow animation', () => {
    const events = [makePlayerEvent('回复体力', { target: 'P1', amount: 1 })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'healGlow', target: 'P1', amount: 1 },
    ]);
  });

  it('draw event → drawCards animation', () => {
    const events = [makePlayerEvent('摸牌', { player: 'P1', count: 2 })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'drawCards', player: 'P1', count: 2 },
    ]);
  });

  it('draw event for other player still produces drawCards', () => {
    const events = [makePlayerEvent('摸牌', { player: 'P2', count: 3 })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'drawCards', player: 'P2', count: 3 },
    ]);
  });

  it('discard event → discardCards animation', () => {
    const events = [makePlayerEvent('弃置', { player: 'P1', cardIds: ['c1', 'c2'] })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'discardCards', player: 'P1', cardIds: ['c1', 'c2'] },
    ]);
  });

  it('gainCard event → cardMove animation with from/to', () => {
    const events = [makePlayerEvent('获得', { player: 'P1', cardId: 'c5', from: { zone: '弃牌堆' } })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'cardMove', cardId: 'c5', from: { zone: '弃牌堆' }, to: { zone: '手牌', player: 'P1' }, duration: 300 },
    ]);
  });

  it('gainCard event with card object instead of cardId', () => {
    const events = [makePlayerEvent('获得', { player: 'P2', card: { id: 'c9' } })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'cardMove', cardId: 'c9', from: { zone: '弃牌堆' }, to: { zone: '手牌', player: 'P2' }, duration: 300 },
    ]);
  });

  it('equip event → equipItem animation', () => {
    const events = [makePlayerEvent('装备', { player: 'P1', cardId: 'weapon1', slot: '武器' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'equipItem', player: 'P1', cardId: 'weapon1', slot: '武器' },
    ]);
  });

  it('kill event with payload.player → death animation', () => {
    const events = [makePlayerEvent('击杀', { player: 'P3' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: '死亡', player: 'P3' },
    ]);
  });

  it('kill event with payload.target → death animation', () => {
    const events = [makePlayerEvent('击杀', { target: 'P2' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: '死亡', player: 'P2' },
    ]);
  });

  it('pushPending event → pendingPrompt animation', () => {
    const events = [makePlayerEvent('推入待定', { type: '响应窗口' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'pendingPrompt', actionType: '响应窗口' },
    ]);
  });

  it('judge event → cardFlip animation', () => {
    const events = [makePlayerEvent('判定', { cardId: 'judgeCard1' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'cardFlip', cardId: 'judgeCard1' },
    ]);
  });

  it('moveCard event → cardMove animation', () => {
    const events = [makePlayerEvent('移动牌', {
      cardId: 'c10',
      from: { zone: '手牌', player: 'P1' },
      to: { zone: '弃牌堆' },
    })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'cardMove', cardId: 'c10', from: { zone: '手牌', player: 'P1' }, to: { zone: '弃牌堆' }, duration: 300 },
    ]);
  });

  it('setPhase event → no animation', () => {
    const events = [makePlayerEvent('设阶段', { phase: '出牌' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([]);
  });

  it('nextPlayer event → nextPlayer animation', () => {
    const events = [makePlayerEvent('下一玩家', { player: 'P2' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: '下一玩家', player: 'P2' },
    ]);
  });

  it('addPendingTrick event → pendingPrompt animation', () => {
    const events = [makePlayerEvent('添加延时锦囊', { player: 'P3', trick: { name: '闪电' } })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'pendingPrompt', actionType: '添加延时锦囊' },
    ]);
  });

  it('removePendingTrick event → trickReveal animation', () => {
    const events = [makePlayerEvent('移除延时锦囊', { player: 'P3', cardId: 'trickCard1', result: 'success' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'trickReveal', cardId: 'trickCard1', result: 'success' },
    ]);
  });

  it('removePendingTrick with fail result', () => {
    const events = [makePlayerEvent('移除延时锦囊', { cardId: 'trickCard2', result: 'fail' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'trickReveal', cardId: 'trickCard2', result: 'fail' },
    ]);
  });

  it('unknown event → no animation', () => {
    const events = [makePlayerEvent('customEvent', { foo: 'bar' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([]);
  });

  it('empty events → empty array', () => {
    const anims = eventsToAnimations(PID, []);
    expect(anims).toEqual([]);
  });

  it('multiple events → multiple animations in order', () => {
    const events = [
      makePlayerEvent('造成伤害', { target: 'P2', amount: 1 }),
      makePlayerEvent('回复体力', { target: 'P1', amount: 1 }),
      makePlayerEvent('摸牌', { player: 'P1', count: 2 }),
      makePlayerEvent('设阶段', { phase: '弃牌' }),
      makePlayerEvent('击杀', { player: 'P2' }),
    ];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'damagePopup', target: 'P2', amount: 1 },
      { type: 'healGlow', target: 'P1', amount: 1 },
      { type: 'drawCards', player: 'P1', count: 2 },
      { type: '死亡', player: 'P2' },
    ]);
  });

  it('events with missing payload fields use defaults gracefully', () => {
    const events = [
      makePlayerEvent('造成伤害', {}),
      makePlayerEvent('弃置', { player: 'P1' }),
      makePlayerEvent('击杀', {}),
    ];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'damagePopup', target: '', amount: 0 },
      { type: 'discardCards', player: 'P1', cardIds: [] },
      { type: '死亡', player: '' },
    ]);
  });
});
