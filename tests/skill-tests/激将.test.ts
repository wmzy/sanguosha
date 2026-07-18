// 激将(刘备·主公技):
//   主公技,其他蜀势力角色可以在你需要时代替你使用或打出【杀】(视为由你使用或打出)。
//
// 两种触发场景:
//   - use(主动):出牌阶段,主公请求一名蜀势力角色代替使用一张杀(指定 killTarget)。
//   - respond(响应):主公被询问杀时(决斗/南蛮入侵等),请求蜀角色代为打出杀。
//
// 实现:
//   - use action:validate(主公 + 蜀势力目标)→ execute(请求回应 → 检查处理区有杀)
//     · 出杀:杀进处理区 → 激将 execute 移杀到弃牌堆 → 指定目标 → 询问闪 → 造成伤害
//     · 不出:无效果(官方未提及原"主公摸1张"补充规则,已移除)
//   - respond action:validate(询问杀 pending + 主公 + 有蜀势力角色)
//     · 逐个询问蜀势力角色出杀(复用 杀/respondKill)
//     · 出杀:杀牌进处理区,调用方(决斗/南蛮入侵)检查处理区判断已出
//     · 全部拒绝:处理区无杀,主公承受原结算
//
// 验证:
//   1. 正面 use:蜀势力角色出杀 → 对 killTarget 造成伤害
//   2. 正面 use:蜀势力角色不出杀 → 主公不摸牌(补充规则已移除)
//   3. 正面 respond:主公被决斗 → 激将 → 蜀角色出杀 → 主公不受伤害
//   4. 正面 respond:主公被决斗 → 激将 → 蜀角色拒绝 → 主公受伤害
//   5. 负面:非主公(ownerId≠0)不能使用
//   6. 负面:目标非蜀势力 → 拒绝
//   7. 负面:非自己回合 use → 拒绝
//   8. 负面 respond:无蜀势力角色 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, Faction, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction,
  };
}

