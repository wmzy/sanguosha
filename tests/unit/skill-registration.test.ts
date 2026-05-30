import { describe, it, expect } from 'vitest';
import { TriggerSystem } from '@engine/trigger';
import { registerCharacterSkills } from '@engine/skill';
import { createGame } from '@engine/state';
import { 曹操, 刘备, 郭嘉, 夏侯惇 } from '@shared/characters';
import type { CharacterConfig, GameState } from '@shared/types';

function makeGame(characters: CharacterConfig[] = [曹操, 刘备]): GameState {
  const game = createGame(characters);
  game.status = '进行中';
  return game;
}

describe('registerCharacterSkills', () => {
  it('应该为被动技能注册触发处理器', () => {
    const ts = new TriggerSystem();
    registerCharacterSkills(ts, [曹操]);

    // 曹操的奸雄是 passive + onDamageReceived
    const game = makeGame();
    const effects = ts.collectEffects(game, {
      type: 'damageReceived',
      player: '曹操',
      attacker: '刘备',
      amount: 1,
    });

    expect(effects).toHaveLength(1);
    expect(effects[0]).toEqual({ type: 'gainCard', source: 'damageSourceCard' });
  });

  it('非被动技能不会被注册', () => {
    // 张辽的突袭没有 passive: true
    const 张辽: CharacterConfig = {
      name: '张辽',
      maxHealth: 4,
      gender: '男',
      faction: '魏',
      abilities: [
        {
          name: '突袭',
          description: '摸牌阶段，你可以放弃摸牌',
          trigger: 'onTurnStart',
          effect: { type: 'skipDraw' },
        },
      ],
    };

    const ts = new TriggerSystem();
    registerCharacterSkills(ts, [张辽]);

    const game = makeGame([张辽, 刘备]);
    const effects = ts.collectEffects(game, {
      type: 'turnStart',
      player: '张辽',
    });

    expect(effects).toHaveLength(0);
  });

  it('只有匹配的玩家才会触发', () => {
    const ts = new TriggerSystem();
    registerCharacterSkills(ts, [曹操]);

    const game = makeGame();
    // 刘备受伤，不应触发曹操的奸雄
    const effects = ts.collectEffects(game, {
      type: 'damageReceived',
      player: '刘备',
      attacker: '曹操',
      amount: 1,
    });

    expect(effects).toHaveLength(0);
  });

  it('作为 target 也能触发', () => {
    const ts = new TriggerSystem();
    registerCharacterSkills(ts, [曹操]);

    const game = makeGame();
    const effects = ts.collectEffects(game, {
      type: 'damageReceived',
      target: '曹操',
      attacker: '刘备',
      amount: 1,
    });

    expect(effects).toHaveLength(1);
  });

  it('事件类型不匹配时不触发', () => {
    const ts = new TriggerSystem();
    registerCharacterSkills(ts, [曹操]);

    const game = makeGame();
    // 曹操的奸雄是 onDamageReceived，用 turnStart 不应触发
    const effects = ts.collectEffects(game, {
      type: 'turnStart',
      player: '曹操',
    });

    expect(effects).toHaveLength(0);
  });

  it('可以注册多个角色的被动技能', () => {
    const ts = new TriggerSystem();
    registerCharacterSkills(ts, [曹操, 夏侯惇]);

    const game = makeGame([曹操, 夏侯惇]);

    // 曹操受伤 -> 触发奸雄
    const effectsCaoCao = ts.collectEffects(game, {
      type: 'damageReceived',
      player: '曹操',
      amount: 1,
    });
    expect(effectsCaoCao).toHaveLength(1);
    expect(effectsCaoCao[0]).toEqual({ type: 'gainCard', source: 'damageSourceCard' });

    // 夏侯惇受伤 -> 触发刚烈
    const effectsXiahou = ts.collectEffects(game, {
      type: 'damageReceived',
      player: '夏侯惇',
      amount: 1,
    });
    expect(effectsXiahou).toHaveLength(1);
    expect(effectsXiahou[0].type).toBe('sequence');
  });

  it('一个角色的多个被动技能都应注册', () => {
    const ts = new TriggerSystem();
    // 郭嘉有天妒(onJudge, passive)和遗计(onDamageReceived, passive)
    registerCharacterSkills(ts, [郭嘉]);

    const game = makeGame([郭嘉, 刘备]);

    // 触发 onDamageReceived -> 遗计
    const damageEffects = ts.collectEffects(game, {
      type: 'damageReceived',
      player: '郭嘉',
      amount: 1,
    });
    expect(damageEffects).toHaveLength(1);
    expect(damageEffects[0]).toEqual({ type: 'draw', count: 2 });
  });
});
