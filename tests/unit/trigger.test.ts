import { describe, it, expect } from 'vitest';
import { TriggerSystem, type GameEvent, type HookHandler } from '@engine/trigger';
import { triggerToEventType } from '@engine/trigger';
import type { GameState, Effect } from '@shared/types';
import { createGame } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';

function makeGame(): GameState {
  const game = createGame([曹操, 刘备]);
  game.status = '进行中';
  return game;
}

describe('TriggerSystem', () => {
  it('应该注册并触发处理器', () => {
    const ts = new TriggerSystem();
    const effects: Effect[] = [{ type: 'draw', count: 1 }];
    const handler: HookHandler = () => effects;

    ts.on('damageReceived', handler);

    const game = makeGame();
    const event: GameEvent = { type: 'damageReceived', player: '曹操', amount: 1 };
    const result = ts.collectEffects(game, event);

    expect(result).toEqual(effects);
  });

  it('没有处理器时返回空数组', () => {
    const ts = new TriggerSystem();
    const game = makeGame();
    const event: GameEvent = { type: 'damageReceived', player: '曹操' };
    const result = ts.collectEffects(game, event);

    expect(result).toEqual([]);
  });

  it('同一事件类型可以注册多个处理器', () => {
    const ts = new TriggerSystem();
    const effect1: Effect = { type: 'draw', count: 1 };
    const effect2: Effect = { type: 'heal', amount: 1 };

    const handler1: HookHandler = () => [effect1];
    const handler2: HookHandler = () => [effect2];

    ts.on('damageReceived', handler1);
    ts.on('damageReceived', handler2);

    const game = makeGame();
    const event: GameEvent = { type: 'damageReceived', player: '曹操', amount: 1 };
    const result = ts.collectEffects(game, event);

    expect(result).toEqual([effect1, effect2]);
  });

  it('不同事件类型的处理器互不影响', () => {
    const ts = new TriggerSystem();
    const damageEffect: Effect = { type: 'draw', count: 1 };
    const turnEffect: Effect = { type: 'heal', amount: 1 };

    ts.on('damageReceived', () => [damageEffect]);
    ts.on('turnStart', () => [turnEffect]);

    const game = makeGame();

    const damageResult = ts.collectEffects(game, { type: 'damageReceived', player: '曹操' });
    expect(damageResult).toEqual([damageEffect]);

    const turnResult = ts.collectEffects(game, { type: 'turnStart', player: '曹操' });
    expect(turnResult).toEqual([turnEffect]);
  });

  it('off 可以移除处理器', () => {
    const ts = new TriggerSystem();
    const effect: Effect = { type: 'draw', count: 1 };
    const handler: HookHandler = () => [effect];

    ts.on('damageReceived', handler);
    ts.off('damageReceived', handler);

    const game = makeGame();
    const result = ts.collectEffects(game, { type: 'damageReceived', player: '曹操' });
    expect(result).toEqual([]);
  });

  it('off 移除指定处理器不影响其他处理器', () => {
    const ts = new TriggerSystem();
    const effect1: Effect = { type: 'draw', count: 1 };
    const effect2: Effect = { type: 'heal', amount: 1 };

    const handler1: HookHandler = () => [effect1];
    const handler2: HookHandler = () => [effect2];

    ts.on('damageReceived', handler1);
    ts.on('damageReceived', handler2);
    ts.off('damageReceived', handler1);

    const game = makeGame();
    const result = ts.collectEffects(game, { type: 'damageReceived', player: '曹操' });
    expect(result).toEqual([effect2]);
  });

  it('处理器返回空数组时不产生效果', () => {
    const ts = new TriggerSystem();
    ts.on('damageReceived', () => []);

    const game = makeGame();
    const result = ts.collectEffects(game, { type: 'damageReceived', player: '曹操' });
    expect(result).toEqual([]);
  });

  it('处理器可以返回多个效果', () => {
    const ts = new TriggerSystem();
    const effects: Effect[] = [
      { type: 'draw', count: 2 },
      { type: 'heal', amount: 1 },
    ];
    ts.on('damageReceived', () => effects);

    const game = makeGame();
    const result = ts.collectEffects(game, { type: 'damageReceived', player: '曹操' });
    expect(result).toHaveLength(2);
    expect(result).toEqual(effects);
  });

  it('处理器接收正确的 game 和 event 参数', () => {
    const ts = new TriggerSystem();
    let receivedGame: GameState | undefined;
    let receivedEvent: GameEvent | undefined;

    ts.on('damageReceived', (game, event) => {
      receivedGame = game;
      receivedEvent = event;
      return [];
    });

    const game = makeGame();
    const event: GameEvent = { type: 'damageReceived', player: '曹操', attacker: '刘备', amount: 2 };
    ts.collectEffects(game, event);

    expect(receivedGame).toBe(game);
    expect(receivedEvent).toBe(event);
  });
});
