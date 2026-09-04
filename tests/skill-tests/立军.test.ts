// 立军(孙亮·吴·主公技)技能测试:
//   主公技,其他吴势力角色出牌阶段限一次,当其使用【杀】后,其可以令你获得之,
//   然后你可以令其摸一张牌且此回合使用【杀】的限制次数+1。
//
// 来源:2026-08-26 bug 修复会话新增(此前无任何专属测试)。
//   回归核心:转化杀(武圣影子卡)入弃牌堆时被引擎还原为原卡并删除影子 cardMap 条目,
//   使用结算结束后若按 atom.cardId 反查 cardMap 会落空 → 立军对转化杀静默不触发。
//   修复:使用时 hook 把实体卡 id(shadowOf ?? cardId)记入结算帧参数,结算结束后取回。
//
// 覆盖:
//   1. 真实杀 → 盟友交出 → 主公获得;主公确认 → 盟友摸 1 + 本回合杀次 +1
//   2. 回归:武圣转化杀 → 同样触发,主公获得的是还原后的原卡
//   3. 负面:非吴势力角色用杀 → 不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, Faction, PlayerState } from '../../src/engine/types';

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
  hand?: string[];
  skills?: string[];
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: 4,
    maxHealth: 4,
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

describe('立军', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  function baseState(
    cardMap: Record<string, Card>,
    lordHand: string[],
    allyHand: string[],
    allyFaction: Faction = '吴',
  ) {
    return createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙亮',
          faction: '吴',
          skills: ['立军'],
          hand: lordHand,
        }),
        makePlayer({
          index: 1,
          name: '盟友',
          faction: allyFaction,
          skills: ['武圣', '杀', '闪'],
          hand: allyHand,
        }),
      ],
      cardMap: {
        ...cardMap,
        // 牌堆两张实体牌,供立军摸牌分支
        d0: makeCard('d0', '闪', '♦', '3'),
        d1: makeCard('d1', '无中生有', '♥', '8', '锦囊牌'),
      },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: ['d0', 'd1'], discardPile: [], processing: [] },
    });
  }

  it('真实杀:盟友交出 → 主公获得;主公确认 → 盟友摸1且本回合杀次+1', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    await harness.setup(baseState({ s1: slash }, [], ['s1']));
    const P0 = harness.player('孙亮');
    const P1 = harness.player('盟友');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await waitForStable(harness.state); // 杀结算(孙亮无闪,静默跳过)
    await waitForStable(harness.state); // 立军/盟友确认

    // 盟友选择交给主公
    await P1.respond('立军', { choice: true });
    await waitForStable(harness.state); // 立军/主公确认

    // 主公令其摸牌+杀次+1
    await P0.respond('立军', { choice: true });
    await waitForStable(harness.state);

    expect(harness.state.players[0].hand).toContain('s1');
    // 盟友摸了一张(牌堆顶 d1)
    expect(harness.state.players[1].hand).toContain('d1');
    // 本回合杀次上限 +1 已生效
    expect(harness.state.turn.vars['立军/quota/1']).toBe(true);
  });

  it('回归:武圣转化杀同样触发立军,主公获得的是还原后的原卡', async () => {
    const redPeach = makeCard('c1', '桃', '♥', 'A');
    await harness.setup(baseState({ c1: redPeach }, [], ['c1']));
    const P0 = harness.player('孙亮');
    const P1 = harness.player('盟友');

    // 转化:红桃桃当杀(useSkill='杀')
    await P1.transformThenUse('武圣', { cardId: 'c1' }, '杀', {
      cardId: 'c1#武圣',
      targets: [0],
    });
    await waitForStable(harness.state);
    await waitForStable(harness.state); // 立军/盟友确认(修复前此处无 pending)

    await P1.respond('立军', { choice: true });
    await waitForStable(harness.state); // 立军/主公确认

    // 主公拒绝摸牌分支,仅验证获得原卡
    await P0.respond('立军', { choice: false });
    await waitForStable(harness.state);

    // 原卡 c1(影子已还原)进主公手牌,而非留在弃牌堆
    expect(harness.state.players[0].hand).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c1');
    expect(harness.state.turn.vars['立军/quota/1']).toBeUndefined();
  });

  it('负面:非吴势力角色用杀不触发立军', async () => {
    const slash = makeCard('s2', '杀', '♠', '7');
    await harness.setup(baseState({ s2: slash }, [], ['s2'], '魏'));
    const P1 = harness.player('盟友');

    await P1.useCardAndTarget('杀', 's2', [0]);
    await waitForStable(harness.state);

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.turn.vars['立军/used/1']).toBeUndefined();
  });
});
