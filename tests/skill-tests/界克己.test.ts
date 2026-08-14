// tests/skill-tests/界克己.test.ts
// 界克己(界吕蒙·吴国·界限突破)技能测试:
//   OL 官方(hero/306):"若你未于本回合出牌阶段使用或打出过【杀】,你可以跳过弃牌阶段。"
//
// 与标克己核心差异:界版严格限定「出牌阶段内」出杀才计数。
//
// 验证:
//   1. 正面:未出杀 → 发动界克己 → 跳过弃牌阶段,手牌保留
//   2. 负面:出牌阶段出过杀 → 不满足条件,进入正常弃牌阶段
//   3. 边界:未出杀但选择不发动 → 进入正常弃牌阶段
//   4. 边界:超时不回应(defaultChoice=false)→ 进入正常弃牌阶段
//   5. 界版独有差异:出牌阶段外打出杀(白盒模拟)→ 不写入 playedSlash,不阻止克己
//      (标版会在非出牌阶段也写入并阻止;界版按官方"出牌阶段内"判定)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

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
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界吕蒙',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界克己', '回合管理'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 取当前唯一 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return null;
  return (slots[0].atom as unknown as { requestType?: string }).requestType ?? null;
}

describe('界克己', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:未出杀 → 发动界克己 → 跳过弃牌阶段 ─────────────────

  it('未出杀 → 发动界克己确认 → 跳过弃牌阶段,手牌全保留', async () => {
    // P0(界吕蒙):HP=2,手牌 5 张(均非杀)→ 正常应弃 3 张
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3', 'c4', 'c5'],
          health: 2,
          maxHealth: 2,
          skills: ['界克己', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '过河拆桥', '♠', '3', '锦囊牌'),
        c4: makeCard('c4', '闪', '♦', '4'),
        c5: makeCard('c5', '桃', '♦', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    expect(harness.state.players[0].hand.length).toBe(5);

    // 结束出牌阶段 → 进入弃牌阶段前触发界克己询问
    await P1.triggerAction('回合管理', 'end', {});

    // 应出现界克己确认 pending(而非 __弃牌)
    expect(currentRequestType(harness.state)).toBe('界克己/confirm');

    // 确认发动界克己
    await P1.respond('界克己', { choice: true });

    // 弃牌阶段被跳过:无 __弃牌 pending;手牌全保留;回合推进到下家
    expect(harness.state.players[0].hand.length).toBe(5);
    expect(currentRequestType(harness.state)).not.toBe('__弃牌');
  });

  // ─── 负面:出牌阶段出过杀 → 不满足条件 ───────────────────────

  it('出牌阶段出过杀 → 界克己不触发,进入正常弃牌阶段', async () => {
    // P0(界吕蒙):HP=2,手牌 5 张(含 1 张杀)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3', 'c4', 'c5'],
          health: 2,
          maxHealth: 2,
          skills: ['界克己', '回合管理', '杀'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '1'),
        c2: makeCard('c2', '闪', '♥', '2'),
        c3: makeCard('c3', '桃', '♥', '3'),
        c4: makeCard('c4', '闪', '♦', '4'),
        c5: makeCard('c5', '桃', '♦', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0 对 P2 出杀(在出牌阶段)
    await P1.useCardAndTarget('杀', 'c1', [1]);
    // P2 不出闪 → 受 1 点伤害
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    // 杀已消耗,手牌 4 张
    expect(harness.state.players[0].hand.length).toBe(4);

    // 结束出牌阶段 → 进入弃牌阶段
    await P1.triggerAction('回合管理', 'end', {});

    // 界克己不应触发(出牌阶段出过杀):应直接进入 __弃牌,而非 界克己/confirm
    expect(currentRequestType(harness.state)).toBe('__弃牌');
    expect(currentRequestType(harness.state)).not.toBe('界克己/confirm');

    // 弃 2 张(4 - HP2 = 2)
    await P1.respond('系统规则', { cardIds: ['c2', 'c3'] });
    expect(harness.state.players[0].hand.length).toBe(2);
  });

  // ─── 边界:未出杀但选择不发动 ──────────────────────────────

  it('未出杀但选择不发动界克己 → 进入正常弃牌阶段', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3', 'c4', 'c5'],
          health: 2,
          maxHealth: 2,
          skills: ['界克己', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '过河拆桥', '♠', '3', '锦囊牌'),
        c4: makeCard('c4', '闪', '♦', '4'),
        c5: makeCard('c5', '桃', '♦', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).toBe('界克己/confirm');

    // 选择不发动(choice=false)
    await P1.respond('界克己', { choice: false });

    // 进入正常弃牌阶段
    expect(currentRequestType(harness.state)).toBe('__弃牌');

    // 弃 3 张(5 - HP2 = 3)
    await P1.respond('系统规则', { cardIds: ['c1', 'c2', 'c3'] });
    expect(harness.state.players[0].hand.length).toBe(2);
  });

  // ─── 边界:超时不回应 → 等同不发动 ─────────────────────────

  it('未出杀但超时不回应 → 进入正常弃牌阶段', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3', 'c4', 'c5'],
          health: 2,
          maxHealth: 2,
          skills: ['界克己', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '闪', '♥', '1'),
        c2: makeCard('c2', '桃', '♥', '2'),
        c3: makeCard('c3', '过河拆桥', '♠', '3', '锦囊牌'),
        c4: makeCard('c4', '闪', '♦', '4'),
        c5: makeCard('c5', '桃', '♦', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('回合管理', 'end', {});
    expect(currentRequestType(harness.state)).toBe('界克己/confirm');

    // 超时(pass = fireTimeout)→ defaultChoice=false → 不发动
    await P1.pass();

    // 进入正常弃牌阶段
    expect(currentRequestType(harness.state)).toBe('__弃牌');
  });

  // ─── 界版独有差异:出牌阶段外打出杀不计入 ─────────────────
  //
  // 官方原文:"若你未于本回合【出牌阶段】使用或打出过【杀】,你可以跳过弃牌阶段。"
  // 标版克己把"本回合"当作整回合任一阶段出杀即计数;界版严格按"出牌阶段内"判定。
  // 本测试白盒模拟「在非出牌阶段打出杀」:直接 applyAtom 一个 移动牌(杀:手牌→处理区),
  // 验证界版 after hook 只在「出牌」阶段写入 vars,非出牌阶段不误判。
  it('出牌阶段外打出杀不计入 → 不写入 playedSlash(界版差异)', async () => {
    // 白盒验证 移动牌 after hook 的阶段守卫:phase !== '出牌' 时,杀从手牌移入处理区
    // 不写 turn.vars['界克己/playedSlash']。这是界克己仍可发动的必要前提
    // (标版缺少阶段守卫,会在非出牌阶段也写入并阻止克己)。
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3'],
          health: 2,
          maxHealth: 2,
          skills: ['界克己', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠', '1'),
        c2: makeCard('c2', '闪', '♥', '2'),
        c3: makeCard('c3', '桃', '♥', '3'),
      },
      currentPlayerIndex: 0,
      // 关键:当前阶段为「弃牌」(非出牌),此时若发生「杀」的移动牌,界版 hook 不应记录。
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);

    // 手动模拟"在非出牌阶段把杀从手牌移入处理区"(例如响应延时锦囊判定的决斗)。
    // 标版会写 vars['克己/playedSlash']=true;界版因 phase!=='出牌' 跳过,不写入。
    const { applyAtom } = await import('../../src/engine/core/apply');
    // 先用一个不会真正结算伤害的方式触发移动牌:直接构造 移动牌 atom
    // 注意:杀从 P1 手牌(c1)移到处理区
    await applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'c1',
      from: { zone: '手牌', player: 0 },
      to: { zone: '处理区' },
    });

    // 界版因 phase!=='出牌',不应记录 playedSlash → vars 中无 界克己/playedSlash=true
    expect(harness.state.turn.vars['界克己/playedSlash']).not.toBe(true);
  });
});
