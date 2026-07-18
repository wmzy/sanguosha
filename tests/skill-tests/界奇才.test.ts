// tests/skill-tests/界奇才.test.ts
// 界奇才(界黄月英·锁定技):
//   OL 官方(hero/442):"锁定技,你使用锦囊牌无距离限制。
//   当其他角色弃置你装备区里的防具或宝物牌时,你防止之。"
//
// 与标奇才差异:
//   - 标版仅"无距离限制";界版新增"防止他人弃你装备区的防具或宝物"
//
// 验证:
//   1. 单元:onInit 后 owner.tags 含「奇才/无距离限制」
//   2. 单元:onInit 后 owner.tags 含「奇才/防具保护」
//   3. 单元:onInit 后 owner.tags 含「奇才/宝物保护」(界版新增)
//   4. 触发:无距离限制(顺手牵羊打距离 2 目标)
//   5. 关键:过河拆桥不能弃界黄月英的防具
//   6. 关键(界版新增):过河拆桥不能弃界黄月英的宝物
//   7. 边界:过河拆桥仍可弃界黄月英的武器(未受保护)
//   8. 边界:过河拆桥仍可弃界黄月英的手牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
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

describe('界奇才', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1-3. 单元:onInit 后三个保护标签均注入 ─────────────────
  it('onInit 后 owner.tags 含全部三个奇才保护标签', async () => {
    const sq = makeCard('sq1', '顺手牵羊', '♠', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['sq1'], skills: ['界奇才', '顺手牵羊'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { sq1: sq },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const tags = harness.state.players[0].tags;
    expect(tags).toContain('奇才/无距离限制');
    expect(tags).toContain('奇才/防具保护');
    expect(tags).toContain('奇才/宝物保护'); // 界版新增
  });

  // ─── 4. 触发:无距离限制(顺手牵羊打距离 2 目标)────────────
  it('P0(界奇才)对距离 2 的 P3 用顺手牵羊 → validate 通过(忽略距离)', async () => {
    const sq = makeCard('sq1', '顺手牵羊', '♠', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['sq1'], skills: ['界奇才', '顺手牵羊'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
        makePlayer({ index: 2, name: 'P3', hand: ['v1'], skills: [] }),
        makePlayer({ index: 3, name: 'P4', skills: [] }),
      ],
      cardMap: {
        sq1: sq,
        v1: makeCard('v1', '杀', '♥', '5', '基本牌'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 距离 2(座位距离 2,无进攻修正),奇才忽略距离 → validate 通过
    await P1.triggerAction('顺手牵羊', 'use', { cardId: 'sq1', target: 2 });
    P1.expectPending('请求回应');
    expect(harness.state.players[0].hand).not.toContain('sq1');
  });

  // ─── 5. 关键:过河拆桥不能弃界黄月英的防具 ────────────────
  it('过河拆桥目标 P2(界奇才)→ 防具在选牌面板不可选(防具保护)', async () => {
    const gq = makeCard('gq1', '过河拆桥', '♠', '3');
    const armor = makeCard('ar1', '八卦阵', '♠', '2', '装备牌');
    // P2 还有手牌,确保过河拆桥 validate 通过
    const v1 = makeCard('v1', '杀', '♥', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['gq1'], skills: ['过河拆桥'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['v1'],
          equipment: { 防具: 'ar1' },
          skills: ['界奇才'],
        }),
      ],
      cardMap: { gq1: gq, ar1: armor, v1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass(); // 无懈窗口

    // 选牌面板:尝试选防具应被拒(防具保护)
    await P1.expectRejected({
      skillId: '过河拆桥',
      actionType: 'respond',
      params: { zone: 'equipment', cardId: 'ar1' },
    });
  });

  // ─── 6. 关键(界版新增):过河拆桥不能弃界黄月英的宝物 ──────
  it('过河拆桥目标 P2(界奇才)→ 宝物在选牌面板不可选(宝物保护,界版新增)', async () => {
    const gq = makeCard('gq1', '过河拆桥', '♠', '3');
    const treasure = makeCard('tr1', '木牛流马', '♦', 'A', '装备牌');
    const v1 = makeCard('v1', '杀', '♥', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['gq1'], skills: ['过河拆桥'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['v1'],
          equipment: { 宝物: 'tr1' },
          skills: ['界奇才'],
        }),
      ],
      cardMap: { gq1: gq, tr1: treasure, v1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();

    // 选牌面板:尝试选宝物应被拒(宝物保护)
    await P1.expectRejected({
      skillId: '过河拆桥',
      actionType: 'respond',
      params: { zone: 'equipment', cardId: 'tr1' },
    });
  });

  // ─── 7. 边界:过河拆桥仍可弃界黄月英的武器 ────────────────
  it('过河拆桥目标 P2(界奇才)→ 武器仍可被弃(武器未受保护)', async () => {
    const gq = makeCard('gq1', '过河拆桥', '♠', '3');
    const weapon = makeCard('wp1', '诸葛连弩', '♠', '1', '装备牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['gq1'], skills: ['过河拆桥'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          equipment: { 武器: 'wp1' },
          skills: ['界奇才'],
        }),
      ],
      cardMap: { gq1: gq, wp1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'equipment', cardId: 'wp1' });

    // 武器被弃置
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('wp1');
  });

  // ─── 8. 边界:过河拆桥目标只有防具+宝物时被拒(无可弃牌)────
  it('过河拆桥目标 P2(界奇才)装备区仅防具+宝物 → validate 拒绝(无可弃牌)', async () => {
    const gq = makeCard('gq1', '过河拆桥', '♠', '3');
    const armor = makeCard('ar1', '八卦阵', '♠', '2', '装备牌');
    const treasure = makeCard('tr1', '木牛流马', '♦', 'A', '装备牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['gq1'], skills: ['过河拆桥'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          equipment: { 防具: 'ar1', 宝物: 'tr1' },
          skills: ['界奇才'],
        }),
      ],
      cardMap: { gq1: gq, ar1: armor, tr1: treasure },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P2 装备区仅防具+宝物(均受保护)+ 无手牌 + 无判定 → 过河拆桥无牌可弃
    await P1.expectRejected({
      skillId: '过河拆桥',
      actionType: 'use',
      params: { cardId: 'gq1', targets: [1] },
    });
  });
});
