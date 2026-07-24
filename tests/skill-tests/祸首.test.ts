// 祸首(孟获)行为测试:
//   1. 南蛮入侵对孟获无效:孟获不被询问出杀,且不受伤害
//   2. 孟获是南蛮入侵伤害来源:其他角色受南蛮伤害时来源=孟获
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

const NANMAN = mkCard('nm1', '南蛮入侵', '♠', '7', '锦囊牌');

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

/** 若当前 pending 是无懈可击广播窗口(请求回应),则 pass 掉。 */
async function passWuxieIfAny(harness: SkillTestHarness, p: { pass: () => Promise<void> }): Promise<void> {
  const slot = [...harness.state.pendingSlots.values()][0];
  if (slot && (slot.atom as { type: string }).type === '请求回应') {
    await p.pass();
  }
}

describe('祸首', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('南蛮入侵对孟获无效:不被询问出杀,不受伤害', async () => {
    const mengKill = mkCard('mk1', '杀', '♠', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孟获', character: '孟获', hand: [mengKill.id], skills: ['祸首', '杀'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', hand: [NANMAN.id], skills: ['南蛮入侵'] }),
        ],
        cardMap: { mk1: mengKill, nm1: NANMAN },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const meng = harness.player('孟获');

    // P1 使用南蛮入侵(唯一其他目标 = 孟获)
    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // 过无懈可击窗口
    await passWuxieIfAny(harness, P1);

    // 孟获不被询问出杀(祸首 询问杀 hook cancel),无 pending → 流程应已稳定
    await harness.waitForStable();
    // 孟获未出杀(杀仍在手牌),且未受伤
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].hand).toContain('mk1');
    // 无 询问杀 pending 残留
    expect(harness.state.pendingSlots.size).toBe(0);
    void meng;
  });

  it('孟获是南蛮入侵伤害来源:其他角色受伤时来源=孟获', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孟获', character: '孟获', hand: [], skills: ['祸首', '杀'] }),
          mkPlayer({ index: 1, name: 'P1', character: '反', hand: [NANMAN.id], skills: ['南蛮入侵'] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', hand: [], skills: ['杀'] }),
        ],
        cardMap: { nm1: NANMAN },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 使用南蛮入侵,目标顺序 [P2(2), 孟获(0)]
    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);

    // 第一个目标 P2:过无懈窗口 → 询问杀 → P2 无杀 pass → 受伤(来源改为孟获)
    await passWuxieIfAny(harness, P1);
    P2.expectPending('询问杀');
    await P2.pass();

    // 第二个目标 孟获:过无懈窗口(孟获免疫:不被询问杀、不受伤害)
    await passWuxieIfAny(harness, P1);
    await harness.waitForStable();

    // P2 受 1 点伤害
    expect(harness.state.players[2].health).toBe(3);
    // 孟获未受伤
    expect(harness.state.players[0].health).toBe(4);
    // 关键契约:伤害来源 = 孟获(0),而非使用者 P1(1)
    // 新流程:伤害走 runDamageFlow,不再有 造成伤害 atom。检查 受到伤害后 时机 atom 的 source。
    const damageAtom = harness.state.atomHistory.find(
      (e) =>
        e.kind === 'atom' &&
        (e as { atom?: { type?: string; target?: number } }).atom?.type === '受到伤害后' &&
        (e as { atom?: { target?: number } }).atom?.target === 2,
    );
    expect(damageAtom).toBeTruthy();
    expect((damageAtom as { atom?: { source?: number } }).atom?.source).toBe(0);
  });
});
