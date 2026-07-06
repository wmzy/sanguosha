// 八阵(卧龙诸葛·锁定技)测试:
//   没有装备防具时,视为装备着八卦阵(询问闪 before-hook:判定,红色视为出闪)。
//
// 验证:
//   1. 正面:无防具 + 判定红♥ → 发动八阵 → 不扣血(虚拟闪抵消)
//   2. 正面:无防具 + 判定红♦ → 同样视为出闪
//   3. 正面:无防具 + 判定黑♠ → 不视为闪 → 不发动效果 → 扣血
//   4. 正面:装备防具后八阵失效(由装备防具技接管,八阵 before-hook 不触发)
//   5. 正面:玩家选不发动八阵 → 正常询问闪
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeEquip(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '卧龙诸葛',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['八阵'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildState(opts: {
  p1Equipment?: Record<string, string>;
  deck?: string[];
  p1Hand?: string[];
  p2Hand?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: opts.p1Hand ?? [],
        skills: ['闪', '八阵'],
        equipment: opts.p1Equipment,
      }),
      makePlayer({ index: 1, name: 'P2', hand: opts.p2Hand ?? ['s1'], skills: ['杀'] }),
    ],
    cardMap: { s1: makeCard('s1', '杀', '♠', 'A'), ...(opts.extraCards ?? {}) },
    zones: { deck: opts.deck ?? [], discardPile: [], processing: [] },
    currentPlayerIndex: 1, // P2 的回合
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('八阵', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 无防具 + 判定红♥ → 视为出闪 ─────────────────────────────
  it('无防具:判定红♥ → 发动八阵 → 不扣血(虚拟闪抵消)', async () => {
    const judgeCard = makeCard('j1', '桃', '♥', '5');
    const state = buildState({ deck: ['j1'], extraCards: { j1: judgeCard } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    expect(harness.state.players[0].equipment['防具']).toBeUndefined();

    await P2.useCardAndTarget('杀', 's1', [0]);
    // 询问是否发动八阵
    P1.expectPending('请求回应');
    await P1.respond('八阵', { choice: true });

    // 判定红♥ → 视为出闪 → 不扣血,不再询问出闪
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('j1');
    P1.expectNoPending();
    P1.processEvents();
    P1.expectView((v) => expect(v.players[0].health).toBe(4));
  });

  // ─── 2. 无防具 + 判定红♦ → 视为出闪 ─────────────────────────────
  it('无防具:判定红♦ → 发动八阵 → 视为出闪', async () => {
    const judgeCard = makeCard('j1', '杀', '♦', '7');
    const state = buildState({ deck: ['j1'], extraCards: { j1: judgeCard } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 's1', [0]);
    P1.expectPending('请求回应');
    await P1.respond('八阵', { choice: true });

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 3. 无防具 + 判定黑♠ → 不视为闪 → 扣血 ──────────────────────
  it('无防具:判定黑♠ → 发动八阵 → 判黑 → 不出闪 → 扣1血', async () => {
    const judgeCard = makeCard('j1', '杀', '♠', '5');
    const state = buildState({ deck: ['j1'], extraCards: { j1: judgeCard } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 's1', [0]);
    P1.expectPending('请求回应');
    await P1.respond('八阵', { choice: true });
    // 判黑 → 进入询问闪 → P1 不出闪 → 扣血
    await P1.pass();

    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 4. 装备防具后八阵失效 ───────────────────────────────────────
  it('装备防具后八阵失效:不出现 八阵/confirm 询问,正常询问闪', async () => {
    // 给 P1 防具栏位占位(八阵 noArmor() 返回 false → before-hook 不触发)。
    // 无防御技 → 正常询问闪 → 不出闪 → 扣血。关键:不出现 八阵/confirm。
    const armor = makeEquip('rw', '仁王盾', '♣', '防具', 'A');
    const state = buildState({
      p1Equipment: { 防具: 'rw' },
      extraCards: { rw: armor },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    expect(harness.state.players[0].equipment['防具']).toBe('rw');

    await P2.useCardAndTarget('杀', 's1', [0]);
    // 八阵失效(有防具),不应出现 八阵/confirm 询问,直接进入询问闪
    P1.expectPending('询问闪');
    for (const slot of harness.state.pendingSlots.values()) {
      const rt = (slot.atom as { requestType?: string }).requestType;
      expect(rt).not.toBe('八阵/confirm');
    }
    await P1.pass();
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 5. 玩家选不发动八阵 → 正常询问闪 ────────────────────────────
  it('不发动八阵(choice=false)→ 正常询问闪 → 不出闪 → 扣血', async () => {
    const judgeCard = makeCard('j1', '桃', '♥', '5');
    const state = buildState({ deck: ['j1'], extraCards: { j1: judgeCard } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 's1', [0]);
    P1.expectPending('请求回应');
    await P1.respond('八阵', { choice: false }); // 不发动
    // 进入询问闪 → P1 不出闪 → 扣血
    await P1.pass();

    expect(harness.state.players[0].health).toBe(3);
  });
});
