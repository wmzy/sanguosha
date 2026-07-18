// 界烈弓(界黄忠·蜀·被动技,OL 界限突破官方)测试:
//   你【杀】的攻击范围为此【杀】点数。当你使用【杀】指定目标后,你可以执行以下效果:
//     1. 若其手牌数不大于你,其不能抵消此【杀】。
//     2. 若其体力值不小于你,此【杀】伤害值 +1。
//
// 验证:
//   1. 正面·攻击范围随杀点数:K(13)杀可命中超距 P3(徒手范围 1)
//   2. 正面·武器范围更优时仍以武器为准(FAQ):装备青釭剑(范围2)用 A 杀,距离2 命中
//   3. 正面·效果1(手牌不大于自己)→ 禁闪,P2 有闪也不能出
//   4. 正面·效果2(体力不小于自己)→ 加伤,+1 伤害
//   5. 正面·两条件同时满足 → 禁闪 + 加伤
//   6. 负面·条件都不满足 → 不询问,正常询问闪
//   7. 负面·条件满足但不发动 → 正常询问闪
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, Faction, Json, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  vars?: Record<string, Json>;
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界黄忠',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界烈弓'],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '蜀',
  };
}

describe('界烈弓', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面·攻击范围随杀点数 ─────────────────────────────

  it('正面: K(13)杀可命中超距目标(徒手范围1,杀点数13放宽到13)', async () => {
    // 4 人环形:P1(0)→P3(2) 座位距离 2,徒手范围 1 → 超距,但 K 杀点数 13 → 放行
    const kill = makeCard('k1', '杀', '♠', 'K'); // 点数 13
    const cardMap: Record<string, Card> = { k1: kill };
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['界烈弓', '杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          skills: ['闪'],
          faction: '魏',
        }),
        makePlayer({
          index: 2,
          name: 'P3',
          character: '刘备',
          skills: ['闪'],
          faction: '蜀',
        }),
        makePlayer({
          index: 3,
          name: 'P4',
          character: '孙权',
          skills: ['闪'],
          faction: '吴',
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // K 杀指定超距 P3(距离2 > 徒手范围1,但点数13 ≥ 2 → 放行)
    await P1.useCardAndTarget('杀', 'k1', [2]);
    // 不发动烈弓(P3 手牌0 ≤ P1 手牌0 满足条件1;但单测聚焦距离,跳过禁闪加伤)
    await P1.respond('界烈弓', { choice: false });
    // P3 不闪 → 命中
    await P3.pass();
    expect(harness.state.players[2].health).toBe(3);
  });

  it('负面: A(1)杀仍受徒手距离限制,超距 P3 被拒', async () => {
    // A 杀点数 1,徒手范围 1,P3 距离 2 → 超距
    const kill = makeCard('k1', '杀', '♠', 'A');
    const cardMap: Record<string, Card> = { k1: kill };
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['界烈弓', '杀'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', skills: [], faction: '魏' }),
        makePlayer({ index: 2, name: 'P3', character: '刘备', skills: [], faction: '蜀' }),
        makePlayer({ index: 3, name: 'P4', character: '孙权', skills: [], faction: '吴' }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // A 杀(点数1)指定超距 P3(距离2)→ 被拒
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 'k1', targets: [2] },
    });
  });

  it('FAQ: 武器范围 > 杀点数时仍以武器为准(青釭剑范围2 + A杀 → 距离2 可命中)', async () => {
    // 青釭剑攻击范围 2;A 杀点数 1。按 FAQ:max(2, 1) = 2 → P3(距离2)可命中
    const kill = makeCard('k1', '杀', '♠', 'A');
    const weapon = {
      id: 'w1',
      name: '青釭剑',
      suit: '♠' as const,
      color: '黑' as const,
      rank: '6',
      type: '装备牌' as const,
      subtype: '武器',
      range: 2,
    };
    const cardMap: Record<string, Card> = { k1: kill, w1: weapon };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          equipment: { 武器: 'w1' },
          vars: { '距离/出杀范围': 2 },
          skills: ['界烈弓', '杀'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', skills: [], faction: '魏' }),
        makePlayer({ index: 2, name: 'P3', character: '刘备', skills: [], faction: '蜀' }),
        makePlayer({ index: 3, name: 'P4', character: '孙权', skills: [], faction: '吴' }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // A 杀(点数1,但武器范围2)→ max(2,1)=2 ≥ P3 距离2 → 放行
    await P1.useCardAndTarget('杀', 'k1', [2]);
    // 不发动烈弓(P3 空手0 ≤ P1 出杀后0,条件1满足;但本测聚焦 FAQ 距离)
    await P1.respond('界烈弓', { choice: false });
    // P3 无闪 → 命中
    await P3.pass();
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 正面·效果1(手牌不大于自己 → 禁闪) ─────────────────

  it('正面: 目标手牌不大于自己 → 禁闪,P2 有闪也不能出', async () => {
    // P1 health=4 hand=[杀] → 出杀后 hand=0;P2 health=4 hand=[闪] → 出杀前 P2 手牌1
    // 条件1: P2 手牌1 > P1 手牌1(出杀前)→ 不满足。故调整:P1 多一张手牌
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const extra = makeCard('x1', '杀', '♣', '4');
    const cardMap: Record<string, Card> = { k1: kill, d1: dodge, x1: extra };
    const state = createGameState({
      players: [
        // P1 出杀前 hand=[k1, x1] (2张);指定目标后 P1 仍有 1 张(x1)。
        // 条件1判定时刻:指定目标时,P1 手牌已减(杀进处理区)?——按 杀.ts 流程,
        // 杀牌先移动到处理区,再 指定目标。故 P1 手牌=1(只剩 x1),P2 手牌=1(闪)
        // → P2 不大于 P1 (1≤1)→ 条件1满足
        // 条件2: P2 health 3 < P1 health 4 → 不满足(本例聚焦禁闪)
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1', 'x1'],
          skills: ['界烈弓', '杀'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['d1'],
          skills: ['闪'],
          health: 3,
          faction: '魏',
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应'); // 界烈弓 confirm
    await P1.respond('界烈弓', { choice: true });

    // 禁闪 → 询问闪被跳过 → 强制命中
    expect(harness.state.players[1].health).toBe(2);
    // P2 的闪仍在手里
    expect(harness.state.players[1].hand).toContain('d1');
  });

  // ─── 正面·效果2(体力不小于自己 → 加伤) ─────────────────

  it('正面: 目标体力不小于自己 → 加伤(伤害+1)', async () => {
    // P1 health=3 hand=[杀];P2 health=4 hand=[](空手,不可闪)
    // 条件1: P2 手牌0 ≤ P1 手牌1(指定目标时 P1 手牌0)→ 0≤0 满足(但同时这里测加伤)
    // 条件2: P2 health 4 ≥ P1 health 3 → 满足
    // 为聚焦加伤,使条件1不满足:P1 让 P2 多一张手牌但不出闪——这里 P2 出闪会触发禁闪
    // 误判。简化:本测两条件都满足,但仅断言伤害+1(=2)
    const kill = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: kill };
    const state = createGameState({
      players: [
        // P1 health 3 < P2 health 4 → 条件2满足
        // P1 出杀后 hand=0;P2 hand=0 → 条件1满足(0≤0)
        // P2 无闪 → 必然命中,加伤 → -2 体力
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['界烈弓', '杀'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: [],
          skills: [],
          health: 4,
          faction: '魏',
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    await P1.respond('界烈弓', { choice: true });

    // P2 空 hand → 不可闪 + 加伤 → 4 - 2 = 2
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 正面·两条件同时满足 → 禁闪 + 加伤 ──────────────────

  it('正面: 两条件同时满足 → 禁闪 + 加伤(P2 满手闪也无法出,伤害+1)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const extra = makeCard('x1', '桃', '♥', '3');
    const cardMap: Record<string, Card> = { k1: kill, d1: dodge, x1: extra };
    const state = createGameState({
      players: [
        // P1 health 3,hand=[k1,x1];出杀后 k1 进处理区,P1 hand=[x1] (1张)
        // P2 health 4 ≥ 3 → 条件2满足;P2 hand=[d1] 长度1 ≤ P1 hand 1 → 条件1满足
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1', 'x1'],
          skills: ['界烈弓', '杀'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['d1'],
          skills: ['闪'],
          health: 4,
          faction: '魏',
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    await P1.respond('界烈弓', { choice: true });

    // 两条件都满足 → 禁闪(询问闪被 cancel)+ 加伤
    // P2 有闪但被禁闪,直接命中且伤害 +1 → 4 - 2 = 2
    expect(harness.state.players[1].health).toBe(2);
    // P2 的闪仍在手里(未被使用)
    expect(harness.state.players[1].hand).toContain('d1');
  });

  // ─── 负面·条件都不满足 → 不询问 ───────────────────────

  it('负面: 条件都不满足 → 不询问烈弓,直接进入询问闪', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const extra = makeCard('x1', '杀', '♣', '4');
    const cardMap: Record<string, Card> = { k1: kill, d1: dodge, x1: extra };
    const state = createGameState({
      players: [
        // P1 health 4,hand=[k1];出杀后 hand=[] (0张)
        // P2 health 3 < 4 → 条件2不满足;P2 hand 1 > 0 → 条件1不满足(目标手牌不大于自己 → 1≤0 假)
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['界烈弓', '杀'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['d1', 'x1'],
          skills: ['闪'],
          health: 3,
          faction: '魏',
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // 条件都不满足 → 不询问烈弓,直接进入询问闪
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('询问闪');

    // P2 选择不出闪 → 命中,正常伤害 1(无加伤)
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 负面·条件满足但不发动 → 正常询问闪 ────────────────

  it('负面: 条件满足但不发动 → P2 正常出闪抵消', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const cardMap: Record<string, Card> = { k1: kill, d1: dodge };
    const state = createGameState({
      players: [
        // P1 health 3,hand=[k1];P2 health 4 ≥ 3 → 条件2满足
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['界烈弓', '杀'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['d1'],
          skills: ['闪'],
          health: 4,
          faction: '魏',
        }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    // 不发动烈弓
    await P1.respond('界烈弓', { choice: false });

    // 正常询问闪 → P2 出闪抵消
    await P2.respond('闪', { cardId: 'd1' });
    expect(harness.state.players[1].health).toBe(4);
  });
});
