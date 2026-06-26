// tests/skill-tests/青龙偃月刀.test.ts
// 青龙偃月刀(武器,攻击范围 3):
//   你使用的【杀】被【闪】抵消后,你可以对相同目标再使用 1 张杀。
//   可以连续追击直到命中或无杀可用。
//
// 完整链路:P1 出杀 → P2 出闪 → 青龙偃月刀 after hook:
//   1. confirm 询问"是否追杀"
//   2. 玩家选追杀 → useCard prompt 选 1 张杀牌(消耗手牌中的杀)
//   3. 新杀进处理区 + 移走旧闪 → 再次询问闪
//
// 验证:
//   1. 正面:P2 出闪,P1 confirm+出杀 → 追杀成功,P2 扣血(且消耗了杀牌)
//   2. 连续追杀:第一次追杀被闪,第二次追杀命中
//   3. 不追杀:confirm=false → 正常被闪,不扣血,不消耗杀牌
//   4. 追杀杀命中:P2 不出闪 → 扣血(追杀的杀被消耗)
//   5. 无杀可用:owner 手牌没杀 → 不触发 confirm(直接被闪)
//   6. confirm 后超时不出杀 → 放弃追杀(不凭空杀人)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
  return { id, name, suit, rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

const QINGLONG = makeCard('ql', '青龙偃月刀', '♠', '5', '装备牌');

describe('青龙偃月刀', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:P2 出闪 → P1 追杀(出杀)→ P2 不出闪 → 命中 ─────────

  it('用例1:P2 出闪,P1 确认追杀并出一张杀 → P2 扣血,杀牌被消耗', async () => {
    const kill1 = makeCard('k1', '杀', '♠', '7');
    const kill2 = makeCard('k2', '杀', '♠', '8');
    const dodge1 = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'k2'], skills: ['杀', '青龙偃月刀'], equipment: { 武器: 'ql' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { ql: QINGLONG, k1: kill1, k2: kill2, d1: dodge1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀指定 P2
    await P1.useCardAndTarget('杀', 'k1', [1]);

    // P2 出闪
    await P2.respond('闪', { cardId: 'd1' });

    // 青龙偃月刀 after hook 触发:confirm 询问 P1 是否追杀
    expect(harness.state.pendingSlots.get(0)).toBeDefined();
    await P1.respond('青龙偃月刀', { choice: true });

    // 接着 useCard prompt 让 P1 选一张杀追杀
    await P1.respond('青龙偃月刀', { cardId: 'k2' });

    // P2 被再次询问闪,但已无闪 → pass(超时不出)
    await P2.pass();

    // 追杀命中:P2 扣血
    expect(harness.state.players[1].health).toBe(3);
    // k2(追杀的杀)进弃牌堆——证明消耗了杀牌
    expect(harness.state.zones.discardPile).toContain('k2');
    // k1(原始杀)也进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    // d1(闪)进弃牌堆
    expect(harness.state.zones.discardPile).toContain('d1');
    // P1 手牌空了(k1+k2 都出了)
    expect(harness.state.players[0].hand).toHaveLength(0);
  });

  // ─── 连续追杀:第一次追杀被闪,第二次追杀命中 ──────────────

  it('用例2:P2 连续出两次闪,P1 连续追杀两次 → 第二次命中', async () => {
    const kill1 = makeCard('k1', '杀', '♠', '7');
    const kill2 = makeCard('k2', '杀', '♠', '8');
    const kill3 = makeCard('k3', '杀', '♠', '9');
    const dodge1 = makeCard('d1', '闪', '♦', '2');
    const dodge2 = makeCard('d2', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'k2', 'k3'], skills: ['杀', '青龙偃月刀'], equipment: { 武器: 'ql' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1', 'd2'], skills: ['闪'] }),
      ],
      cardMap: { ql: QINGLONG, k1: kill1, k2: kill2, k3: kill3, d1: dodge1, d2: dodge2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 第一次出杀
    await P1.useCardAndTarget('杀', 'k1', [1]);
    // P2 第一次出闪
    await P2.respond('闪', { cardId: 'd1' });
    // P1 确认追杀 + 出第二张杀
    await P1.respond('青龙偃月刀', { choice: true });
    await P1.respond('青龙偃月刀', { cardId: 'k2' });
    // P2 第二次出闪
    await P2.respond('闪', { cardId: 'd2' });
    // P1 再次确认追杀 + 出第三张杀
    await P1.respond('青龙偃月刀', { choice: true });
    await P1.respond('青龙偃月刀', { cardId: 'k3' });
    // P2 无闪了 → pass
    await P2.pass();

    // 第二次追杀命中:P2 扣血
    expect(harness.state.players[1].health).toBe(3);
    // 三张杀都进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.zones.discardPile).toContain('k2');
    expect(harness.state.zones.discardPile).toContain('k3');
    // 两张闪都进弃牌堆
    expect(harness.state.zones.discardPile).toContain('d1');
    expect(harness.state.zones.discardPile).toContain('d2');
    // P1 手牌空
    expect(harness.state.players[0].hand).toHaveLength(0);
  });

  // ─── 不追杀:confirm=false → 正常被闪 ─────────────────────

  it('用例3:confirm=false → 正常被闪,不扣血,不消耗追杀杀牌', async () => {
    const kill1 = makeCard('k1', '杀', '♠', '7');
    const kill2 = makeCard('k2', '杀', '♠', '8');
    const dodge1 = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'k2'], skills: ['杀', '青龙偃月刀'], equipment: { 武器: 'ql' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { ql: QINGLONG, k1: kill1, k2: kill2, d1: dodge1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀,P2 出闪
    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });

    // P1 选择不追杀
    await P1.confirm(false);

    // 正常被闪:P2 不扣血
    expect(harness.state.players[1].health).toBe(4);
    // k1 进弃牌堆(原始杀),k2 留在手中(没追杀)
    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.players[0].hand).toContain('k2');
  });

  // ─── 无杀可用:owner 手牌没杀 → 不触发 confirm ───────────

  it('用例4:owner 手牌没杀 → 不触发 confirm(直接被闪)', async () => {
    const kill1 = makeCard('k1', '杀', '♠', '7');
    const peach = makeCard('p1', '桃', '♥', '3');
    const dodge1 = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'p1'], skills: ['杀', '青龙偃月刀'], equipment: { 武器: 'ql' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { ql: QINGLONG, k1: kill1, p1: peach, d1: dodge1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀(k1 是唯一杀),P2 出闪
    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });

    // P1 手牌只剩桃(没杀)→ 不应触发 confirm,直接被闪
    expect(harness.state.pendingSlots.has(0)).toBe(false);
    expect(harness.state.players[1].health).toBe(4);
    // k1 进弃牌堆,p1 留手
    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.players[0].hand).toContain('p1');
  });

  // ─── confirm 后超时不出杀 → 放弃追杀(不凭空杀人)────────

  it('用例5:confirm 追杀后超时不出杀牌 → 放弃追杀,不扣血', async () => {
    const kill1 = makeCard('k1', '杀', '♠', '7');
    const kill2 = makeCard('k2', '杀', '♠', '8');
    const dodge1 = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'k2'], skills: ['杀', '青龙偃月刀'], equipment: { 武器: 'ql' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { ql: QINGLONG, k1: kill1, k2: kill2, d1: dodge1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀,P2 出闪
    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });

    // P1 确认追杀
    await P1.respond('青龙偃月刀', { choice: true });

    // 但在选杀阶段超时(pass)
    await P1.pass();

    // 放弃追杀:P2 不扣血(没有凭空杀人)
    expect(harness.state.players[1].health).toBe(4);
    // k2 留在手中(没消耗)
    expect(harness.state.players[0].hand).toContain('k2');
  });

  // ─── 追杀的杀被闪抵消,不继续追杀 ─────────────────────

  it('用例6:追杀的杀被闪抵消,不继续追杀 → 不扣血', async () => {
    const kill1 = makeCard('k1', '杀', '♠', '7');
    const kill2 = makeCard('k2', '杀', '♠', '8');
    const dodge1 = makeCard('d1', '闪', '♦', '2');
    const dodge2 = makeCard('d2', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'k2'], skills: ['杀', '青龙偃月刀'], equipment: { 武器: 'ql' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1', 'd2'], skills: ['闪'] }),
      ],
      cardMap: { ql: QINGLONG, k1: kill1, k2: kill2, d1: dodge1, d2: dodge2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀,P2 出闪
    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });

    // P1 确认追杀 + 出第二张杀
    await P1.respond('青龙偃月刀', { choice: true });
    await P1.respond('青龙偃月刀', { cardId: 'k2' });

    // P2 对追杀的杀也出闪
    await P2.respond('闪', { cardId: 'd2' });

    // P1 选择不继续追杀(手牌已无杀)
    // 此时 P1 无杀,confirm 不触发,直接结束
    expect(harness.state.pendingSlots.has(0)).toBe(false);

    // 没命中:P2 不扣血
    expect(harness.state.players[1].health).toBe(4);
    // 两张杀和两张闪都进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.zones.discardPile).toContain('k2');
    expect(harness.state.zones.discardPile).toContain('d1');
    expect(harness.state.zones.discardPile).toContain('d2');
  });

  // ─── respond 校验:useKill 阶段只能出杀 ─────────────────

  it('用例7:useKill 阶段选非杀牌 → 拒绝', async () => {
    const kill1 = makeCard('k1', '杀', '♠', '7');
    const kill2 = makeCard('k2', '杀', '♠', '8');
    const peach = makeCard('p1', '桃', '♥', '3');
    const dodge1 = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'k2', 'p1'], skills: ['杀', '青龙偃月刀'], equipment: { 武器: 'ql' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { ql: QINGLONG, k1: kill1, k2: kill2, p1: peach, d1: dodge1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀(k1),P2 出闪
    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 'd1' });

    // P1 确认追杀
    await P1.respond('青龙偃月刀', { choice: true });

    // P1 试图用桃追杀 → 应被拒绝(validate 返回错误,pending 不 resolve)
    await P1.respond('青龙偃月刀', { cardId: 'p1' });
    // pending 仍在(被拒绝后 pending 未 resolve)
    expect(harness.state.pendingSlots.get(0)).toBeDefined();
    // p1 仍在手中(没被消耗)
    expect(harness.state.players[0].hand).toContain('p1');
    // 正确出杀 k2
    await P1.respond('青龙偃月刀', { cardId: 'k2' });
    // P2 无闪 → pass
    await P2.pass();
    // 命中
    expect(harness.state.players[1].health).toBe(3);
  });
});