describe('激将', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── use 正面:蜀势力角色出杀 → 造成伤害 ──────────────────────────

  it('use 正面:主公激将 → 蜀势力角色出杀 → killTarget 扣血', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['杀'], faction: '蜀' }),
        makePlayer({ index: 2, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0(主公)发动激将,请求 P1(蜀)出杀指定 P2
    await P0.triggerAction('激将', 'use', { target: 1, killTarget: 2 });

    // P1 被询问是否出杀
    const slot = harness.state.pendingSlots.get(1);
    expect(slot?.atom.type).toBe('请求回应');
    expect((slot?.atom as { requestType?: string }).requestType).toBe('杀/respondKill');

    // P1 出杀
    await P1.respond('杀', { cardId: 'k1' });

    // P2 被询问闪
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    // P2 扣1血
    expect(harness.state.players[2].health).toBe(3);
    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    restoreAutoCompare();
  });

  // ─── use 正面:蜀势力角色不出杀 → 主公不摸牌(补充规则已移除) ────

  it('use 正面:蜀势力角色不出杀 → 主公不摸牌(补充规则已移除)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['杀'], faction: '蜀' }),
        makePlayer({ index: 2, name: 'P2', skills: [] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length;
    await P0.triggerAction('激将', 'use', { target: 1 });

    // P1 被询问但不出杀
    const slot = harness.state.pendingSlots.get(1);
    expect(slot?.atom.type).toBe('请求回应');

    await P1.pass(); // 不出杀

    // 官方:不出杀时无效果,主公不摸牌(原"摸1张"补充规则已移除)
    expect(harness.state.players[0].hand.length).toBe(handBefore);
    // P1 的杀未消耗
    expect(harness.state.players[1].hand).toContain('k1');
  });

  // ─── respond 正面:主公被决斗 → 激将 → 蜀角色出杀 → 主公不受伤害 ──
  // (响应型代打场景:官方「你需要时」覆盖决斗/南蛮入侵等需要打出杀的场景)

  it('respond 正面:主公被决斗 → 激将 → 蜀角色出杀 → 主公不受伤害', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const duel: Card = {
      id: 'jd1',
      name: '决斗',
      suit: '♠',
      color: '黑',
      rank: 'A',
      type: '锦囊牌',
    };
    const slash = makeCard('k1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        // P0 = 主公刘备(有激将,无杀)
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        // P1 = 蜀势力角色(有杀)
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'],
          faction: '蜀',
        }),
        // P2 = 决斗发起者(无杀,会输掉决斗)
        makePlayer({ index: 2, name: 'P2', hand: ['jd1'], skills: ['决斗'], faction: '魏' }),
      ],
      cardMap: { jd1: duel, k1: slash },
      currentPlayerIndex: 2, // P2 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P2 对 P0 出决斗(P0 是目标,先手出杀)
    await P2.useCardAndTarget('决斗', 'jd1', [0]);
    await harness.waitForStable();

    // 无懈可击窗口(broadcast)→ pass
    const slot0 = [...harness.state.pendingSlots.values()][0];
    expect(slot0?.atom.type).toBe('请求回应');
    await P0.pass();
    await harness.waitForStable();

    // P0 被询问杀(决斗目标先手)
    P0.expectPending('询问杀');

    // P0 发动激将 respond
    await P0.respond('激将', {});
    await harness.waitForStable();

    // P1(蜀势力)被询问是否出杀
    const p1Slot = harness.state.pendingSlots.get(1);
    expect(p1Slot?.atom.type).toBe('请求回应');
    expect((p1Slot?.atom as { requestType?: string }).requestType).toBe('杀/respondKill');

    // P1 出杀(代打,杀牌移入处理区)
    await P1.respond('杀', { cardId: 'k1' });
    await harness.waitForStable();

    // 决斗结算:P0 出了杀(经激将),轮到 P2 出杀
    // P2 被询问杀
    P2.expectPending('询问杀');
    await P2.pass(); // P2 无杀,放弃
    await harness.waitForStable();

    // 决斗结算:P2 输,扣 1 血;P0(主公)未受伤
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[2].health).toBe(3);
    // 杀进弃牌堆(决斗消耗)
    expect(harness.state.zones.discardPile).toContain('k1');
    // P1 的杀已消耗
    expect(harness.state.players[1].hand).not.toContain('k1');
    restoreAutoCompare();
  });

  // ─── respond 正面:主公被决斗 → 激将 → 蜀角色拒绝 → 主公受伤 ───

  it('respond 正面:主公被决斗 → 激将 → 蜀角色拒绝 → 主公受伤', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const duel: Card = {
      id: 'jd1',
      name: '决斗',
      suit: '♠',
      color: '黑',
      rank: 'A',
      type: '锦囊牌',
    };
    const slash = makeCard('k1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'],
          faction: '蜀',
        }),
        makePlayer({ index: 2, name: 'P2', hand: ['jd1'], skills: ['决斗'], faction: '魏' }),
      ],
      cardMap: { jd1: duel, k1: slash },
      currentPlayerIndex: 2,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('决斗', 'jd1', [0]);
    await harness.waitForStable();

    // 无懈可击窗口 → pass
    await P0.pass();
    await harness.waitForStable();

    P0.expectPending('询问杀');
    await P0.respond('激将', {});
    await harness.waitForStable();

    // P1 被询问但拒绝出杀
    const p1Slot = harness.state.pendingSlots.get(1);
    expect(p1Slot?.atom.type).toBe('请求回应');
    await P1.pass(); // 拒绝代打出杀
    await harness.waitForStable();

    // 无人代打杀 → 决斗中 P0 没出杀 → P0 输,扣 1 血
    expect(harness.state.players[0].health).toBe(3);
    // P1 的杀未消耗
    expect(harness.state.players[1].hand).toContain('k1');
    // P2 未受伤
    expect(harness.state.players[2].health).toBe(4);
    restoreAutoCompare();
  });

  // ─── 负面:非主公不能使用激将 ─────────────────────────────────

  it('负面:非主公(ownerId≠0)使用激将 → 拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1'],
          skills: ['激将', '杀'],
          faction: '蜀',
        }),
        makePlayer({ index: 2, name: 'P2', skills: [], faction: '蜀' }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1(index=1)不是主公 → 拒绝
    await P1.expectRejected({
      skillId: '激将',
      actionType: 'use',
      params: { target: 2, killTarget: 0 },
    });
  });

  // ─── 负面:目标非蜀势力 → 拒绝 ────────────────────────────────

  it('负面:目标非蜀势力(魏)→ 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'], faction: '魏' }),
        makePlayer({ index: 2, name: 'P2', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 是魏势力 → 拒绝
    await P0.expectRejected({
      skillId: '激将',
      actionType: 'use',
      params: { target: 1, killTarget: 2 },
    });
  });

  // ─── 负面:非自己回合 use → 拒绝 ──────────────────────────────

  it('负面:非自己回合使用激将 use → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'], faction: '蜀' }),
        makePlayer({ index: 2, name: 'P2', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '激将',
      actionType: 'use',
      params: { target: 1, killTarget: 2 },
    });
  });

  // ─── 负面 respond:无蜀势力角色 → 拒绝 ────────────────────────

  it('负面 respond:主公被决斗但无蜀势力角色 → 激将 respond 被拒绝', async () => {
    const duel: Card = {
      id: 'jd1',
      name: '决斗',
      suit: '♠',
      color: '黑',
      rank: 'A',
      type: '锦囊牌',
    };
    const state: GameState = createGameState({
      players: [
        // P0 = 主公刘备,有激将
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        // P1 = 魏势力(非蜀,虽有杀但不能被激将)
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'],
          faction: '魏',
        }),
        makePlayer({ index: 2, name: 'P2', hand: ['jd1'], skills: ['决斗'] }),
      ],
      cardMap: { jd1: duel, k1: makeCard('k1', '杀', '♠', '5') },
      currentPlayerIndex: 2,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('决斗', 'jd1', [0]);
    await harness.waitForStable();

    // 无懈可击窗口 → pass
    await P0.pass();
    await harness.waitForStable();

    // P0 被询问杀
    P0.expectPending('询问杀');

    // P0 尝试激将 respond → 被拒绝(无蜀势力角色)
    await P0.expectRejected({
      skillId: '激将',
      actionType: 'respond',
      params: {},
    });

    // 激将被拒后,询问杀仍在 → P0 pass,承受决斗伤害
    await P0.pass();
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(3);
  });
});
