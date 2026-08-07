// tests/skill-tests/神速.test.ts
// 神速(夏侯渊)测试:
//   选项1:跳过判定+摸牌,视为对一名其他角色出杀(无距离限制)
//   选项2:跳过出牌+弃一张装备,视为对一名其他角色出杀
//   选项3:跳过弃牌+翻面,视为对一名其他角色出杀
//
// 验证:
//   1. 正面(选项1):发动 → 选目标 → 目标受 1 点伤害(或可闪)
//   2. 正面(选项1):发动后摸牌阶段被跳过(不摸 2 张)
//   3. 负面(选项1):不发动 → 判定/摸牌阶段正常进行
//   4. 正面(选项2):有装备时发动 → 弃装备 + 目标受伤
//   5. 负面(选项2):无装备 → 不询问(直接进入出牌)
//   6. 正面(选项3):发动 → 目标受伤 + 加翻面标签
//   7. 负面(选项3):不发动 → 无伤害、无翻面标签
//   8. 翻面:下一回合准备阶段消费标签 + 回合推进到下家
//   9. 出杀次数:神速虚拟杀计入出杀次数(charge),再出真杀被拒
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/index';
import { validateCardUse } from '../../src/engine/card-effect/validate';
import { slashUsed } from '../../src/engine/slash-quota';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '夏侯渊',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: (opts.equipment ?? {}),
    skills: opts.skills ?? ['神速'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发判定阶段:applyAtom(阶段开始, ownerId, 判定) → 神速 before-hook 询问 */
async function triggerJudgePhase(harness: SkillTestHarness, player = 0): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '判定' });
  await harness.waitForStable();
  harness.processAllEvents();
}

/** 触发出牌阶段:applyAtom(阶段开始, ownerId, 出牌) → 神速② before-hook 询问 */
async function triggerPlayPhase(harness: SkillTestHarness, player = 0): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '出牌' });
  await harness.waitForStable();
  harness.processAllEvents();
}

/** 触发摸牌阶段:applyAtom(阶段开始, ownerId, 摸牌) → 神速① 跳过摸牌 before-hook(有标签时跳过) */
async function triggerDrawPhase(harness: SkillTestHarness, player = 0): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '摸牌' });
  await harness.waitForStable();
  harness.processAllEvents();
}

