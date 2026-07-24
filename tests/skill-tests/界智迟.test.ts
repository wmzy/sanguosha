// 界智迟(界陈宫·群·锁定技)行为测试:
//   OL 界限突破官方逐字:
//   "锁定技,当你于回合外受到伤害后,本回合【杀】和普通锦囊牌对你无效。"
//
// 验证场景:
//   ① 回合外受伤后,本回合【杀】对 owner 无效(P1 出杀 P0,P0 不受伤)
//   ② 回合外受伤后,本回合普通锦囊(顺手牵羊)对 owner 无效
//   ③ 回合外受伤后,过河拆桥对 owner 无效(P0 的牌不被弃置)
//   ④ 回合外受伤后,南蛮入侵对 owner 无效(不询问出杀、不受伤害)
//   ⑤ 智迟未激活时:杀正常生效(对照组,确认第一张杀能造成伤害并激活智迟)
//   ⑥ 自己回合内受伤 → 智迟不激活(描述"回合外")
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { runDamageFlow } from '../../src/engine/damage-flow';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  trickSubtype?: '普通锦囊' | '延时锦囊' | '响应锦囊',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, trickSubtype };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: PlayerState['equipment'];
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界陈宫',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界智迟', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── ① 回合外受伤 → 本回合杀无效(诸葛连弩支持连出两杀)────────

  it('①:回合外受伤后,本回合【杀】对 owner 无效', async () => {
    const firstKill = makeCard('k1', '杀', '♠', '7');
    const secondKill = makeCard('k2', '杀', '♠', '8');
    const state: GameState = createGameState({
      players: [
        // P0 = 界陈宫(智迟 owner)
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界智迟'],
          health: 3,
          maxHealth: 3,
        }),
        // P1 = 攻击方(本回合的当前玩家),诸葛连弩解除杀次数限制
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1', 'k2'],
          skills: ['杀', '诸葛连弩'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: firstKill, k2: secondKill },
      currentPlayerIndex: 1, // P1 回合,P0 回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 对 P0 出杀 → P0 受伤,触发智迟
    await harness.player('P1').useCardAndTarget('杀', 'k1', [0]);
    await harness.player('P0').pass(); // 不出闪
    await harness.waitForStable();

    // 智迟已激活
    expect(harness.state.turn.vars['智迟/active']).toBe(0);
    // P0 已受伤 3→2
    expect(harness.state.players[0].health).toBe(2);
    // k1 入弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');

    // 第二张杀:本回合剩余时间智迟激活 → 杀无效
    await harness.player('P1').useCardAndTarget('杀', 'k2', [0]);
    await harness.waitForStable();

    // 杀无效:P0 体力不变(仍为 2)
    expect(harness.state.players[0].health).toBe(2);
    // k2 入弃牌堆(杀仍进入处理区→弃牌堆,只是成为目标被 cancel 不造成伤害)
    expect(harness.state.zones.discardPile).toContain('k2');
  });

  // ─── ② 回合外受伤 → 普通锦囊(顺手牵羊)无效 ────────────────

  it('②:回合外受伤后,本回合顺手牵羊对 owner 无效', async () => {
    const triggerKill = makeCard('k1', '杀', '♠', '7');
    const trick = makeCard('t1', '顺手牵羊', '♠', '3', '锦囊牌', '普通锦囊');
    const ownerCard = makeCard('p0c1', '闪', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['p0c1'],
          skills: ['界智迟'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1', 't1'],
          skills: ['杀', '顺手牵羊'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: triggerKill, t1: trick, p0c1: ownerCard },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 触发智迟:P1 出杀 P0
    await harness.player('P1').useCardAndTarget('杀', 'k1', [0]);
    await harness.player('P0').pass();
    await harness.waitForStable();
    expect(harness.state.turn.vars['智迟/active']).toBe(0);

    // P1 对 P0 用顺手牵羊 → 智迟激活 → 锦囊对 P0 无效
    await harness.player('P1').triggerAction('顺手牵羊', 'use', {
      cardId: 't1',
      target: 0,
    });
    await harness.waitForStable();

    // 无懈可击广播窗口:超时
    await harness.player('P0').pass();
    await harness.waitForStable();
    // P1 选 P0 的一张手牌面板
    await harness.player('P1').respond('顺手牵羊', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();

    // 顺手牵羊对 P0 无效:P0 的闪未被拿走
    expect(harness.state.players[0].hand).toContain('p0c1');
    expect(harness.state.players[1].hand).not.toContain('p0c1');
    // 锦囊牌入弃牌堆
    expect(harness.state.zones.discardPile).toContain('t1');
  });

  // ─── ③ 回合外受伤 → 过河拆桥无效 ──────────────────────────

  it('③:回合外受伤后,本回合过河拆桥对 owner 无效', async () => {
    const triggerKill = makeCard('k1', '杀', '♠', '7');
    const trick = makeCard('t2', '过河拆桥', '♠', 'J', '锦囊牌', '普通锦囊');
    const ownerCard = makeCard('p0c2', '桃', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['p0c2'],
          skills: ['界智迟'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1', 't2'],
          skills: ['杀', '过河拆桥'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: triggerKill, t2: trick, p0c2: ownerCard },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 触发智迟
    await harness.player('P1').useCardAndTarget('杀', 'k1', [0]);
    await harness.player('P0').pass();
    await harness.waitForStable();
    expect(harness.state.turn.vars['智迟/active']).toBe(0);

    // P1 对 P0 用过河拆桥(targets 数组形式)
    await harness.player('P1').triggerAction('过河拆桥', 'use', {
      cardId: 't2',
      targets: [0],
    });
    await harness.waitForStable();
    // 无懈窗口超时
    await harness.player('P0').pass();
    await harness.waitForStable();
    // P1 选要弃的牌(面板)
    await harness.player('P1').respond('过河拆桥', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();

    // 过河拆桥对 P0 无效:P0 的桃未被弃置
    expect(harness.state.players[0].hand).toContain('p0c2');
    expect(harness.state.zones.discardPile).not.toContain('p0c2');
    // 锦囊牌入弃牌堆
    expect(harness.state.zones.discardPile).toContain('t2');
  });

  // ─── ④ 回合外受伤 → 南蛮入侵无效(2人场景:只有 P0 是目标)──────

  it('④:回合外受伤后,本回合南蛮入侵对 owner 无效(不询问出杀、不受伤害)', async () => {
    const triggerKill = makeCard('k1', '杀', '♠', '7');
    const aoe = makeCard('nm1', '南蛮入侵', '♠', 'A', '锦囊牌', '普通锦囊');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界智迟'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1', 'nm1'],
          skills: ['杀', '南蛮入侵'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: triggerKill, nm1: aoe },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 触发智迟
    await harness.player('P1').useCardAndTarget('杀', 'k1', [0]);
    await harness.player('P0').pass();
    await harness.waitForStable();
    expect(harness.state.turn.vars['智迟/active']).toBe(0);

    // P1 用南蛮入侵(P0 是唯一其他角色 → 唯一目标)
    await harness.player('P1').useCard('南蛮入侵', 'nm1');
    await harness.waitForStable();

    // 无懈窗口(广播)
    await harness.player('P0').pass();
    await harness.waitForStable();
    // 智迟 cancel 了 询问杀(P0 不被问出杀);也 cancel 造成伤害 → P0 不受伤
    // 南蛮流程结束,nm1 入弃牌堆

    // 断言:P0 不受伤(智迟无效化南蛮);nm1 入弃牌堆
    expect(harness.state.players[0].health).toBe(2); // 之前受伤 3→2,南蛮不再次扣血
    expect(harness.state.zones.discardPile).toContain('nm1');
  });

  // ─── ⑤ 智迟未激活时:杀正常生效(对照组)──────────────────

  it('⑤:智迟未激活时,杀正常生效(对照组)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界智迟'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 出杀 P0:智迟未激活 → 正常受伤
    await harness.player('P1').useCardAndTarget('杀', 'k1', [0]);
    await harness.player('P0').pass();
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(2);
    // 受伤后激活智迟(本回合剩余时间)
    expect(harness.state.turn.vars['智迟/active']).toBe(0);
  });

  // ─── ⑥ 自己回合内受伤 → 智迟不激活 ───────────────────────

  it('⑥:自己回合内受伤 → 智迟不激活(描述"回合外")', async () => {
    // P0 = 界陈宫,自己回合(当前玩家)
    // 用反馈等技能典型场景较复杂;简化:直接验证 currentPlayerIndex===owner 时
    // 即便受伤也不激活。通过手动注入一次伤害 atom 验证 hook 判断。
    // 采用更简单的 setup:P0 自己回合,无伤害源(避免复杂链),
    // 直接断言 turn.vars['智迟/active'] 未被设置。
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界智迟'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0, // P0 自己回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接 applyAtom 一次伤害(target=P0,在 P0 自己回合)
    await runDamageFlow(state, 1, 0, 1);
    await harness.waitForStable();

    // 智迟未激活(currentPlayerIndex===owner,视为"回合内")
    expect(harness.state.turn.vars['智迟/active']).toBeUndefined();
    expect(harness.state.players[0].health).toBe(2);
  });
});
