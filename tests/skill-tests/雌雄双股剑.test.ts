// tests/skill-tests/雌雄双股剑.test.ts
// 雌雄双股剑(武器,攻击范围 2):
//   你使用【杀】指定一名异性角色为目标后、杀结算前,你可以令其选择一项:
//   弃置一张手牌,或令你(使用者)摸一张牌。需性别校验(异性)。
//
// 本文件为代码审查 TDD 新增(原引擎无此技能测试)。
// 参考 tests/skill-tests/贯石斧.test.ts 的写法与辅助函数。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
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
  equipment?: Record<string, string>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['杀', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

const CI = makeCard('ci', '雌雄双股剑', '♠', '2', '装备牌');

describe('雌雄双股剑', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 用例1:异性目标 → 发动 → target 选择弃1手牌 ─────────────

  it('用例1:P1(男)杀 P2(女),发动后 P2 选择弃1手牌 → P2 弃1张,P1 不摸牌', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const xa = makeCard('xa', '桃', '♥', '3');
    const xb = makeCard('xb', '桃', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '刘备',
          hand: ['k1'],
          skills: ['杀', '雌雄双股剑'],
          equipment: { 武器: 'ci' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '貂蝉',
          hand: ['xa', 'xb'],
          skills: ['闪'],
        }),
      ],
      cardMap: { ci: CI, k1: kill, xa, xb },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀指定 P2
    await P1.useCardAndTarget('杀', 'k1', [1]);
    // owner confirm 发动
    await P1.respond('雌雄双股剑', { choice: true });
    // target 选择弃一张手牌
    await P2.respond('雌雄双股剑', { cardId: 'xa' });

    // P2 弃了 xa,只剩 xb
    expect(harness.state.players[1].hand).toEqual(['xb']);
    expect(harness.state.zones.discardPile).toContain('xa');
    // P1 未摸牌(出杀后手牌为空)
    expect(harness.state.players[0].hand).toHaveLength(0);

    // 收尾:杀继续结算 → 询问闪,P2 无闪 → pass → 扣血
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 用例2:异性目标 → 发动 → target 选择让对方摸牌(pass) ───

  it('用例2:target 放弃弃牌(pass) → owner 摸1张,target 不弃', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const xa = makeCard('xa', '桃', '♥', '3');
    const top = makeCard('top', '桃', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '刘备',
          hand: ['k1'],
          skills: ['杀', '雌雄双股剑'],
          equipment: { 武器: 'ci' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '貂蝉',
          hand: ['xa'],
          skills: ['闪'],
        }),
      ],
      cardMap: { ci: CI, k1: kill, xa, top },
      zones: { deck: ['top'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P1.respond('雌雄双股剑', { choice: true });
    // target pass(选择让对方摸牌)
    await P2.pass();

    // P1 摸了 top
    expect(harness.state.players[0].hand).toEqual(['top']);
    // P2 未弃牌
    expect(harness.state.players[1].hand).toEqual(['xa']);

    // 收尾:杀继续 → P2 无闪 pass → 扣血
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 用例3:同性目标 → 不触发 ─────────────────────────────

  it('用例3:P1(男)杀 P2(男)同性 → 不触发雌雄双股剑(直接进询问闪)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const xa = makeCard('xa', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '刘备',
          hand: ['k1'],
          skills: ['杀', '雌雄双股剑'],
          equipment: { 武器: 'ci' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '关羽',
          hand: ['xa'],
          skills: ['闪'],
        }),
      ],
      cardMap: { ci: CI, k1: kill, xa },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // 同性:无 confirm pending(P1 无 pending),直接进询问闪(P2 pending)
    expect(harness.state.pendingSlots.get(0)).toBeUndefined();
    expect(harness.state.pendingSlots.get(1)).toBeDefined();
    // P1 未摸牌,P2 未弃牌
    expect(harness.state.players[0].hand).toHaveLength(0);
    expect(harness.state.players[1].hand).toEqual(['xa']);
  });

  // ─── 用例4:owner 不发动 → 无效果 ──────────────────────────

  it('用例4:owner 放弃发动 → 无弃牌无摸牌', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const xa = makeCard('xa', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '刘备',
          hand: ['k1'],
          skills: ['杀', '雌雄双股剑'],
          equipment: { 武器: 'ci' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '貂蝉',
          hand: ['xa'],
          skills: ['闪'],
        }),
      ],
      cardMap: { ci: CI, k1: kill, xa },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const _P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // owner 放弃发动(confirm 超时)
    await P1.pass();

    // 无效果:P1 未摸牌(空),P2 未弃牌
    expect(harness.state.players[0].hand).toHaveLength(0);
    expect(harness.state.players[1].hand).toEqual(['xa']);
    // 进入询问闪
    expect(harness.state.pendingSlots.get(1)).toBeDefined();
  });

  // ─── 用例5:异性 target 无手牌 → owner 直接摸1(跳过选择) ──

  it('用例5:target 无手牌 → owner 直接摸1张(跳过选择)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const top = makeCard('top', '桃', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '刘备',
          hand: ['k1'],
          skills: ['杀', '雌雄双股剑'],
          equipment: { 武器: 'ci' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '貂蝉',
          hand: [],
          skills: ['闪'],
        }),
      ],
      cardMap: { ci: CI, k1: kill, top },
      zones: { deck: ['top'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P1.respond('雌雄双股剑', { choice: true });
    // target 无手牌 → owner 直接摸1(跳过 target 选择步骤,无 choice pending)
    expect(harness.state.players[0].hand).toEqual(['top']);
    // 无手牌者无法出闪:询问闪被 preResolve 跳过 → 杀直接命中
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 用例6:choice 阶段提交非手牌 cardId → 拒绝 ─────────────

  it('用例6:choice 阶段提交非手牌 cardId → 拒绝', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const xa = makeCard('xa', '桃', '♥', '3');
    const fake = makeCard('fk', '桃', '♦', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '刘备',
          hand: ['k1'],
          skills: ['杀', '雌雄双股剑'],
          equipment: { 武器: 'ci' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '貂蝉',
          hand: ['xa'],
          skills: ['闪'],
        }),
      ],
      cardMap: { ci: CI, k1: kill, xa, fk: fake },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P1.respond('雌雄双股剑', { choice: true });
    // 提交不在手牌的 cardId → 拒绝
    await P2.expectRejected({
      skillId: '雌雄双股剑',
      actionType: 'respond',
      params: { cardId: 'fk' },
    });
    // 补正常提交
    await P2.respond('雌雄双股剑', { cardId: 'xa' });
    expect(harness.state.players[1].hand).toHaveLength(0);
  });

  // ─── 用例7:被换装/无武器 → 不触发(动态装备校核) ─────────

  it('用例7:owner 武器槽非雌雄双股剑 → 不触发', async () => {
    const other = makeCard('ot', '寒冰剑', '♠', '2', '装备牌');
    const kill = makeCard('k1', '杀', '♠', '7');
    const xa = makeCard('xa', '桃', '♥', '3');
    const top = makeCard('top', '桃', '♣', '5');
    const state: GameState = createGameState({
      players: [
        // 技能列表仍含 雌雄双股剑,但武器槽是另一把武器(模拟同帧换装/技能残留)
        makePlayer({
          index: 0,
          name: 'P1',
          character: '刘备',
          hand: ['k1'],
          skills: ['杀', '雌雄双股剑'],
          equipment: { 武器: 'ot' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '貂蝉',
          hand: ['xa'],
          skills: ['闪'],
        }),
      ],
      cardMap: { ci: CI, ot: other, k1: kill, xa, top },
      zones: { deck: ['top'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // 武器非雌雄双股剑 → 不触发 confirm(直接进询问闪)
    expect(harness.state.pendingSlots.get(0)).toBeUndefined();
    expect(harness.state.pendingSlots.get(1)).toBeDefined();
    expect(harness.state.players[0].hand).toHaveLength(0);
  });
});
