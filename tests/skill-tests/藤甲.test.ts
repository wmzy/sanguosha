// 藤甲(防具):锁定技,南蛮入侵/万箭齐发/普通杀对你无效;火焰伤害+1。
//
// 实现(藤甲.ts)双 hook:
//   ① 检测有效性 before-hook:普通杀(非火/雷)/南蛮/万箭 → cancel(无效,不询问闪/杀)
//   ② 受到伤害时 before-hook:火焰伤害 +1
//
// 验证:
//   1. 正面:普通杀 → 无效(不询问闪、不扣血)
//   2. 正面:真实火杀('火焰')→ +1(2 点伤害)
//   3. 分支:直接造成火焰伤害 → +1(独立验证 hook)
//   4. 正面:南蛮入侵/万箭齐发 → 无效(不询问杀/闪、不扣血)
//   5. 正面:雷杀(雷电)→ 穿透藤甲,正常 1 点伤害(属性杀不被无效)
//   6. 边界:藤甲不保护其他玩家
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { runDamageFlow } from '../../src/engine/flows/damage';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  damageType?: Card['damageType'],
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌', damageType };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  equipment?: Record<string, string>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['杀', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

const TENGJIA: Card = {
  id: 'tj',
  name: '藤甲',
  suit: '♠',
  color: suitColor('♠'),
  rank: '2',
  type: '装备牌',
  subtype: '防具',
};

