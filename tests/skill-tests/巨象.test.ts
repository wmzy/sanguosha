// 巨象(祝融·锁定技)行为测试:
//   1. 南蛮入侵对祝融无效:不被询问出杀、不受伤害,且结算后祝融获得该南蛮入侵
//   2. 祝融自己使用的南蛮入侵不被巨象获得(只获得"其他角色"使用的)
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

function mkPlayer(opts: {
  index: number;
  name: string;
  character: string;
  hand?: string[];
  skills?: string[];
  health?: number;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
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

/** pass 掉无懈可击广播窗口(请求回应 pending) */
async function passIfRespond(harness: SkillTestHarness): Promise<void> {
  const slot = [...harness.state.pendingSlots.values()][0];
  if (slot && (slot.atom as { type: string }).type === '请求回应') {
    await harness.player(0).pass();
  }
}

describe('巨象', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('南蛮入侵对祝融无效,且祝融获得其他角色使用的南蛮入侵', async () => {
    const nanman = mkCard('nm1', '南蛮入侵', '♠', '7', '锦囊牌');
    const zKill = mkCard('k1b', '杀', '♠', '3');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '祝融',
            character: '祝融',
            hand: [zKill.id],
            skills: ['巨象', '杀'],
            health: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '反',
            hand: [nanman.id],
            skills: ['南蛮入侵'],
          }),
        ],
        cardMap: { nm1: nanman, k1b: zKill },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');

    // P1 使用南蛮入侵(唯一其他目标 = 祝融)
    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // 过无懈可击窗口
    await passIfRespond(harness);
    await harness.waitForStable();

    // 祝融不被询问出杀(巨象 cancel),且不受伤害
    expect(harness.state.players[0].health).toBe(4);
    // 祝融未出杀(杀仍在手牌)
    expect(harness.state.players[0].hand).toContain('k1b');
    // 无 pending 残留
    expect(harness.state.pendingSlots.size).toBe(0);

    // 巨象效果B:祝融获得该南蛮入侵(从弃牌堆移到手牌)
    expect(harness.state.players[0].hand).toContain('nm1');
    // 弃牌堆不再含该南蛮入侵(已被祝融捡走)
    expect(harness.state.zones.discardPile).not.toContain('nm1');
  });

  it('祝融自己使用的南蛮入侵不被巨象获得', async () => {
    const nanman = mkCard('nm2', '南蛮入侵', '♥', '7', '锦囊牌');

    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '祝融',
            character: '祝融',
            hand: [nanman.id],
            skills: ['巨象', '南蛮入侵'],
            health: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '反',
            hand: [],
            skills: [],
            health: 4,
          }),
        ],
        cardMap: { nm2: nanman },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const ZR = harness.player('祝融');

    // 祝融使用南蛮入侵(目标 P1)
    await ZR.useCardAndTarget('南蛮入侵', 'nm2', []);
    // 过无懈可击窗口
    await passIfRespond(harness);
    // P1 被询问出杀 → 无杀,pass(超时)→ 受 1 点伤害
    await harness.waitForStable();
    if (harness.state.pendingSlots.size > 0) {
      await harness.player('P1').pass();
    }
    await harness.waitForStable();

    // P1 受 1 点伤害(南蛮结算完成)
    expect(harness.state.players[1].health).toBe(3);
    // 南蛮入侵结算后进入弃牌堆(祝融是使用者,巨象不获得)
    expect(harness.state.zones.discardPile).toContain('nm2');
    // 祝融手牌不再含该南蛮入侵(已使用,未重新获得)
    expect(harness.state.players[0].hand).not.toContain('nm2');
  });
});
