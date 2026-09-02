// 烈刃(祝融·被动技)行为测试:
//   1. 杀造成伤害后发动烈刃,拼点赢 → 获得对方一张牌
//   2. 拼点没赢 → 无事发生(拼点牌进弃牌堆)
//   3. 不发动烈刃 → 无拼点
//   4. 受害者无手牌 → 不触发(无 confirm 询问)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  return { id, name, suit, color, rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? opts.maxHealth ?? 4,
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

describe('烈刃', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('杀造成伤害后拼点赢 → 获得对方一张牌', async () => {
    const slash = mkCard('s1', '杀', '♠', '7');
    const ownerPd = mkCard('p1', '杀', '♠', 'K'); // 祝融拼点牌:K=13(大)
    const victimPd = mkCard('p2', '闪', '♥', '3'); // 受害者拼点牌:3(小)
    const stolen = mkCard('st', '桃', '♣', '5'); // 将被偷的牌

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '祝融',
            character: '祝融',
            hand: [slash.id, ownerPd.id],
            skills: ['杀', '烈刃'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: '受害',
            character: '受害',
            hand: [victimPd.id, stolen.id],
            skills: [],
            health: 4,
            maxHealth: 4,
          }),
        ],
        cardMap: { s1: slash, p1: ownerPd, p2: victimPd, st: stolen },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const ZR = harness.player('祝融');
    const V = harness.player('受害');

    // 祝融 杀 受害
    await ZR.useCardAndTarget('杀', 's1', [1]);
    // 受害不出闪(pass)→ 受伤
    await V.pass();
    await harness.waitForStable();
    // 烈刃询问发动
    ZR.expectPending('请求回应');
    await ZR.respond('烈刃', { choice: true }); // 发动
    await harness.waitForStable();
    // 祝融选拼点牌
    ZR.expectPending('请求回应');
    await ZR.respond('烈刃', { cardId: 'p1' });
    await harness.waitForStable();
    // 受害选拼点牌
    V.expectPending('请求回应');
    await V.respond('烈刃', { cardId: 'p2' });
    await harness.waitForStable();

    // 拼点:K(13) > 3 → 祝融赢 → 获得 受害手牌第一张(st)
    expect(harness.state.players[0].hand).toContain('st'); // 祝融获得 st
    expect(harness.state.players[1].hand).not.toContain('st'); // 受害失去 st
    // 两张拼点牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p1');
    expect(harness.state.zones.discardPile).toContain('p2');
    // 杀牌也进弃牌堆(杀收尾清理)
    expect(harness.state.zones.discardPile).toContain('s1');
    // 受伤扣血
    expect(harness.state.players[1].health).toBe(3);
  });

  it('拼点没赢 → 无事发生(拼点牌进弃牌堆,不获得牌)', async () => {
    const slash = mkCard('s2', '杀', '♠', '7');
    const ownerPd = mkCard('p1', '杀', '♠', '3'); // 祝融拼点牌:3(小)
    const victimPd = mkCard('p2', '闪', '♥', 'K'); // 受害者拼点牌:K=13(大)
    const keep = mkCard('kp', '桃', '♣', '5'); // 受害保留的牌

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '祝融',
            character: '祝融',
            hand: [slash.id, ownerPd.id],
            skills: ['杀', '烈刃'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: '受害',
            character: '受害',
            hand: [victimPd.id, keep.id],
            skills: [],
            health: 4,
            maxHealth: 4,
          }),
        ],
        cardMap: { s2: slash, p1: ownerPd, p2: victimPd, kp: keep },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const ZR = harness.player('祝融');
    const V = harness.player('受害');

    await ZR.useCardAndTarget('杀', 's2', [1]);
    await V.pass();
    await harness.waitForStable();
    await ZR.respond('烈刃', { choice: true });
    await harness.waitForStable();
    await ZR.respond('烈刃', { cardId: 'p1' });
    await harness.waitForStable();
    await V.respond('烈刃', { cardId: 'p2' });
    await harness.waitForStable();

    // 拼点:3 < K → 祝融没赢 → 不获得牌
    expect(harness.state.players[0].hand).not.toContain('kp');
    expect(harness.state.players[1].hand).toContain('kp'); // 受害保留
    // 拼点牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p1');
    expect(harness.state.zones.discardPile).toContain('p2');
  });

  it('拼点平局(点数相等)→ 视为没赢,不获得牌', async () => {
    const slash = mkCard('s5', '杀', '♠', '7');
    const ownerPd = mkCard('p1', '杀', '♠', '7'); // 祝融拼点牌:7
    const victimPd = mkCard('p2', '闪', '♥', '7'); // 受害者拼点牌:7(相等)
    const keep = mkCard('kp', '桃', '♣', '5'); // 受害保留的牌

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '祝融',
            character: '祝融',
            hand: [slash.id, ownerPd.id],
            skills: ['杀', '烈刃'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: '受害',
            character: '受害',
            hand: [victimPd.id, keep.id],
            skills: [],
            health: 4,
            maxHealth: 4,
          }),
        ],
        cardMap: { s5: slash, p1: ownerPd, p2: victimPd, kp: keep },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const ZR = harness.player('祝融');
    const V = harness.player('受害');

    await ZR.useCardAndTarget('杀', 's5', [1]);
    await V.pass();
    await harness.waitForStable();
    await ZR.respond('烈刃', { choice: true });
    await harness.waitForStable();
    await ZR.respond('烈刃', { cardId: 'p1' });
    await harness.waitForStable();
    await V.respond('烈刃', { cardId: 'p2' });
    await harness.waitForStable();

    // 拼点:7 === 7 → 平局,严格大于才算赢 → 祝融没赢 → 不获得牌
    expect(harness.state.players[0].hand).not.toContain('kp');
    expect(harness.state.players[1].hand).toContain('kp'); // 受害保留
    // 拼点牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p1');
    expect(harness.state.zones.discardPile).toContain('p2');
  });

  it('不发动烈刃 → 无拼点,双方手牌不变(除杀)', async () => {
    const slash = mkCard('s3', '杀', '♠', '7');
    const ownerPd = mkCard('p1', '杀', '♠', 'K');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '祝融',
            character: '祝融',
            hand: [slash.id, ownerPd.id],
            skills: ['杀', '烈刃'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: '受害',
            character: '受害',
            hand: ['p2', 'st'],
            skills: [],
            health: 4,
            maxHealth: 4,
          }),
        ],
        cardMap: {
          s3: slash,
          p1: ownerPd,
          p2: mkCard('p2', '闪', '♥', '3'),
          st: mkCard('st', '桃', '♣', '5'),
        },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const ZR = harness.player('祝融');
    const V = harness.player('受害');

    await ZR.useCardAndTarget('杀', 's3', [1]);
    await V.pass();
    await harness.waitForStable();
    // 烈刃询问 → 不发动
    ZR.expectPending('请求回应');
    await ZR.respond('烈刃', { choice: false });
    await harness.waitForStable();

    // 不拼点:祝融仍持有 p1,受害手牌不变
    expect(harness.state.players[0].hand).toContain('p1');
    expect(harness.state.players[1].hand.length).toBe(2);
    // 拼点牌未进弃牌堆
    expect(harness.state.zones.discardPile).not.toContain('p1');
    expect(harness.state.zones.discardPile).not.toContain('p2');
  });

  it('受害者无手牌 → 不触发烈刃(无 confirm 询问)', async () => {
    const slash = mkCard('s4', '杀', '♠', '7');
    const ownerPd = mkCard('p1', '杀', '♠', 'K');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '祝融',
            character: '祝融',
            hand: [slash.id, ownerPd.id],
            skills: ['杀', '烈刃'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: '受害',
            character: '受害',
            hand: [], // 无手牌,无法拼点
            skills: [],
            health: 4,
            maxHealth: 4,
          }),
        ],
        cardMap: { s4: slash, p1: ownerPd },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const ZR = harness.player('祝融');
    const V = harness.player('受害');

    await ZR.useCardAndTarget('杀', 's4', [1]);
    await V.pass(); // 不出闪
    await harness.waitForStable();

    // 受害无手牌 → 烈刃不触发(无 烈刃/confirm 询问),无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // 受伤扣血
    expect(harness.state.players[1].health).toBe(3);
    // 祝融仍持有 p1(未拼点)
    expect(harness.state.players[0].hand).toContain('p1');
  });

  it('拼点赢且结算时受害多张手牌 → 盲取随机获得(seed 变化结果可不同,不固定首张)', async () => {
    // 回归背景:曾固定取 hand[0],对手可按手牌排列利用;现按 seed RNG 盲取
    // (与突袭/界突袭"从不可见手牌盲取"范式一致)。
    const gained = new Set<string>();
    for (let seed = 1; seed <= 24 && gained.size < 2; seed++) {
      const h = new SkillTestHarness();
      const slash = mkCard(`s${seed}`, '杀', '♠', '7');
      const ownerPd = mkCard(`p1_${seed}`, '杀', '♠', 'K'); // K=13 大
      const victimPd = mkCard(`p2_${seed}`, '闪', '♥', '3'); // 3 小
      const kp1 = mkCard(`k1_${seed}`, '桃', '♣', '5');
      const kp2 = mkCard(`k2_${seed}`, '无懈可击', '♦', '6');
      await h.setup(
        createGameState({
          players: [
            mkPlayer({
              index: 0,
              name: '祝融',
              hand: [slash.id, ownerPd.id],
              skills: ['杀', '烈刃'],
            }),
            mkPlayer({
              index: 1,
              name: '受害',
              hand: [victimPd.id, kp1.id, kp2.id],
              skills: [],
            }),
          ],
          cardMap: {
            [slash.id]: slash,
            [ownerPd.id]: ownerPd,
            [victimPd.id]: victimPd,
            [kp1.id]: kp1,
            [kp2.id]: kp2,
          },
          currentPlayerIndex: 0,
          phase: '出牌',
          turn: { round: 1, phase: '出牌', vars: {} },
          rngSeed: seed,
        }),
      );
      const ZR = h.player('祝融');
      const V = h.player('受害');

      await ZR.useCardAndTarget('杀', slash.id, [1]);
      await V.pass();
      await h.waitForStable();
      ZR.expectPending('请求回应');
      await ZR.respond('烈刃', { choice: true });
      await h.waitForStable();
      await ZR.respond('烈刃', { cardId: ownerPd.id });
      await h.waitForStable();
      V.expectPending('请求回应');
      await V.respond('烈刃', { cardId: victimPd.id });
      await h.waitForStable();

      // 拼点后受害剩 [kp1,kp2] → 获得其中一张
      const hand = h.state.players[0].hand;
      if (hand.includes(kp1.id)) gained.add(kp1.id);
      if (hand.includes(kp2.id)) gained.add(kp2.id);
    }
    // 24 个 seed 下两种结果全不出现的概率 ≈ 2^-23,视为不可能
    expect(gained.size).toBe(2);
  });
});