describe('藤甲', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:普通杀对你无效(不询问闪) ──────────────────────────

  it('正面:普通杀对你无效 → 不询问闪,不扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7'); // 普通杀(无 damageType)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P1').useCardAndTarget('杀', 'k1', [1]);

    // 普通杀被藤甲无效:检测有效性 cancel → 不询问闪、不扣血
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 正面:真实火杀('火焰')→ 火焰伤害 +1 ──────────────────

  it('正面:真实火杀(damageType=火焰)→ 藤甲火焰 +1,1 点变 2 点', async () => {
    const fireKill = makeCard('fk1', '杀', '♥', '7', '火焰');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['fk1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, fk1: fireKill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('杀', 'fk1', [1]);
    await P2.pass();

    // 火焰伤害 +1:1 点变 2 点,扣 2 血
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 分支:直接造成火焰伤害 → +1(独立验证 hook)──────────────

  it('分支:直接造成 1 点火焰伤害 → +1 为 2 点', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接造成 1 点火焰伤害 → 藤甲 +1 → 2 点
    await runDamageFlow(harness.state, 0, 1, 1, undefined, '火焰');
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 边界:藤甲只保护装备者(目标合法性)──────────────────
  //   实现:before hook 内 `if (atom.target !== ownerId) return;` ——
  //   伤害目标非装备者时 hook 直接 pass,不修改 amount。验证藤甲不会越权替他人减伤。

  it('边界:藤甲不保护其他玩家——普通杀 P3,P3 正常扣血、P2 不受影响', async () => {
    const kill = makeCard('k2', '杀', '♠', '7');
    const shan = makeCard('s1', '闪', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k2'], skills: ['杀'] }),
        // P2 持藤甲但不是本杀的目标
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
        makePlayer({ index: 2, name: 'P3', hand: ['s1'], skills: ['闪'] }),
      ],
      cardMap: { tj: TENGJIA, k2: kill, s1: shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P3 = harness.player('P3');

    // P1 普通杀 P3(非藤甲持有者):受到伤害时 hook 因 target≠ownerId 直接 pass
    await harness.player('P1').useCardAndTarget('杀', 'k2', [2]);
    P3.expectPending('询问闪');
    await P3.pass();

    // P3 正常受 1 点伤害;藤甲持有者 P2 完全不受影响
    expect(harness.state.players[2].health).toBe(3);
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 正面:南蛮入侵/万箭齐发对你无效 ─────────────────────────

  it('正面:南蛮入侵对你无效 → 不询问杀,不扣血', async () => {
    const nm: Card = {
      id: 'nm1',
      name: '南蛮入侵',
      suit: '♥',
      color: suitColor('♥'),
      rank: 'A',
      type: '锦囊牌',
    };
    const p2kill = makeCard('p2k', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['nm1'], skills: ['南蛮入侵'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['p2k'],
          skills: ['杀', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, nm1: nm, p2k: p2kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P1').useCardAndTarget('南蛮入侵', 'nm1', []);
    await harness.player('P1').pass(); // 无懈窗口

    // 南蛮对藤甲无效:检测有效性 cancel → 不询问杀、不扣血(P2 手中杀未消耗)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[1].hand).toContain('p2k');
    expect(harness.state.zones.discardPile).toContain('nm1');
  });

  it('正面:万箭齐发对你无效 → 不询问闪,不扣血', async () => {
    const wj: Card = {
      id: 'wj1',
      name: '万箭齐发',
      suit: '♥',
      color: suitColor('♥'),
      rank: 'A',
      type: '锦囊牌',
    };
    const p2shan = makeCard('p2s', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wj1'], skills: ['万箭齐发'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['p2s'],
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, wj1: wj, p2s: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P1').useCardAndTarget('万箭齐发', 'wj1', []);
    await harness.player('P1').pass(); // 无懈窗口

    // 万箭对藤甲无效:检测有效性 cancel → 不询问闪、不扣血
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('wj1');
  });

  // ─── 正面:雷杀(雷电)穿透藤甲 ──────────────────────────────

  it('正面:雷杀(雷电)穿透藤甲 → 正常 1 点伤害', async () => {
    const thunderKill = makeCard('tk1', '杀', '♠', '7', '雷电'); // 雷杀
    const shan = makeCard('s1', '闪', '♥', '2'); // P2 带闪使询问闪可观察
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['tk1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['s1'],
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, tk1: thunderKill, s1: shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('杀', 'tk1', [1]);

    // 雷杀是属性杀,穿透藤甲(不被无效):正常询问闪
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    // 雷电伤害非火焰,藤甲不减伤 → 正常 1 点(修复前错误减为 0)
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 回归(陷阱8):装备被获得(顺手牵羊)后 hook 须动态校验防具仍在 ──
  //   获得(steal)路径只移除装备槽,不触发 移除技能(仅 弃置/装备替换 触发),
  //   故 藤甲 before-hook 须动态校验 防具 仍是藤甲(参考丈八蛇矛动态武器校核),
  //   否则失主被顺走藤甲后,陈旧 hook 仍 cancel 普通杀 / 火焰伤害仍 +1 → 与规则不符。

  it('回归:顺手牵羊顺走藤甲后,普通杀正常命中失主(检测有效性 hook 动态校验防具)', async () => {
    const kill = makeCard('k3', '杀', '♠', '7');
    const sq: Card = {
      id: 'sq1',
      name: '顺手牵羊',
      suit: '♠',
      color: suitColor('♠'),
      rank: 'J',
      type: '锦囊牌',
    };
    const p2shan = makeCard('s2', '闪', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k3', 'sq1'], skills: ['杀', '顺手牵羊'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['s2'],
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, k3: kill, sq1: sq, s2: p2shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 顺手牵羊顺走 P2 的藤甲(2 人相邻,距离 1)
    await P1.useCardAndTarget('顺手牵羊', 'sq1', [1]);
    await P1.pass(); // 无懈窗口
    await P1.respond('顺手牵羊', { zone: 'equipment', cardId: 'tj' });

    // 藤甲已被顺走:P2 装备区无防具
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();

    // P1 普通杀 P2:藤甲已不在,普通杀应正常询问闪并命中(不再被陈旧 hook 无效)
    await P1.useCardAndTarget('杀', 'k3', [1]);
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    // 失主被顺走藤甲后受 1 点伤害(陈旧 hook 不应再 cancel)
    expect(harness.state.players[1].health).toBe(3);
  });

  it('回归:顺手牵羊顺走藤甲后,受到火焰伤害不再 +1(受到伤害时 hook 动态校验防具)', async () => {
    const sq: Card = {
      id: 'sq2',
      name: '顺手牵羊',
      suit: '♠',
      color: suitColor('♠'),
      rank: '4',
      type: '锦囊牌',
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['sq2'], skills: ['顺手牵羊'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '藤甲'],
          equipment: { 防具: 'tj' },
        }),
      ],
      cardMap: { tj: TENGJIA, sq2: sq },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1 顺手牵羊顺走 P2 的藤甲
    await P1.useCardAndTarget('顺手牵羊', 'sq2', [1]);
    await P1.pass(); // 无懈窗口
    await P1.respond('顺手牵羊', { zone: 'equipment', cardId: 'tj' });

    // 藤甲已被顺走,直接对 P2 造成 1 点火焰伤害 → 藤甲不再 +1 → 仅 1 点
    await runDamageFlow(harness.state, 0, 1, 1, undefined, '火焰');
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(3);
  });
});
