// tests/skill-tests/奋威.test.ts
// 奋威(界甘宁·限定技)测试:
//   当一张锦囊牌指定多个目标后,你可以令此牌对任意个目标无效。
//
// 验证:
//   1. 正面:南蛮入侵多目标 → 奋威触发 → 选目标令其无效 → 该目标跳过结算
//   2. 限定技:整局一次,第二次多目标锦囊不再触发
//   3. 不发动:奋威确认面板选"不发动" → 无效果,限定技未消耗
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♥' || suit === '♦' ? '红' : '黑', rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界甘宁',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['奇袭', '奋威'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

describe('奋威', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:南蛮入侵 + 奋威令 P3 无效 ─────────────────────

  it('南蛮入侵指定多目标 → 奋威令P3无效 → P3不受伤害,P1受伤害', async () => {
    const south = makeCard('south', '南蛮入侵', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '界甘宁', hand: [], skills: ['奇袭', '奋威'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['south'],
          skills: ['南蛮入侵'],
        }),
        makePlayer({ index: 2, name: 'P3', character: '刘备', hand: [], skills: [] }),
      ],
      cardMap: { south },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P2 使用南蛮入侵(targets = [P3, P1] 顺时针 from P2)
    await P2.useCard('南蛮入侵', 'south');

    // 奋威确认面板弹出(给 P1)
    P1.processEvents();
    // P1 确认发动奋威
    await P1.respond('奋威', { choice: true });

    // 奋威多选面板:选择 P3(座次2)令其无效
    await P1.respond('奋威', { targets: [2] });

    // P3 被奋威无效 → 无懈窗口被取消 → 跳过P3
    // 接下来是 P1 的无懈窗口(broadcast)
    await P1.pass();

    // P1 的询问杀(南蛮要求出杀)
    await P1.pass(); // P1 不出杀 → 受1点伤害

    // 验证:P3 未受伤害(被奋威无效),P1 受1点伤害
    expect(harness.state.players[2].health).toBe(4); // P3 无伤
    expect(harness.state.players[0].health).toBe(3); // P1 受伤
    // 奋威标记为已使用(限定技)
    expect(harness.state.players[0].vars['奋威/used']).toBe(true);
    // 南蛮入侵牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('south');
  });

  // ─── 限定技:整局一次 ─────────────────────────────────

  it('奋威已使用 → 第二次南蛮入侵不再触发', async () => {
    const south1 = makeCard('south1', '南蛮入侵', '♠', 'A', '锦囊牌');
    const south2 = makeCard('south2', '南蛮入侵', '♠', '2', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '界甘宁', hand: [], skills: ['奇袭', '奋威'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['south1', 'south2'],
          skills: ['南蛮入侵'],
        }),
        makePlayer({ index: 2, name: 'P3', character: '刘备', hand: [], skills: [] }),
      ],
      cardMap: { south1, south2 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 预设奋威已使用
    state.players[0].vars['奋威/used'] = true;

    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P2 使用南蛮入侵
    await P2.useCard('南蛮入侵', 'south1');

    // 奋威不应触发(已使用)→ 直接进入无懈窗口
    // P3 的无懈窗口
    await P1.pass();
    // P3 的询问杀
    await harness.player('P3').pass();
    // P1 的无懈窗口
    await P1.pass();
    // P1 的询问杀
    await P1.pass();

    // P3 和 P1 都受伤害(奋威未介入)
    expect(harness.state.players[2].health).toBe(3);
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 不发动:确认面板选不发动 ──────────────────────────

  it('奋威确认选不发动 → 无效果,限定技未消耗', async () => {
    const south = makeCard('south', '南蛮入侵', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '界甘宁', hand: [], skills: ['奇袭', '奋威'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['south'],
          skills: ['南蛮入侵'],
        }),
        makePlayer({ index: 2, name: 'P3', character: '刘备', hand: [], skills: [] }),
      ],
      cardMap: { south },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCard('南蛮入侵', 'south');

    // 奋威确认面板 → 选不发动(pass = 超时 = 不发动)
    await P1.pass();

    // P3 的无懈窗口 → P3 询问杀
    await P1.pass();
    await harness.player('P3').pass();
    // P1 的无懈窗口 → P1 询问杀
    await P1.pass();
    await P1.pass();

    // P3 和 P1 都受伤害(奋威未发动)
    expect(harness.state.players[2].health).toBe(3);
    expect(harness.state.players[0].health).toBe(3);
    // 限定技未消耗
    expect(harness.state.players[0].vars['奋威/used']).toBeUndefined();
  });
});
