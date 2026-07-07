// 张昭张纮(吴)技能测试:直谏 + 固政
//
// 直谏(主动技):出牌阶段将一张装备牌置于一名其他角色的空装备区,然后摸一张牌。
// 固政(被动技):其他角色弃牌阶段结束时,将其一张弃牌返回其手牌,然后获得其余弃牌。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  subtype?: string,
  range?: number,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, subtype, range };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: PlayerState['equipment'];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? opts.maxHealth ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

// ============================ 直谏 ============================
describe('直谏', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('触发:将装备牌置于其他角色空装备区 → 目标装备 + 自己摸1张', async () => {
    const weapon = mkCard('w1', '测试武器', '♠', '5', '装备牌', '武器', 3);
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', hand: ['w1'], skills: ['直谏'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const ZZ = harness.player('张昭张纮');

    await ZZ.useCardAndTarget('直谏', 'w1', [1]);

    // 武器已装到 P1 的武器栏
    expect(harness.state.players[1].equipment['武器']).toBe('w1');
    // 自己摸了1张(起手 w1 已给出,手牌=摸到的1张)
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.players[0].hand).not.toContain('w1');
  });

  it('触发:装备牌自带技能(诸葛连弩)→ 目标获得该技能', async () => {
    const zgl = mkCard('zgl', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', hand: ['zgl'], skills: ['直谏'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { zgl: zgl },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const ZZ = harness.player('张昭张纮');

    await ZZ.useCardAndTarget('直谏', 'zgl', [1]);

    expect(harness.state.players[1].equipment['武器']).toBe('zgl');
    // 诸葛连弩技能挂载到 P1
    expect(harness.state.players[1].skills).toContain('诸葛连弩');
  });

  it('负面:目标该栏位已有装备(不得替换)→ 拒绝', async () => {
    const w1 = mkCard('w1', '测试武器', '♠', '5', '装备牌', '武器', 3);
    const w2 = mkCard('w2', '另一武器', '♥', '6', '装备牌', '武器', 2);
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', hand: ['w2'], skills: ['直谏'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', skills: [], equipment: { 武器: 'w1' } }),
      ],
      cardMap: { w1, w2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const ZZ = harness.player('张昭张纮');

    await ZZ.expectRejected({ skillId: '直谏', actionType: 'use', params: { cardId: 'w2', targets: [1] } });
    // 原武器未被替换
    expect(harness.state.players[1].equipment['武器']).toBe('w1');
  });

  it('负面:可装到不同栏位(目标已有武器,给防具仍合法)', async () => {
    const w1 = mkCard('w1', '测试武器', '♠', '5', '装备牌', '武器', 3);
    const armor = mkCard('a1', '测试防具', '♦', '7', '装备牌', '防具');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', hand: ['a1'], skills: ['直谏'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', skills: [], equipment: { 武器: 'w1' } }),
      ],
      cardMap: { w1, a1: armor },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const ZZ = harness.player('张昭张纮');

    await ZZ.useCardAndTarget('直谏', 'a1', [1]);
    // 武器保留 + 防具新装
    expect(harness.state.players[1].equipment['武器']).toBe('w1');
    expect(harness.state.players[1].equipment['防具']).toBe('a1');
  });

  it('负面:非装备牌(基本牌)→ 拒绝', async () => {
    const slash = mkCard('k1', '杀', '♠', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', hand: ['k1'], skills: ['直谏'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const ZZ = harness.player('张昭张纮');

    await ZZ.expectRejected({ skillId: '直谏', actionType: 'use', params: { cardId: 'k1', targets: [1] } });
  });

  it('负面:不能对自己使用', async () => {
    const weapon = mkCard('w1', '测试武器', '♠', '5', '装备牌', '武器', 3);
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', hand: ['w1'], skills: ['直谏'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const ZZ = harness.player('张昭张纮');

    await ZZ.expectRejected({ skillId: '直谏', actionType: 'use', params: { cardId: 'w1', targets: [0] } });
  });
});

// ============================ 固政 ============================
describe('固政', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  /** 模拟 P1 的弃牌阶段:P1 弃 cardIds,然后触发弃牌阶段结束 */
  async function simulateDiscardPhase(player: number, cardIds: string[]): Promise<void> {
    if (cardIds.length > 0) {
      await applyAtom(harness.state, { type: '弃置', player, cardIds });
    }
    void applyAtom(harness.state, { type: '阶段结束', player, phase: '弃牌' });
    await harness.waitForStable();
  }

  it('触发:P1 弃2张 → 确认 → 选一张返回P1 → 其余进张昭张纮手牌', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    const c2 = mkCard('c2', '闪', '♥', '6');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', skills: ['固政'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: ['c1', 'c2'], skills: [], health: 2, maxHealth: 4 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 1,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const ZZ = harness.player('张昭张纮');

    await simulateDiscardPhase(1, ['c1', 'c2']);
    ZZ.expectPending('请求回应');
    // 第一步:确认发动
    await ZZ.respond('固政', { choice: true });
    await harness.waitForStable();
    ZZ.expectPending('请求回应');
    // 第二步:选一张返回 P1(选 c1)
    await ZZ.respond('固政', { cardId: 'c1' });
    await harness.waitForStable();

    // c1 返回 P1 手牌
    expect(harness.state.players[1].hand).toContain('c1');
    // c2 进张昭张纮手牌
    expect(harness.state.players[0].hand).toContain('c2');
    // 弃牌堆已无这两张
    expect(harness.state.zones.discardPile).not.toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c2');
  });

  it('不发动:确认=false → 弃牌保留在弃牌堆', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    const c2 = mkCard('c2', '闪', '♥', '6');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', skills: ['固政'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: ['c1', 'c2'], skills: [], health: 2, maxHealth: 4 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 1,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const ZZ = harness.player('张昭张纮');

    await simulateDiscardPhase(1, ['c1', 'c2']);
    ZZ.expectPending('请求回应');
    await ZZ.respond('固政', { choice: false });
    await harness.waitForStable();

    // 弃牌仍在弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
    // 双方手牌不变
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[1].hand).toEqual([]);
  });

  it('边界:只弃1张 → 确认后该牌返回,无其余可获得', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', skills: ['固政'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: ['c1'], skills: [], health: 2, maxHealth: 4 }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 1,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const ZZ = harness.player('张昭张纮');

    await simulateDiscardPhase(1, ['c1']);
    ZZ.expectPending('请求回应');
    // 只弃1张:确认后无选牌步骤(自动选定)
    await ZZ.respond('固政', { choice: true });
    await harness.waitForStable();

    // c1 返回 P1
    expect(harness.state.players[1].hand).toContain('c1');
    // 张昭张纮未获得牌
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.discardPile).not.toContain('c1');
  });

  it('负面:本阶段未弃牌 → 固政不触发(无 pending)', async () => {
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', skills: ['固政'], health: 3, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', hand: [], skills: [], health: 2, maxHealth: 4 }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);

    // 未弃牌直接结束弃牌阶段
    void applyAtom(harness.state, { type: '阶段结束', player: 1, phase: '弃牌' });
    await harness.waitForStable();

    // 无固政询问
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('负面:自己的弃牌阶段 → 固政不触发(仅对其他角色)', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    const c2 = mkCard('c2', '闪', '♥', '6');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: '张昭张纮', hand: ['c1', 'c2'], skills: ['固政'], health: 1, maxHealth: 3 }),
        mkPlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);

    // 张昭张纮自己的弃牌阶段
    await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1', 'c2'] });
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '弃牌' });
    await harness.waitForStable();

    // 固政不对自己触发:无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // 弃牌保留在弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
  });
});