/** 触发弃牌阶段:applyAtom(阶段开始, ownerId, 弃牌) → 神速③ before-hook 询问 */
async function triggerDiscardPhase(harness: SkillTestHarness, player = 0): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '弃牌' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('神速', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('选项1:发动 → 选目标 → 目标受 1 点伤害', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    // 询问是否发动神速①
    P1.expectPending('请求回应');

    await P1.respond('神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问目标
    P1.expectPending('请求回应');
    await P1.respond('神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // virtualKill 会询问 P2 出闪 → P2 不闪
    const P2 = harness.player('P2');
    await P2.pass();

    // P2 受 1 点伤害(无闪可出)
    expect(harness.state.players[1].health).toBe(3);
    // 神速① 标记已用
    expect(harness.state.players[0].vars['神速/opt1/usedThisTurn']).toBe(true);
    // 跳过摸牌标签存在
    expect(harness.state.players[0].tags).toContain('神速/跳过摸牌');
  });

  it('选项1:发动后摸牌阶段被跳过(不摸 2 张)', async () => {
    // deck 有牌,验证发动神速①后不摸牌
    const deck: Card[] = [];
    const cardMap: Record<string, Card> = {};
    for (let i = 0; i < 5; i++) {
      const id = `dk${i}`;
      const c = makeCard(id, '杀', '♠', String(i + 2));
      deck.push(c);
      cardMap[id] = c;
    }
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck: deck.map((c) => c.id), processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length;

    await triggerJudgePhase(harness);
    await P1.respond('神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    await P1.respond('神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // virtualKill 询问 P2 出闪 → P2 不闪
    const P2b = harness.player('P2');
    await P2b.pass();

    // 神速①已发动,P2 受伤。跳过摸牌标签已加
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].tags).toContain('神速/跳过摸牌');

    // 实际触发摸牌阶段:神速①的跳过摸牌 before-hook 命中标签 → 发动跳过。
    // 本 harness 的技能隔离测试不注册 回合管理(自动摸牌/阶段推进),故此处可验证的是
    // 跳过机制本身——skipPhase 命中标签后执行去标签(标签被消费);手牌不变为兼带不变式。
    // 另:隔离驱动 阶段开始(摸牌) 时 state.phase 未被推进到 '摸牌',与 applyView 增量
    // 视图的 phase 字段不可比(真实对局 state.phase 此刻已是 '摸牌'),故临时关闭视图
    // 一致性自动对比——这是 disableAutoCompare 的既定用途。
    const restoreCompare = disableAutoCompare();
    await triggerDrawPhase(harness);
    restoreCompare();
    // 跳过摸牌标签被消费(证明 skipPhase 在摸牌阶段开始时正确发动并清理标签)
    expect(harness.state.players[0].tags).not.toContain('神速/跳过摸牌');
    // P1 未摸牌(deck 中有 5 张牌,无牌入手)
    expect(harness.state.players[0].hand.length).toBe(handBefore);
  });

  it('负面(选项1):不发动 → 神速①未使用,无伤害', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    P1.expectPending('请求回应');

    await P1.respond('神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 不发动 → 无伤害,无跳过标签
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].vars['神速/opt1/usedThisTurn']).toBeUndefined();
    expect(harness.state.players[0].tags).not.toContain('神速/跳过摸牌');
  });

  it('选项2:有装备时发动 → 弃装备 + 目标受伤', async () => {
    const weapon: Card = {
      id: 'w1',
      name: '诸葛连弩',
      suit: '♣',
      color: '黑',
      rank: 'A',
      type: '装备牌',
      range: 1,
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [],
          skills: ['神速'],
          equipment: { '武器': 'w1' },
        }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPlayPhase(harness);
    // 询问是否发动神速②
    P1.expectPending('请求回应');

    await P1.respond('神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问弃哪张装备
    P1.expectPending('请求回应');
    await P1.respond('神速', { cardIds: ['w1'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问目标
    P1.expectPending('请求回应');
    await P1.respond('神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // virtualKill 询问 P2 出闪 → P2 不闪
    const P2c = harness.player('P2');
    await P2c.pass();

    // 装备已弃,P2 受伤
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].vars['神速/opt2/usedThisTurn']).toBe(true);
  });

  it('负面(选项2):无装备 → 不询问(直接进入出牌)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'], equipment: {} }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await triggerPlayPhase(harness);
    // 无装备 → 不询问神速②(无 pending 由神速创建)
    // 可能处于出牌窗口或其他 pending,但不应是 神速/opt2-trigger
    const slots = [...harness.state.pendingSlots.values()];
    const shensuSlot = slots.find((s) => {
      const rt = (s.atom as unknown as { requestType?: string }).requestType;
      return rt === '神速/opt2-trigger';
    });
    expect(shensuSlot).toBeUndefined();
    // P2 未受伤
    expect(harness.state.players[1].health).toBe(4);
  });

  // ── 选项3:跳过弃牌阶段 + 翻面 ──

  it('选项3:发动 → 选目标 → 目标受 1 点伤害 + 加翻面标签', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerDiscardPhase(harness);
    // 询问是否发动神速③
    P1.expectPending('请求回应');

    await P1.respond('神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问目标
    P1.expectPending('请求回应');
    await P1.respond('神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // virtualKill 会询问 P2 出闪 → P2 不闪
    const P2 = harness.player('P2');
    await P2.pass();

    // P2 受 1 点伤害(无闪可出)
    expect(harness.state.players[1].health).toBe(3);
    // 神速③ 标记已用
    expect(harness.state.players[0].vars['神速/opt3/usedThisTurn']).toBe(true);
    // 翻面标签存在(下一回合被消费)
    expect(harness.state.players[0].tags).toContain('神速/翻面');
  });

  it('负面(选项3):不发动 → 无伤害,无翻面标签', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['神速'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerDiscardPhase(harness);
    P1.expectPending('请求回应');

    await P1.respond('神速', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 不发动 → 无伤害,无翻面标签
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].vars['神速/opt3/usedThisTurn']).toBeUndefined();
    expect(harness.state.players[0].tags).not.toContain('神速/翻面');
  });

  it('翻面:下一回合准备阶段 → 翻面标签消费 + cPI 推进到下家', async () => {
    // 预设翻面标签(模拟上一回合已发动神速③)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['dk0', 'dk1'],
          skills: ['神速'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 2, phase: '准备', vars: {} },
    });
    // 预设翻面标签
    state.players[0].tags = ['神速/翻面'];
    await harness.setup(state);

    const handBefore = harness.state.players[0].hand.length;

    // 模拟回合启动序列:回合开始 → 阶段开始(准备) → 阶段结束(准备)
    // 神速翻面 hook 在 阶段开始(准备) cancel + 设 skipAll;
    // 阶段结束(准备) before-hook 检测 skipAll → 主动推进回合(下一玩家 + 回合结束)
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '准备' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 翻面标签已被消费
    expect(harness.state.players[0].tags).not.toContain('神速/翻面');
    // cPI 已推进到下家(跳过自己回合)
    expect(harness.state.currentPlayerIndex).toBe(1);
    // P1 未摸牌(整回合被跳过)
    expect(harness.state.players[0].hand.length).toBe(handBefore);
  });

  // ── Phase 4 回归:神速虚拟杀统一 useCard(charge,virtual),计入出杀次数 ──
  it('神速①虚拟杀计入出杀次数(charge)→ 再出真杀被拒(出杀次数达上限)', async () => {
    const realSlash = makeCard('rs1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rs1'], skills: ['神速'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [], character: '曹操' }),
      ],
      cardMap: { rs1: realSlash },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerJudgePhase(harness);
    // 发动神速①
    await P1.respond('神速', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    // 选目标 P2
    await P1.respond('神速', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // virtualKill 询问 P2 出闪 → P2 不闪
    const P2 = harness.player('P2');
    await P2.pass();

    // 神速①虚拟杀生效:P2 受 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
    // 关键:charge 生效 → 出杀次数已用 1(达基础上限 1)
    expect(slashUsed(harness.state)).toBe(1);

    // 出牌阶段再用真杀 → play 模式校验(checkUsageLimit)→ 次数上限拒绝
    const err = validateCardUse(harness.state, 0, { cardId: 'rs1', targets: [1] }, '杀', 'play');
    expect(typeof err).toBe('string'); // 被拒(null=通过,string=拒绝理由)
    // P2 未再受伤,真杀仍在 P1 手中,出杀次数未因被拒而增加
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].hand).toContain('rs1');
    expect(slashUsed(harness.state)).toBe(1);
  });
});