// 界挑衅(界姜维)行为测试(界限突破版):
// 核心差异(相对标挑衅 src/engine/skills/挑衅.ts):
//   1. 每阶段限两次(标版限一次)
//   2. 目标必须"出杀 + 此杀对姜维造成伤害"才免于被弃;出杀但被闪抵消仍要被弃
//
// 用例:
//   1. 目标出杀 + 姜维不出闪(受伤)→ 免于被弃(同标版)
//   2. 目标出杀 + 姜维出闪(未受伤)→ 关键差异:仍弃目标一张牌
//   3. 目标无杀不出 → 弃其一张牌(同标版)
//   4. 本阶段限两次:第二次发动可执行,第三次被拒绝
//   5. validate:不能选自己
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
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

function build(opts?: {
  p0Hand?: string[];
  p0Skills?: string[];
  p1Hand?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  const cards: Record<string, Card> = { ...opts?.extraCards };
  return createGameState({
    players: [
      {
        index: 0,
        name: '界姜维',
        character: '界姜维',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: opts?.p0Hand ?? [],
        equipment: {},
        skills: opts?.p0Skills ?? ['界挑衅'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P1',
        character: '反',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: opts?.p1Hand ?? [],
        equipment: {},
        skills: ['杀'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界挑衅', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('目标出杀 + 姜维不出闪 → 姜维受伤,免于被弃(同标版行为)', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    const extra = mkCard('e1', '闪', '♥', '3'); // 目标另有一张闪(不被弃,因免于被弃)
    await harness.setup(build({ p1Hand: [kill.id, extra.id], extraCards: { k1: kill, e1: extra } }));
    const P0 = harness.player('界姜维');
    const P1 = harness.player('P1');
    const handBefore = harness.state.players[1].hand.length; // 2

    await P0.triggerAction('界挑衅', 'use', { target: 1 });
    P1.expectPending('请求回应');
    await P1.respond('杀', { cardId: 'k1' });
    // 杀结算:姜维被询问闪 → 不出闪
    P0.expectPending('询问闪');
    await P0.pass();

    expect(harness.state.players[0].health).toBe(3); // 受 1 点伤害
    expect(harness.state.zones.discardPile).toContain('k1'); // 杀进弃牌堆
    // 关键:出杀+造成伤害 → 免于被弃,目标手牌不减少(除已出的杀)
    expect(harness.state.players[1].hand.length).toBe(handBefore - 1); // 仅扣掉出的杀
    expect(harness.state.players[1].hand).toContain('e1'); // 闪未被弃
  });

  it('目标出杀 + 姜维出闪(未受伤)→ 关键差异:仍弃目标一张牌', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    const extra = mkCard('e1', '桃', '♥', '3'); // 目标另一张牌(应被弃)
    const shan = mkCard('s0', '闪', '♦', '2'); // 姜维手中闪
    await harness.setup(
      build({
        p0Skills: ['界挑衅', '闪'],
        p0Hand: [shan.id],
        p1Hand: [kill.id, extra.id],
        extraCards: { k1: kill, e1: extra, s0: shan },
      }),
    );
    const P0 = harness.player('界姜维');
    const P1 = harness.player('P1');

    await P0.triggerAction('界挑衅', 'use', { target: 1 });
    P1.expectPending('请求回应');
    await P1.respond('杀', { cardId: 'k1' });
    // 杀结算:姜维被询问闪 → 出闪
    P0.expectPending('询问闪');
    await P0.respond('闪', { cardId: 's0' });

    // 关键差异:虽然目标出了杀,但未造成伤害 → 姜维仍弃其一张牌
    P0.expectPending('请求回应');
    await P0.respond('界挑衅', { zone: 'hand', handIndex: 0 });

    expect(harness.state.players[0].health).toBe(4); // 闪抵消,未受伤
    expect(harness.state.zones.discardPile).toContain('k1'); // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('s0'); // 闪进弃牌堆
    // 目标手牌减少 1(被弃):原 [k1,e1]→出 k1 后 [e1]→被弃 e1 后 []
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('e1');
  });

  it('目标无杀不出 → 姜维弃其一张牌(同标版)', async () => {
    const shan = mkCard('s1', '闪', '♥', '5');
    await harness.setup(build({ p1Hand: [shan.id], extraCards: { s1: shan } }));
    const P0 = harness.player('界姜维');
    const P1 = harness.player('P1');

    await P0.triggerAction('界挑衅', 'use', { target: 1 });
    P1.expectPending('请求回应');
    await P1.pass(); // 无杀
    P0.expectPending('请求回应');
    await P0.respond('界挑衅', { zone: 'hand', handIndex: 0 });

    expect(harness.state.players[1].hand).not.toContain('s1');
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('s1');
    expect(harness.state.players[0].health).toBe(4);
  });

  it('本阶段限两次:第二次可执行,第三次被拒绝', async () => {
    const kill1 = mkCard('k1', '杀', '♠', '7');
    const kill2 = mkCard('k2', '杀', '♣', '8');
    const extra = mkCard('e1', '桃', '♥', '3');
    await harness.setup(
      build({ p1Hand: [kill1.id, kill2.id, extra.id], extraCards: { k1: kill1, k2: kill2, e1: extra } }),
    );
    const P0 = harness.player('界姜维');
    const P1 = harness.player('P1');

    // 第一次:目标出杀 + 姜维不闪 → 受伤,免于被弃
    await P0.triggerAction('界挑衅', 'use', { target: 1 });
    await P1.respond('杀', { cardId: 'k1' });
    await P0.pass();
    expect(harness.state.players[0].health).toBe(3);

    // 第二次:仍可执行(本阶段限两次)
    await P0.triggerAction('界挑衅', 'use', { target: 1 });
    await P1.respond('杀', { cardId: 'k2' });
    await P0.pass();
    expect(harness.state.players[0].health).toBe(2);

    // 第三次:被拒绝(已达上限 2 次)
    await P0.expectRejected({
      skillId: '界挑衅',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  it('validate:不能选择自己为目标', async () => {
    await harness.setup(build());
    const P0 = harness.player('界姜维');
    await P0.expectRejected({
      skillId: '界挑衅',
      actionType: 'use',
      params: { target: 0 },
    });
  });
});
