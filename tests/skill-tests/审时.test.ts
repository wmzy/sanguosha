// 审时(蒯越蒯良·魏·主动技·转换技)测试
//   阳:出牌阶段限一次,交给手牌数最多的其他角色一张牌,对其造成1点伤害;
//       若其因此死亡,可令一名角色摸至四张。
//   阴:其他角色对你造成伤害后,观看其手牌并交给其一张牌;
//       当前回合结束阶段,若其未失去此牌,你将手牌摸至四张。
//
// 验证:
//   1. 阳:交给手牌最多者一张牌 → 造成1点伤害 → 翻转为阴
//   2. 阳:目标非手牌最多者 → 拒绝
//   3. 阳:致死 → 令一名角色摸至四张
//   4. 阴:受伤害后交给其一张牌 → 翻为阳 → 回合结束其未失去此牌 → 自己摸至四张
//   5. 阴:不发动 → 不翻转
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import 荐降Mod from '../../src/engine/skills/荐降';
import 审时Mod from '../../src/engine/skills/审时';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

// 运行时注册(subagent 不碰 index.ts 源文件;主 agent 统一注册)
setSkillModuleOverride('荐降', async () => 荐降Mod);
setSkillModuleOverride('审时', async () => 审时Mod);

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
  vars?: Record<string, unknown>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '蒯越蒯良',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as Record<string, never>,
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function getState(state: GameState, ownerId: number): '阳' | '阴' {
  return state.players[ownerId]?.vars['审时/态'] === '阴' ? '阴' : '阳';
}

