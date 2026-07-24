// 暴虐(董卓·主公技)技能测试:
//   其他群雄角色每造成一次伤害后,可进行一次判定,若为黑桃,回复1点体力。
//
// 验证:
//   1. 正面:群雄角色造成伤害 → 董卓(主公)确认判定 → 黑桃 → 回复1点体力
//   2. 负面:非黑桃判定 → 不回复
//   3. 负面:不发动(拒绝判定) → 不判定不回复
//   4. 负面:非群雄角色造成伤害 → 不触发
//   5. 负面:董卓非主公 → 不触发
//   6. 负面:自己造成伤害 → 不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
import { suitColor } from '../../src/shared/types';
import type { Card, Faction, GameState, Identity, PlayerState } from '../../src/engine/types';

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
  character: string;
  faction: Faction;
  identity?: Identity;
  health?: number;
  maxHealth?: number;
  skills?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction,
    identity: opts.identity,
  };
}

function buildState(opts: {
  lordIdentity?: Identity;
  p1Faction?: Faction;
  judgeCard?: Card;
}): GameState {
  const cards: Record<string, Card> = {};
  const deck: string[] = [];
  if (opts.judgeCard) {
    cards[opts.judgeCard.id] = opts.judgeCard;
    deck.push(opts.judgeCard.id);
  }
  return createGameState({
    players: [
      // P0 = 董卓(主公,暴虐 owner)
      makePlayer({
        index: 0,
        name: 'P0',
        character: '董卓',
        faction: '群',
        identity: opts.lordIdentity ?? '主公',
        health: 3,
        maxHealth: 8,
        skills: ['暴虐'],
      }),
      // P1 = 造成伤害的角色
      makePlayer({
        index: 1,
        name: 'P1',
        character: '貂蝉',
        faction: opts.p1Faction ?? '群',
      }),
      // P2 = 受害者
      makePlayer({
        index: 2,
        name: 'P2',
        character: '曹操',
        faction: '魏',
        health: 4,
      }),
    ],
    cardMap: cards,
    zones: { deck, discardPile: [], processing: [] },
    currentPlayerIndex: 1,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

/** 直接触发 P1→P2 造成伤害,等稳定 */
async function dealDamage(harness: SkillTestHarness, source = 1): Promise<void> {
  void runDamageFlow(harness.state, source, 2, 1);
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('暴虐', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:群雄伤害 → 黑桃判定 → 回复 ───────────────────

  it('群雄角色造成伤害 → 董卓确认判定 → 黑桃 → 回复1点体力', async () => {
    const judge = makeCard('j1', '杀', '♠', '7'); // 黑桃判定牌
    const state = buildState({ judgeCard: judge });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const hpBefore = harness.state.players[0].health;

    await dealDamage(harness);

    // 暴虐询问
    P0.expectPending('请求回应');
    await P0.respond('暴虐', { choice: true }); // 确认判定

    // 判定为黑桃 → 回复1点
    expect(harness.state.players[0].health).toBe(hpBefore + 1);
  });

  // ─── 负面:非黑桃判定 → 不回复 ───────────────────────────

  it('群雄角色造成伤害 → 红桃判定 → 不回复', async () => {
    const judge = makeCard('j1', '杀', '♥', '7'); // 红桃
    const state = buildState({ judgeCard: judge });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const hpBefore = harness.state.players[0].health;

    await dealDamage(harness);

    P0.expectPending('请求回应');
    await P0.respond('暴虐', { choice: true });

    // 红桃 → 不回复
    expect(harness.state.players[0].health).toBe(hpBefore);
    // 判定牌进入弃牌堆
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 负面:拒绝判定 → 不判定 ─────────────────────────────

  it('群雄角色造成伤害 → 董卓拒绝 → 不判定不回复', async () => {
    const judge = makeCard('j1', '杀', '♠', '7');
    const state = buildState({ judgeCard: judge });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const hpBefore = harness.state.players[0].health;

    await dealDamage(harness);

    P0.expectPending('请求回应');
    await P0.pass(); // 拒绝判定

    expect(harness.state.players[0].health).toBe(hpBefore);
    // 未发生暴虐判定(弃牌堆无判定牌)
    expect(harness.state.zones.discardPile).not.toContain('j1');
  });

  // ─── 负面:非群雄角色 → 不触发 ───────────────────────────

  it('魏势力角色造成伤害 → 暴虐不触发', async () => {
    const judge = makeCard('j1', '杀', '♠', '7');
    const state = buildState({ judgeCard: judge, p1Faction: '魏' });
    await harness.setup(state);
    const hpBefore = harness.state.players[0].health;

    await dealDamage(harness);

    // 无询问
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(hpBefore);
  });

  // ─── 负面:董卓非主公 → 不触发 ───────────────────────────

  it('董卓非主公 → 暴虐不触发', async () => {
    const judge = makeCard('j1', '杀', '♠', '7');
    const state = buildState({ judgeCard: judge, lordIdentity: '忠臣' });
    await harness.setup(state);
    const hpBefore = harness.state.players[0].health;

    await dealDamage(harness);

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(hpBefore);
  });

  // ─── 负面:自己造成伤害 → 不触发 ─────────────────────────

  it('董卓自己造成伤害 → 暴虐不触发', async () => {
    const judge = makeCard('j1', '杀', '♠', '7');
    const state = buildState({ judgeCard: judge });
    await harness.setup(state);
    const hpBefore = harness.state.players[0].health;

    // source=0(董卓自己)造成伤害
    await dealDamage(harness, 0);

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(hpBefore);
  });
});
