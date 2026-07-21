// 界酒诗(界曹植·主动技)测试
//   你可以将武将牌翻至背面,视为使用一张【酒】。
//   当你受到伤害后,或回合外累计获得至少X张"落英"牌后(X为你体力值上限),
//   若你的武将牌背面朝上,你可以翻至正面。
//
// 官方来源:三国杀 OL 界限突破 hero/629。
//
// 验证:
//   1. use validate:非自己回合 → 拒绝
//   2. use validate:非出牌阶段 → 拒绝
//   3. use validate:已翻面(有 '/翻面' 标签)→ 拒绝
//   4. use execute:发动 → 加 '酒诗/翻面' 标签 + '酒/nextKillDamageBonus' 标记
//   5. 端到端:受伤翻回 — 翻面后受到伤害 → 询问 → confirm → 翻回正面
//   6. 端到端:受伤翻回 — 翻面后受到伤害 → 询问 → 取消 → 保持背面
//   7. 端到端:正面朝上时受伤 → 不触发翻回询问
//   8. 端到端:翻面后下张杀伤害 +1(视为使用酒生效)
//   9. respond:无 pending → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  tags?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: opts.tags ?? [],
    judgeZone: [],
    faction: '魏',
    identity: '主公',
  };
}

describe('界酒诗', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── use validate ─────────────────────────

  it('use:非自己回合 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界酒诗'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界酒诗',
      actionType: 'use',
      params: {},
    });
  });

  it('use:非出牌阶段 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界酒诗'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '摸牌', // 不是出牌阶段
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界酒诗',
      actionType: 'use',
      params: {},
    });
  });

  it('use:已翻面(有 /翻面 标签)→ 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界酒诗'],
          tags: ['酒诗/翻面'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界酒诗',
      actionType: 'use',
      params: {},
    });
  });

  // ─── use execute ─────────────────────────

  it('use:发动 → 加 酒诗/翻面 标签 + 酒/nextKillDamageBonus 标记', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界酒诗'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界酒诗', 'use', {});
    await harness.waitForStable();

    // 加了 '酒诗/翻面' 标签
    expect(harness.state.players[0].tags).toContain('酒诗/翻面');
    // 加了 '酒/nextKillDamageBonus' 标记
    const hasWineMark = harness.state.players[0].marks.some(
      (m) => m.id === '酒/nextKillDamageBonus',
    );
    expect(hasWineMark).toBe(true);
  });

  // ─── 端到端:受伤翻回 ─────────────────────────

  it('端到端:翻面后受到伤害 → confirm → 翻回正面', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0', // 曹植
          hand: [],
          skills: ['界酒诗', '闪'],
          health: 3,
          maxHealth: 3,
          tags: ['酒诗/翻面'], // 已翻面
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P1 杀 P0
    await P1.useCardAndTarget('杀', 'k1', [0]);
    // P0 不出闪
    await P0.pass();
    await harness.waitForStable();

    // 询问 P0 是否翻回正面
    P0.expectPending('请求回应');
    const slot = [...harness.state.pendingSlots.values()][0];
    const atom = slot.atom as { requestType?: string };
    expect(atom.requestType).toBe('酒诗/damageFlip');

    // P0 选择翻回正面
    await P0.respond('界酒诗', { choice: true });
    await harness.waitForStable();

    // 翻回正面:无 '/翻面' 后缀标签
    expect(harness.state.players[0].tags.some((t) => t.endsWith('/翻面'))).toBe(false);
    // 受到 1 点伤害
    expect(harness.state.players[0].health).toBe(2);
  });

  it('端到端:翻面后受到伤害 → 取消 → 保持背面', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界酒诗', '闪'],
          health: 3,
          maxHealth: 3,
          tags: ['酒诗/翻面'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass();
    await harness.waitForStable();

    P0.expectPending('请求回应');
    await P0.respond('界酒诗', { choice: false });
    await harness.waitForStable();

    // 仍背面朝上
    expect(harness.state.players[0].tags).toContain('酒诗/翻面');
    expect(harness.state.players[0].health).toBe(2);
  });

  it('端到端:正面朝上时受伤 → 不触发翻回询问', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界酒诗', '闪'],
          health: 3,
          maxHealth: 3,
          // 正面朝上:无 '/翻面' 标签
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass();
    await harness.waitForStable();

    // 正面朝上 → 不触发翻回询问(可能有无懈等询问,但不应有 酒诗/damageFlip)
    let hasDamageFlip = false;
    for (const slot of harness.state.pendingSlots.values()) {
      const a = slot.atom as { requestType?: string };
      if (a.requestType === '酒诗/damageFlip') hasDamageFlip = true;
    }
    expect(hasDamageFlip).toBe(false);

    // 仍正面朝上(无翻面标签)
    expect(harness.state.players[0].tags.some((t) => t.endsWith('/翻面'))).toBe(false);
    expect(harness.state.players[0].health).toBe(2);
  });

  // ─── 端到端:翻面后下张杀伤害 +1 ─────────────────────────

  it('端到端:发动酒诗后,本回合下一张杀伤害+1(视为酒生效)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // P0 = 曹植,先发动酒诗翻面,然后出杀
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['界酒诗', '杀', '酒'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0, // P0 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 发动酒诗(翻面 + 视为酒)
    await P0.triggerAction('界酒诗', 'use', {});
    await harness.waitForStable();
    expect(harness.state.players[0].tags).toContain('酒诗/翻面');

    // P0 出杀 P1
    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 不闪
    await P1.pass();
    await harness.waitForStable();

    // 伤害 +1 = 2
    expect(harness.state.players[1].health).toBe(1);
    // 酒 mark 已被消费
    const hasWineMark = harness.state.players[0].marks.some(
      (m) => m.id === '酒/nextKillDamageBonus',
    );
    expect(hasWineMark).toBe(false);

    // 注:酒诗翻回正面仅在曹植自己受伤时触发;本场景是曹植伤人,不触发翻回询问。
  });

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界酒诗'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界酒诗',
      actionType: 'respond',
      params: { choice: true },
    });
  });
});
