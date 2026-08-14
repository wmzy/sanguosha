// 节命(荀彧·被动技)测试
//   当你受到1点伤害后,你可以令一名角色将手牌摸至X张(X为其体力上限且最多为5)。
//
// 验证:
//   1. happy path:受伤 → 选目标 → 目标摸牌至上限
//   2. X 封顶 5:maxHealth>5 时 X=5
//   3. 手牌已满:不摸牌
//   4. 不发动:拒绝
//   5. 选自己:给自己补牌
//   6. 每点伤害触发一次:受到 N 点 → N 次独立询问
//   7. 荀彧因伤害死亡(无人救)→ alive 守卫生效 → 节命不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import { runDamageFlow } from '../../src/engine/flows/damage';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '荀彧',
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
  };
}

describe('节命', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── happy path:受伤 → 选目标 → 摸牌至上限 ────────────────────
  it('P1(荀彧)被杀受伤 → 选 P0(4血上限,0手牌) → P0 摸4张', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    // deck 供节命摸牌用
    for (let i = 0; i < 6; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5'];

    const state: GameState = createGameState({
      players: [
        // P0:4 血上限,0 手牌
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀', '闪'] }),
        // P1:荀彧 3 血
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // P0 需要有杀:放到手牌
    state.players[0].hand = ['k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 无手牌:询问闪走 skip(无 slot),直接扣血 → 受伤后触发节命

    // 受伤后:荀彧被询问是否发动节命
    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });

    // 选目标 P0
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 0 });

    // P0 摸至 4 张(体力上限 4,当前 0 手牌)
    expect(harness.state.players[0].hand.length).toBe(4);
    // P1 受伤
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── X 封顶 5:maxHealth>5 时 X=5 ────────────────────
  it('P0(6血上限,0手牌) → X=5(封顶)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    for (let i = 0; i < 8; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5', 'dk6', 'dk7'];

    const state: GameState = createGameState({
      players: [
        // P0:6 血上限(超过 5 封顶),0 手牌
        makePlayer({
          index: 0,
          name: 'P0',
          character: '董卓',
          skills: ['杀', '闪'],
          health: 6,
          maxHealth: 6,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand = ['k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 无手牌:询问闪走 skip(无 slot),直接扣血 → 受伤后触发节命

    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 0 });

    // X = min(6, 5) = 5,P0 摸 5 张
    expect(harness.state.players[0].hand.length).toBe(5);
  });

  // ─── 手牌已满:不摸牌 ────────────────────
  it('P0(4血上限,已有4手牌) → X=4,补牌数=0,不摸', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    // P0 需 4 张手牌
    const p0Cards = ['h1', 'h2', 'h3', 'h4'];
    for (const id of p0Cards) cardMap[id] = makeCard(id, '闪', '♦', '2');
    for (let i = 0; i < 3; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2'];

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '张飞',
          skills: ['杀', '闪'],
          hand: p0Cards,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand = [...p0Cards, 'k1']; // P0 有杀+4张
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 无手牌:询问闪走 skip(无 slot),直接扣血 → 受伤后触发节命

    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 0 });

    // P0 原有 4 张(杀已出),X=4,补牌=4-4=0
    expect(harness.state.players[0].hand.length).toBe(4);
  });

  // ─── 不发动:拒绝 ────────────────────
  it('不发动节命:不摸牌', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀', '闪'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand = ['k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 无手牌:询问闪走 skip(无 slot),直接扣血 → 受伤后触发节命

    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: false });

    // P0 手牌不变(杀已出,0 手牌)
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 选自己:给荀彧补牌 ────────────────────
  it('选自己(P1) → P1 摸至体力上限', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };
    for (let i = 0; i < 5; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4'];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀'] }),
        // P1:荀彧 3 血上限,受伤后 2 血,0 手牌
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand = ['k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 无手牌:询问闪走 skip(无 slot),直接扣血 → 受伤后触发节命

    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 1 }); // 选自己

    // P1 摸至 3 张(体力上限 3,当前 0 手牌)
    expect(harness.state.players[1].hand.length).toBe(3);
  });

  // ─── 每点伤害触发一次(与遗计一致) ────────────────────
  it('受到 2 点伤害 → 触发 2 次节命(每点独立询问发动)', async () => {
    const cardMap: Record<string, Card> = {};
    for (let i = 0; i < 8; i++) {
      cardMap[`dk${i}`] = makeCard(`dk${i}`, '杀', '♠', String(i + 2));
    }
    const deck = ['dk0', 'dk1', 'dk2', 'dk3', 'dk4', 'dk5', 'dk6', 'dk7'];

    const state: GameState = createGameState({
      players: [
        // P0:4 血上限,0 手牌(第一次节命目标)
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀', '闪'] }),
        // P1:荀彜 3 血
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['节命', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 直接造成 2 点伤害给荀彜(绕过杀/闪链路,聚焦节命循环)
    const damagePromise = runDamageFlow(state, 0, 1, 2);
    await harness.waitForStable();

    // 第一次节命:确认发动 → 选 P0 → P0 摸至 4 张
    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 0 });
    await harness.waitForStable();
    expect(harness.state.players[0].hand.length).toBe(4);

    // 第二次节命(下一轮循环):确认发动 → 选自己 P1 → P1 摸至 3 张
    P1.expectPending('请求回应');
    await P1.respond('节命', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('节命', { target: 1 });
    await harness.waitForStable();
    expect(harness.state.players[1].hand.length).toBe(3);

    // 荀彜受到 2 点伤害:3 → 1(仍存活,故两次都触发)
    expect(harness.state.players[1].health).toBe(1);

    await damagePromise;
  });

  // ─── 荀彧因伤害死亡(无人救)→ 节命不触发 ────────────────────
  // 实现的 alive 守卫:节命挂在「伤害结算结束后」(濒死求桃之后),
  //   荀彧因伤害死亡(无人救)时 alive=false → 不询问、不摸牌。
  it('荀彧 1 血中杀 → 濒死无人救 → 死亡 → 节命不触发(不询问/不摸牌)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', character: '张飞', skills: ['杀', '闪'] }),
        // 荀彧 1 血:中杀即濒死
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['节命', '闪'],
          health: 1,
          maxHealth: 3,
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].hand = ['k1'];
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 无手牌:询问闪走 skip,直接扣血 → 1→0 → 濒死求桃
    // 两人都无桃 → pass 掉所有求桃 pending → 荀彧死亡
    while (harness.state.pendingSlots.size > 0) {
      const slot = [...harness.state.pendingSlots.values()][0];
      const target = (slot.atom as { target?: number }).target ?? 0;
      await harness.player(target).pass();
      await harness.waitForStable();
    }

    // 荀彧死亡 → 节命 alive 守卫失败 → 不触发
    expect(harness.state.players[1].alive).toBe(false);
    // 无节命询问 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // P0 出杀后无手牌,亦未被节命补牌
    expect(harness.state.players[0].hand.length).toBe(0);
  });
});