describe('审时', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 阳:交给手牌最多者一张牌 → 造成1伤害 → 翻阴 ────────────
  it('阳:交给手牌最多者一张牌并造成1点伤害,翻转为阴', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['审时'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['x', 'y', 'z'], character: '张飞', health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: ['a'], character: '刘备', health: 4, maxHealth: 4 }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '2'),
        x: makeCard('x', '闪', '♥', '2'),
        y: makeCard('y', '闪', '♥', '3'),
        z: makeCard('z', '闪', '♥', '4'),
        a: makeCard('a', '闪', '♣', '2'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    expect(getState(harness.state, 0)).toBe('阳');

    // P1(3张)为手牌最多者 → 对其发动阳
    await P0.triggerAction('审时', 'use', { target: 1, cardId: 'c1' });

    // c1 给了 P1;P1 受1点伤害;状态翻阴
    expect(harness.state.players[1].hand).toContain('c1');
    expect(harness.state.players[1].hand.length).toBe(4);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].hand.length).toBe(0); // c1 已给出
    expect(getState(harness.state, 0)).toBe('阴');
  });

  // ─── 阳:目标非手牌最多者 → 拒绝 ────────────────────
  it('阳:目标不是手牌最多者 → 拒绝', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['审时'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['x', 'y', 'z'], character: '张飞' }),
        makePlayer({ index: 2, name: 'P2', hand: ['a'], character: '刘备' }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '2'),
        x: makeCard('x', '闪', '♥', '2'),
        y: makeCard('y', '闪', '♥', '3'),
        z: makeCard('z', '闪', '♥', '4'),
        a: makeCard('a', '闪', '♣', '2'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P2(1张)非最多(P1有3张)→ 拒绝
    await P0.expectRejected({
      skillId: '审时',
      actionType: 'use',
      params: { target: 2, cardId: 'c1' },
    });
    expect(getState(harness.state, 0)).toBe('阳'); // 未发动,未翻转
  });

  // ─── 阳:致死 → 令一名角色摸至四张 ────────────────────
  it('阳:目标因此死亡,令一名角色摸至四张', async () => {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['审时'], health: 3, maxHealth: 3 }),
        // P1 手牌最多(4张)且 1 血 → 给牌+伤害致死
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['x', 'y', 'z', 'w'],
          character: '张飞',
          health: 1,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: ['a'], character: '刘备', health: 4, maxHealth: 4 }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '2'),
        x: makeCard('x', '闪', '♥', '2'),
        y: makeCard('y', '闪', '♥', '3'),
        z: makeCard('z', '闪', '♥', '4'),
        w: makeCard('w', '闪', '♥', '5'),
        a: makeCard('a', '闪', '♣', '2'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: Array.from({ length: 10 }, (_, i) => `dd${i}`), discardPile: [], processing: [] },
    });
    // 补 deck 牌面
    for (let i = 0; i < 10; i++) {
      state.cardMap[`dd${i}`] = makeCard(`dd${i}`, '杀', '♠', '2');
    }
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    // 发动阳 → 给牌+伤害 → P1 濒死(1血)→ 求桃
    await P0.triggerAction('审时', 'use', { target: 1, cardId: 'c1' });

    // P1 濒死求桃:依次询问各玩家,全部 pass(无人有桃)→ P1 死亡
    // 循环 pass 直到出现 审时致死确认 pending(请求回应)
    for (let i = 0; i < 6; i++) {
      const slots = harness.state.pendingSlots;
      if (slots.size === 0) break;
      const slot = [...slots.values()][0];
      const atom = slot.atom as { type: string; requestType?: string };
      if (atom.type === '请求回应' && atom.requestType === '审时/阳/致死确认') break;
      await P2.pass();
    }

    // 现在 pending 应为 审时致死确认
    P0.expectPending('请求回应');
    await P0.respond('审时', { choice: true }); // 发动:令一名角色摸至四张

    // 选择 P0 自己摸至四张
    P0.expectPending('请求回应');
    await P0.respond('审时', { targets: [0] });

    // P0 摸至四张(原 0 张 → 4 张)
    expect(harness.state.players[0].hand.length).toBe(4);
    // P1 已死亡
    expect(harness.state.players[1].alive).toBe(false);
    expect(getState(harness.state, 0)).toBe('阴'); // 仍为阴(阳已发动)
  });

  // ─── 阴:受伤害后交给其一张牌 → 翻阳 → 回合结束其未失去此牌 → 摸至四张 ──
  it('阴:受伤害后给牌,回合结束其未失去此牌,自己摸至四张', async () => {
    const state = createGameState({
      players: [
        // P0 预置阴态;带 give1(将给出)与 shan(不闪,以确保受伤)
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['give1', 'shan'],
          skills: ['审时', '回合管理'],
          health: 3,
          maxHealth: 3,
          vars: { '审时/态': '阴' },
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['s1'], character: '张飞', health: 4, maxHealth: 4, skills: ['回合管理'] }),
        makePlayer({ index: 2, name: 'P2', hand: ['p'], character: '刘备', health: 4, maxHealth: 4, skills: ['回合管理'] }),
      ],
      cardMap: {
        give1: makeCard('give1', '杀', '♠', '2'),
        shan: makeCard('shan', '闪', '♥', '2'),
        s1: makeCard('s1', '杀', '♠', '7'),
        p: makeCard('p', '闪', '♣', '2'),
      },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: Array.from({ length: 10 }, (_, i) => `dd${i}`), discardPile: [], processing: [] },
    });
    for (let i = 0; i < 10; i++) {
      state.cardMap[`dd${i}`] = makeCard(`dd${i}`, '杀', '♠', '2');
    }
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    expect(getState(harness.state, 0)).toBe('阴');

    // P1 对 P0 出杀
    await P1.useCardAndTarget('杀', 's1', [0]);

    // 询问闪 → P0 不闪(以受伤触发阴)
    P0.expectPending('询问闪');
    await P0.pass();

    // P0 受伤 → 阴 confirm
    P0.expectPending('请求回应');
    await P0.respond('审时', { choice: true });

    expect(harness.state.players[0].health).toBe(2); // 受 1 伤

    // 选一张手牌给 P1(翻转在给牌完成后)
    P0.expectPending('请求回应');
    await P0.respond('审时', { cardIds: ['give1'] });

    // give1 已给 P1;P1 仍持有此牌;阴已完整结算 → 翻为阳
    expect(harness.state.players[1].hand).toContain('give1');
    expect(harness.state.players[0].hand).not.toContain('give1');
    expect(harness.state.players[0].hand.length).toBe(1); // 仅剩 shan
    expect(getState(harness.state, 0)).toBe('阳'); // 给牌完成后翻为阳

    // P1 结束回合 → 回合结束阶段 → 审时检查:P1 未失去 give1 → P0 摸至四张
    await P1.triggerAction('回合管理', 'end');

    // P0 摸至四张(原 1 张 → 4 张,摸 3 张)
    expect(harness.state.players[0].hand.length).toBe(4);
  });

  // ─── 阴:不发动 → 不翻转 ────────────────────────────
  it('阴:不发动 → 不翻转,保持阴态', async () => {
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['shan'],
          skills: ['审时'],
          health: 3,
          maxHealth: 3,
          vars: { '审时/态': '阴' },
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['s1', 'k1'], character: '张飞', health: 4, maxHealth: 4 }),
      ],
      cardMap: {
        shan: makeCard('shan', '闪', '♥', '2'),
        s1: makeCard('s1', '杀', '♠', '7'),
        k1: makeCard('k1', '闪', '♣', '2'),
      },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    // P1 对 P0 出杀 → P0 不闪 → 受伤 → 阴 confirm
    await P1.useCardAndTarget('杀', 's1', [0]);
    P0.expectPending('询问闪');
    await P0.pass();

    P0.expectPending('请求回应');
    await P0.respond('审时', { choice: false }); // 不发动

    // 未翻转,仍为阴;未给牌
    expect(getState(harness.state, 0)).toBe('阴');
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand.length).toBe(1); // shan 未给出
  });

  // 回归(2026-08-26):useCard 型 pending 浏览器只发 {cardId};修复前 validate 只认
  // cardIds 数组并拒绝 → 给牌步必败,超时后按未给牌中止(技能在浏览器不可用)。
  it('阴:给牌接受浏览器 {cardId} 单数形状', async () => {
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['give1', 'shan'],
          skills: ['审时', '回合管理'],
          health: 3,
          maxHealth: 3,
          vars: { '审时/态': '阴' },
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['s1'], character: '张飞', health: 4, maxHealth: 4, skills: ['回合管理'] }),
        makePlayer({ index: 2, name: 'P2', hand: ['p'], character: '刘备', health: 4, maxHealth: 4, skills: ['回合管理'] }),
      ],
      cardMap: {
        give1: makeCard('give1', '杀', '♠', '2'),
        shan: makeCard('shan', '闪', '♥', '2'),
        s1: makeCard('s1', '杀', '♠', '7'),
        p: makeCard('p', '闪', '♣', '2'),
      },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: Array.from({ length: 10 }, (_, i) => `dd${i}`), discardPile: [], processing: [] },
    });
    for (let i = 0; i < 10; i++) {
      state.cardMap[`dd${i}`] = makeCard(`dd${i}`, '杀', '♠', '2');
    }
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    await P1.useCardAndTarget('杀', 's1', [0]);
    P0.expectPending('询问闪');
    await P0.pass();
    P0.expectPending('请求回应');
    await P0.respond('审时', { choice: true });
    P0.expectPending('请求回应'); // 审时/YINgive 选牌
    await P0.respond('审时', { cardId: 'give1' }); // 浏览器两步式真实形状
    await harness.waitForStable();

    expect(harness.state.players[1].hand).toContain('give1');
    expect(getState(harness.state, 0)).toBe('阳'); // 给牌完成 → 翻阳
  });
});
