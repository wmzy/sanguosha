// 铁索连环(普通锦囊)行为测试:
//   重点验证【use】横置/重置、【recast】重铸、【传导】属性伤害。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import { DEFAULT_SKILLS } from '../../src/engine/atoms/选将';
import { runDamageFlow } from '../../src/engine/flows/damage';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  damageType?: '火焰' | '雷电',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  const card: Card = { id, name, suit, color, rank, type };
  if (damageType) card.damageType = damageType;
  return card;
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  marks?: Array<{ id: string; scope: number }>;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: opts.marks ?? [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('铁索连环', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── use:横置/重置 ─────────────────────────────

  it('use:横置两名角色', async () => {
    const chain = mkCard('chain1', '铁索连环', '♣', '3', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chain1'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
        ],
        cardMap: { chain1: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.triggerAction('铁索连环', 'use', { cardId: 'chain1', targets: [1, 2] });
    // 无懈可击:逐目标 pass(超时 = 无人打无懈) → 目标各自选择横置
    await P0.pass(); // 无懈 target 1
    await harness.player('P1').respond('铁索连环', { option: '横置' });
    await P0.pass(); // 无懈 target 2
    await harness.player('P2').respond('铁索连环', { option: '横置' });

    // P1 和 P2 都被横置
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(true);
    // 铁索连环进弃牌堆
    expect(harness.state.zones.discardPile).toContain('chain1');
  });

  it('use:目标选择重置解除横置', async () => {
    const chain = mkCard('chain2', '铁索连环', '♠', '5', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chain2'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', health: 3, marks: [{ id: 'chained', scope: 1 }], skills: [] }),
        ],
        cardMap: { chain2: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // 确认 P1 初始已横置
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);

    await P0.triggerAction('铁索连环', 'use', { cardId: 'chain2', targets: [1] });
    await P0.pass(); // 无懈可击 pass
    // 目标选择重置（而非强制 toggle）
    await harness.player('P1').respond('铁索连环', { option: '重置' });

    // P1 被重置(不再横置)
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(false);
  });

  // ─── use:目标可选维持现状（规则：已横置可选横置、未横置可选重置）───
  // bug 核心回归:旧实现强制 toggle,目标无法维持现状。修复后目标可显式选择与当前状态
  // 相同的选项(已横置选横置仍横置、未横置选重置仍不横置)。
  it('use:已横置目标选横置 → 维持横置(不强制翻转)', async () => {
    const chain = mkCard('chainKeep', '铁索连环', '♣', '3', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainKeep'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', marks: [{ id: 'chained', scope: 1 }], skills: [] }),
        ],
        cardMap: { chainKeep: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);

    await P0.triggerAction('铁索连环', 'use', { cardId: 'chainKeep', targets: [1] });
    await P0.pass(); // 无懈可击 pass
    // 已横置目标选「横置」→ 维持横置(旧 toggle 实现会错误地重置)
    await harness.player('P1').respond('铁索连环', { option: '横置' });

    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
  });

  it('use:超时未选择 → 维持现状', async () => {
    const chain = mkCard('chainTimeout', '铁索连环', '♠', '5', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainTimeout'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', marks: [{ id: 'chained', scope: 1 }], skills: [] }),
        ],
        cardMap: { chainTimeout: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);

    await P0.triggerAction('铁索连环', 'use', { cardId: 'chainTimeout', targets: [1] });
    await P0.pass(); // 无懈可击 pass
    // 目标超时不选择 → 维持现状(仍横置)
    await harness.player('P1').pass();

    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
  });

  // ─── use:混合目标(一个横置 + 一个重置)───
  // 每个目标各自独立选择横置/重置。
  it('use:混合目标[未横置A, 已横置B] → A选横置, B选重置', async () => {
    const chain = mkCard('chainMix', '铁索连环', '♣', '3', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainMix'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', marks: [{ id: 'chained', scope: 2 }] }),
        ],
        cardMap: { chainMix: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // P1 未横置, P2 已横置
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(false);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(true);

    await P0.triggerAction('铁索连环', 'use', { cardId: 'chainMix', targets: [1, 2] });
    await P0.pass(); // 无懈 target 1
    await harness.player('P1').respond('铁索连环', { option: '横置' });
    await P0.pass(); // 无懈 target 2
    await harness.player('P2').respond('铁索连环', { option: '重置' });

    // P1 被横置, P2 被重置(各自独立选择)
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(false);
  });

  it('use:目标数不合法拒绝', async () => {
    const chain = mkCard('chain3', '铁索连环', '♣', 'K', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chain3'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
        ],
        cardMap: { chain3: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // 无目标
    await P0.expectRejected({ skillId: '铁索连环', actionType: 'use', params: { cardId: 'chain3', targets: [] } });
    // 3 个目标(上限 2)
    await P0.expectRejected({ skillId: '铁索连环', actionType: 'use', params: { cardId: 'chain3', targets: [1, 2, 0] } });
  });

  // ─── use:可选自己为目标 ─────────────────────────
  // bug:铁索连环原 target.kind='other',校验拒绝以自己为目标。
  // 官方「一至两名角色」含自己。改为 kind='any' + allowSelf 后应允许。

  it('use:可以以自己为目标横置', async () => {
    const chain = mkCard('chainSelf', '铁索连环', '♣', '3', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainSelf'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: { chainSelf: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // 以自己为目标
    await P0.triggerAction('铁索连环', 'use', { cardId: 'chainSelf', targets: [0] });
    await P0.pass(); // 无懈可击 pass
    // 自己作为目标选择横置
    await P0.respond('铁索连环', { option: '横置' });

    // 自己被横置
    expect(harness.state.players[0].marks.some((m) => m.id === 'chained')).toBe(true);
  });

  it('use:可以同时横置自己与另一名角色', async () => {
    const chain = mkCard('chainSelf2', '铁索连环', '♠', 'Q', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainSelf2'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: { chainSelf2: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.triggerAction('铁索连环', 'use', { cardId: 'chainSelf2', targets: [0, 1] });
    await P0.pass(); // 无懈对 P0
    await P0.respond('铁索连环', { option: '横置' }); // 自己作为目标选横置
    await P0.pass(); // 无懈对 P1
    await harness.player('P1').respond('铁索连环', { option: '横置' });

    expect(harness.state.players[0].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
  });

  // ─── recast:重铸 ─────────────────────────────

  it('recast:弃此牌摸一张', async () => {
    const chain = mkCard('chainR', '铁索连环', '♦', '7', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainR'], skills: ['铁索连环'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: { chainR: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');
    const deckBefore = harness.state.zones.deck.length;
    expect(harness.state.players[0].hand).toContain('chainR');

    await P0.triggerAction('铁索连环', 'recast', { cardId: 'chainR' });

    // 牌进弃牌堆
    expect(harness.state.players[0].hand).not.toContain('chainR');
    expect(harness.state.zones.discardPile).toContain('chainR');
    // 摸一张:手牌数 1(原 1 弃 0 摸 1)
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.zones.deck.length).toBe(deckBefore - 1);
  });

  // ─── 回归:f7536790 把铁索连环从 DEFAULT_SKILLS 移除后,真实选将路径
  //     (skills=DEFAULT_SKILLS,不手动注入 '铁索连环') 不再实例化铁索连环技能 →
  //     recast action 未注册 → 出牌阶段无法重铸。此用例不手动注入,仅靠 DEFAULT_SKILLS。
  it('recast:经 DEFAULT_SKILLS 实例化(真实选将路径)后仍可重铸', async () => {
    const chain = mkCard('chainD', '铁索连环', '♦', '7', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainD'], skills: [...DEFAULT_SKILLS] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [...DEFAULT_SKILLS] }),
        ],
        cardMap: { chainD: chain },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.triggerAction('铁索连环', 'recast', { cardId: 'chainD' });

    expect(harness.state.players[0].hand).not.toContain('chainD');
    expect(harness.state.zones.discardPile).toContain('chainD');
  });

  // ─── 连环传导 ─────────────────────────────

  /** 辅助:设 P1+P2 横置后,用指定杀攻击 P1,验证传导行为 */
  async function useConductionTest(
    slashCard: Card,
    expectConduction: boolean,
  ): Promise<void> {
    const chain = mkCard('chainC', '铁索连环', '♠', '4', '锦囊牌');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainC', slashCard.id], skills: ['铁索连环', '杀'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', health: 3, maxHealth: 3, skills: ['闪'] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', health: 3, maxHealth: 3, skills: [] }),
        ],
        cardMap: { chainC: chain, [slashCard.id]: slashCard },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // Step 1: 铁索连环横置 P1 P2
    await P0.triggerAction('铁索连环', 'use', { cardId: 'chainC', targets: [1, 2] });
    await P0.pass(); // 无懈可击 pass (目标1)
    await harness.player('P1').respond('铁索连环', { option: '横置' });
    await P0.pass(); // 无懈可击 pass (目标2)
    await harness.player('P2').respond('铁索连环', { option: '横置' });

    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(true);

    const p1HealthBefore = harness.state.players[1].health;
    const p2HealthBefore = harness.state.players[2].health;

    // Step 2: 杀 P1
    await P0.useCardAndTarget('杀', slashCard.id, [1]); // eslint-disable-line react-hooks/rules-of-hooks -- 测试 harness 方法非 React Hook
    // P1 不出闪
    await P1.pass();

    if (expectConduction) {
      // P1 受到 1 点属性伤害
      expect(harness.state.players[1].health).toBe(p1HealthBefore - 1);
      // P2 受到传导伤害 1 点
      expect(harness.state.players[2].health).toBe(p2HealthBefore - 1);
      // 所有横置角色被重置
      expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(false);
      expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(false);
    } else {
      // 普通伤害:只有 P1 掉血
      expect(harness.state.players[1].health).toBe(p1HealthBefore - 1);
      expect(harness.state.players[2].health).toBe(p2HealthBefore);
      // 普通伤害不触发传导 hook → 连环状态不被重置(P1/P2 仍横置)
      expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
      expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(true);
    }
  }

  it('火焰伤害传导给所有横置角色', async () => {
    const fireSlash = mkCard('fire1', '杀', '♥', 'A', '基本牌', '火焰');
    await useConductionTest(fireSlash, true);
  });

  it('雷电伤害传导', async () => {
    const lightningSlash = mkCard('light1', '杀', '♠', '5', '基本牌', '雷电');
    await useConductionTest(lightningSlash, true);
  });

  it('普通伤害不传导', async () => {
    const normalSlash = mkCard('plain1', '杀', '♠', '3', '基本牌');
    await useConductionTest(normalSlash, false);
  });

  it('未横置不传导', async () => {
    const chain = mkCard('chainU', '铁索连环', '♣', '8', '锦囊牌');
    // 预设 P1 横置, P2 不横置
    const fireSlash = mkCard('fireU', '杀', '♥', '2', '基本牌', '火焰');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: ['chainU', fireSlash.id], skills: ['铁索连环', '杀'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', health: 3, maxHealth: 3, marks: [{ id: 'chained', scope: 1 }], skills: ['闪'] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', health: 3, maxHealth: 3, skills: [] }),
        ],
        cardMap: { chainU: chain, [fireSlash.id]: fireSlash },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 确认只有 P1 横置
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(false);

    const p2HealthBefore = harness.state.players[2].health;

    // 火杀 P1
    await P0.useCardAndTarget('杀', fireSlash.id, [1]);
    await P1.pass();

    // P1 掉血, P2 不掉血(未横置)
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.players[2].health).toBe(p2HealthBefore);
    // P1 被重置(传导到 0 个其他角色后仍重置)
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(false);
  });

  // ─── 回归(传导架构解耦):传导 hook 现作为伤害结算基础设施由
  //     bootstrap/registerSkillsFromState 注册,不再依赖铁索连环技能实例化。
  //     即便没有玩家持有「铁索连环」技能,只要角色处于连环状态,属性伤害仍传导。
  //     验证 setChain/武将技能直接置入连环状态也受传导管辖。
  it('传导不依赖铁索连环技能实例化:无人持该技能,横置状态仍联动属性伤害', async () => {
    const fireSlash = mkCard('fireD', '杀', '♥', '2', '基本牌', '火焰');
    // 仅使用牌/打出牌(注册杀 use),不含「铁索连环」→ 传导只能来自基础设施注册的 hook
    const noChain = ['使用牌', '打出牌'];
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', hand: [fireSlash.id], skills: [...noChain] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', health: 3, maxHealth: 3, marks: [{ id: 'chained', scope: 1 }], skills: [...noChain] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', health: 3, maxHealth: 3, marks: [{ id: 'chained', scope: 2 }], skills: [...noChain] }),
        ],
        cardMap: { fireD: fireSlash },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 无玩家持有「铁索连环」技能 → 传导只能来自基础设施注册的 hook
    expect(harness.state.players.every((p) => !p.skills.includes('铁索连环'))).toBe(true);

    await P0.useCardAndTarget('杀', fireSlash.id, [1]);
    await P1.pass();

    // P1 受火焰伤害 → 传导给横置的 P2
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.players[2].health).toBe(2);
    // 传导后重置
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(false);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(false);
  });

  // ─── 回归:0 点属性伤害不传导、不重置连环 ───
  // bug:连环传导 hook 未校验 amount>0,0 点属性伤害(amount 经减伤折叠为0)
  //     仍传导并重置连环状态。修复:face-down.ts 增加 amount<=0 守卫。
  it('0 点属性伤害不传导、不重置连环状态', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', character: '主公', skills: ['使用牌', '打出牌'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', health: 3, maxHealth: 3, marks: [{ id: 'chained', scope: 1 }], skills: ['使用牌', '打出牌'] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', health: 3, maxHealth: 3, marks: [{ id: 'chained', scope: 2 }], skills: ['使用牌', '打出牌'] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    const p1Before = harness.state.players[1].health;
    const p2Before = harness.state.players[2].health;

    // 直接造成 0 点火焰伤害(P1 已横置)
    await runDamageFlow(harness.state, 0, 1, 0, undefined, '火焰');
    await harness.waitForStable();

    // 0 点伤害:无人掉血
    expect(harness.state.players[1].health).toBe(p1Before);
    expect(harness.state.players[2].health).toBe(p2Before);
    // 0 点属性伤害不传导 → 连环状态不被重置(P1/P2 仍横置)
    expect(harness.state.players[1].marks.some((m) => m.id === 'chained')).toBe(true);
    expect(harness.state.players[2].marks.some((m) => m.id === 'chained')).toBe(true);
  });
});