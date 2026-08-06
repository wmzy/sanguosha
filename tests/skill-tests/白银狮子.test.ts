// 白银狮子(防具·锁定技):当你受到大于 1 点的伤害时,伤害改为 1 点;
//   当你失去装备区里的白银狮子后,回复 1 点体力。
//
// 实现(白银狮子.ts):
//   - before hook 挂「受到伤害时」:target=自己 + amount>1 + 仍装备白银狮子 → modify amount=1
//   - 失去装备回血:监听白银狮子离开装备区的四条路径
//       1. 卸下(直接卸下/孤立卸下)        3. 获得(顺手牵羊/反馈)
//       2. 弃置(过河拆桥/寒冰剑/麒麟弓)   4. 移除技能(装备通用替换:换装先卸技能再卸下)
//     before-hook 记录 loseKey,after-hook 据此回复 1 体力(各路径互斥,无重复回血)。
//
// 验证:
//   1. 正面:受到 2 点伤害 → 减为 1(减伤生效)
//   2. 边界:受到 1 点伤害 → 不变(amount<=1 不触发减伤)
//   3. 回血(卸下):卸下白银狮子 → 回复 1 点体力
//   4. 回血(负面):卸下其他防具 → 不回血
//   5. 回血(弃置路径):过河拆桥弃置 → 回 1 血
//   6. 回血(获得路径):顺手牵羊顺走 → 回 1 血
//   7. 回血(替换路径):装备新防具替换 → 回 1 血
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/index';
import { runDamageFlow } from '../../src/engine/damage-flow';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  equipment?: Record<string, string>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: 4,
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

// 白银狮子牌(防具)
const BAIYIN: Card = {
  id: 'by',
  name: '白银狮子',
  suit: '♣',
  color: suitColor('♣'),
  rank: '2',
  type: '装备牌',
  subtype: '防具',
};

describe('白银狮子', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:2 点伤害减为 1 ─────────────────────────────────

  it('正面:受到 2 点伤害 → 减为 1 点(只扣 1 血)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子'],
          equipment: { 防具: 'by' },
        }),
      ],
      cardMap: { by: BAIYIN },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接造成 2 点伤害 → 白银狮子 before hook 减为 1
    await runDamageFlow(harness.state, 0, 1, 2);
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].alive).toBe(true);
  });

  // ─── 边界:1 点伤害不减(amount<=1 不触发)─────────────────

  it('边界:受到 1 点伤害 → 不变(扣 1 血,不超额减伤)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子'],
          equipment: { 防具: 'by' },
        }),
      ],
      cardMap: { by: BAIYIN },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await runDamageFlow(harness.state, 0, 1, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    // amount=1 <=1 → hook 不触发,正常扣 1 血
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 回血:卸下白银狮子 ──────────────────────────────────

  it('回血:卸下白银狮子 → 回复 1 点体力', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子'],
          health: 2,
          equipment: { 防具: 'by' },
        }),
      ],
      cardMap: { by: BAIYIN },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    expect(harness.state.players[1].health).toBe(2);

    // 卸下防具:before-hook 记录为白银狮子 → after-hook 回复 1 体力
    await applyAtom(harness.state, { type: '卸下', player: 1, slot: '防具' });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(3);
    // 装备已卸下(移回手牌)
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
    expect(harness.state.players[1].hand).toContain('by');
  });

  // ─── 回血(负面):卸下非白银狮子防具 → 不回血 ───────────────
  //   before hook 以 cardMap[id].name === '白银狮子' 为门禁,卸下其他防具不记录
  //   loseKey → after hook 不回血。补充此负面路径以防门禁被误删后任意卸装都回血。

  it('回血(负面):卸下其他防具(非白银狮子) → 不回复体力', async () => {
    const OTHER_ARMOR: Card = { ...BAIYIN, id: 'tj', name: '藤甲' };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子'],
          health: 2,
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: OTHER_ARMOR },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    expect(harness.state.players[1].health).toBe(2);

    // 卸下的是藤甲(非白银狮子)→ before hook 不记录 loseKey → after hook 不回血
    await applyAtom(harness.state, { type: '卸下', player: 1, slot: '防具' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 体力不变(未回血)
    expect(harness.state.players[1].health).toBe(2);
    // 装备已卸下(移回手牌)
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
    expect(harness.state.players[1].hand).toContain('tj');
  });

  // ─── 回血(弃置路径):过河拆桥/寒冰剑/麒麟弓/制衡 ──────────
  //   这些技能用 弃置 atom 直接把装备弃入弃牌堆(不经 卸下),
  //   白银狮子应据此回血(标准规则:失去装备区里的白银狮子后回 1 血)。

  it('回血(弃置路径):过河拆桥弃置白银狮子 → 回复1点体力', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子'],
          health: 2,
          equipment: { 防具: 'by' },
        }),
      ],
      cardMap: { by: BAIYIN },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    expect(harness.state.players[1].health).toBe(2);

    // 过河拆桥/寒冰剑等用 弃置 atom 直接把装备弃入弃牌堆
    await applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['by'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 失去装备区里的白银狮子 → 回 1 血
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('by');
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
  });

  // ─── 回血(获得路径):顺手牵羊/反馈 ──────────────────────
  //   顺手牵羊/反馈用 获得 atom 从装备区顺走装备(不经 卸下),
  //   白银狮子应据此回血。

  it('回血(获得路径):顺手牵羊顺走白银狮子 → 回复1点体力', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子'],
          health: 2,
          equipment: { 防具: 'by' },
        }),
      ],
      cardMap: { by: BAIYIN },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    expect(harness.state.players[1].health).toBe(2);

    // 顺手牵羊/反馈用 获得 atom 从 P2 装备区获得白银狮子
    await applyAtom(harness.state, { type: '获得', player: 0, cardId: 'by', from: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // P2 失去装备区里的白银狮子 → 回 1 血
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].hand).toContain('by');
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
  });

  // ─── 回血(替换路径):装备通用换装 ──────────────────────
  //   装备通用替换流程:先 移除技能(旧装备) 再 卸下(旧装备回手) 再 移动牌入弃牌堆。
  //   移除技能 会先于 卸下 卸载白银狮子的 hook,故仅挂 卸下 时回血不会触发。
  //   标准规则:替换装备 = 失去装备区里的白银狮子,应回 1 血。

  it('回血(替换路径):装备新防具替换白银狮子 → 回复1点体力', async () => {
    const TENGJIA: Card = { ...BAIYIN, id: 'tj', name: '藤甲' };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['白银狮子', '装备通用'],
          health: 2,
          hand: ['tj'],
          equipment: { 防具: 'by' },
        }),
      ],
      cardMap: { by: BAIYIN, tj: TENGJIA },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    expect(harness.state.players[1].health).toBe(2);

    // P2 装藤甲替换白银狮子(走真实 装备通用 use 流程)
    await harness.player(1).useCard('装备通用', 'tj');
    await harness.waitForStable();
    harness.processAllEvents();

    // 替换 = 失去装备区里的白银狮子 → 回 1 血
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].equipment['防具']).toBe('tj');
    expect(harness.state.zones.discardPile).toContain('by');
  });
});
