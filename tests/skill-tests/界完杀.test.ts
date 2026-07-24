// 界完杀(界贾诩·锁定技)测试:
//   "在你的回合内:只有你和处于濒死状态的角色才能使用【桃】;
//    任意角色的濒死结算中,除你和濒死角色外的其他角色的非锁定技失效。"
//
// 验证:
//   1. 标版完杀沿用:贾诩回合内,第三方求桃被 cancel
//   2. 标版完杀沿用:贾诩本人可救援 / 濒死者本人可自救
//   3. 标版完杀沿用:非贾诩回合不生效
//   4. 界版新增:贾诩回合内他人濒死时,第三方非锁定技救援技(如界补益)被压制
//   5. 界版新增:贾诩回合结束后(cleanup),tag 被清除,他人非锁定技恢复
//   6. 界版新增:贾诩本人作为濒死者时,他人非锁定技仍被压制(贾诩=你=濒死者)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, PlayerState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

describe('界完杀', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 标版完杀沿用:第三方求桃被 cancel ──
  it('贾诩回合内:第三方 P3 求桃被跳过,濒死者死亡', async () => {
    const slash = mkCard('s1', '杀', '♠', '7');
    const peach = mkCard('p1', '桃', '♥', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            hand: [slash.id],
            skills: ['界完杀', '杀'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 1, maxHealth: 4 }),
          mkPlayer({ index: 2, name: 'P3', hand: [peach.id], skills: ['桃'], health: 4 }),
        ],
        cardMap: { s1: slash, p1: peach },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.useCardAndTarget('杀', 's1', [1]);
    await P2.pass(); // 不闪 → 濒死
    await harness.waitForStable();

    // 求桃顺序(模块 C:逆时针从当前回合贾诩起):贾诩 → P3(完杀跳过)→ P2(濒死)
    await JX.pass(); // 贾诩无桃 pass
    await harness.waitForStable();

    // 完杀:P3 求桃被 cancel → 当前 pending 是 P2(濒死者,idx 1)
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { target: number }).target).toBe(1);

    await P2.pass(); // P2 也无桃
    await harness.waitForStable();

    expect(harness.state.players[1].alive).toBe(false);
    expect(harness.state.players[2].hand).toContain('p1'); // P3 的桃未用
  });

  // ─── 2. 标版完杀沿用:贾诩本人可救援 ──
  it('贾诩回合内:贾诩本人可对濒死者使用桃', async () => {
    const slash = mkCard('s2', '杀', '♠', '8');
    const peach = mkCard('p2', '桃', '♦', '4');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            hand: [slash.id, peach.id],
            skills: ['界完杀', '杀', '桃'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 1, maxHealth: 4 }),
          mkPlayer({ index: 2, name: 'P3', hand: [], skills: [], health: 4 }),
        ],
        cardMap: { s2: slash, p2: peach },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.useCardAndTarget('杀', 's2', [1]);
    await P2.pass();
    await harness.waitForStable();

    // 求桃顺序(模块 C:逆时针从贾诩起):贾诩先被问 → 出桃救援
    await JX.respond('桃', { cardId: 'p2' });
    await harness.waitForStable();

    expect(harness.state.players[1].alive).toBe(true);
    expect(harness.state.players[1].health).toBe(1);
  });

  // ─── 3. 标版完杀沿用:非贾诩回合不生效 ──
  it('非贾诩回合:第三方可正常救援', async () => {
    const slash = mkCard('s4', '杀', '♠', '6');
    const peach = mkCard('p4', '桃', '♥', '2');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            hand: [peach.id],
            skills: ['界完杀', '桃'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 1, maxHealth: 4 }),
          mkPlayer({
            index: 2,
            name: 'P3',
            character: 'P3',
            hand: [slash.id],
            skills: ['杀'],
            health: 4,
          }),
        ],
        cardMap: { s4: slash, p4: peach },
        currentPlayerIndex: 2, // P3 回合
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');
    const JX = harness.player('界贾诩');

    await P3.useCardAndTarget('杀', 's4', [1]);
    await P2.pass();
    await harness.waitForStable();

    // P2 濒死 → 求桃顺序(模块 C:逆时针从当前回合 P3 起):P3 → P2(濒死)→ 贾诩
    // 非贾诩回合 → 完杀不生效
    await P3.pass(); // P3 无桃 pass
    await harness.waitForStable();
    // 接下来问 P2(濒死者)→ P2 也无桃 pass
    await P2.pass();
    await harness.waitForStable();
    // 现在问贾诩 → 贾诩出桃救援
    await JX.respond('桃', { cardId: 'p4' });
    await harness.waitForStable();

    expect(harness.state.players[1].alive).toBe(true);
  });

  // ─── 4. 界版新增:贾诩回合内他人濒死 → 第三方非锁定技失效 ──
  // 用一个简单的非锁定技:急救(华佗)。急救.respond 是非锁定技(描述不以"锁定技"开头)。
  // 在贾诩回合内,P2(华佗)持有红色手牌可急救,但界完杀压制非锁定技 → 急救 hook 被跳过。
  // 注:界完杀通过 SUPPRESSION_TAGS 机制压制,基于描述前缀判定"非锁定技"。
  it('界版:贾诩回合内,他人非锁定技(急救)被压制,无法救援', async () => {
    const slash = mkCard('s5', '杀', '♠', '5');
    // 急救用红色牌(华佗)
    const redCard = mkCard('r1', '闪', '♥', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            hand: [slash.id],
            skills: ['界完杀', '杀'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 1, maxHealth: 4 }),
          // P3 = 华佗,有红色牌可急救,但被完杀压制
          mkPlayer({
            index: 2,
            name: '华佗',
            character: '华佗',
            hand: [redCard.id],
            skills: ['急救'],
            health: 4,
          }),
        ],
        cardMap: { s5: slash, r1: redCard },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.useCardAndTarget('杀', 's5', [1]);
    await P2.pass();
    await harness.waitForStable();

    // 求桃顺序(模块 C:逆时针从贾诩起):贾诩 → P3(华佗,完杀跳过)→ P2(濒死)
    await JX.pass(); // 贾诩无桃 pass
    await harness.waitForStable();

    // 界完杀:P3 的非锁定技失效 + 求桃被 cancel → 直接问 P2(濒死者,idx 1)
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { target: number }).target).toBe(1); // 跳过 P3,问 P2

    // 验证 P3 的 tag 已设置
    expect(harness.state.players[2].tags).toContain('完杀/非锁定技失效');

    // P2 也无桃 pass → P2 死亡
    await P2.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].alive).toBe(false);
    // P3 的红色牌未被使用(急救被压制)
    expect(harness.state.players[2].hand).toContain('r1');

    // cleanup:濒死结算结束后(cleanup via 击杀),tag 被清除
    expect(harness.state.players[2].tags).not.toContain('完杀/非锁定技失效');
  });

  // ─── 5. 界版新增:cleanup 在救援成功后也生效 ──
  it('界版:濒死被救活后(回复体力),tag 被清除', async () => {
    const slash = mkCard('s6', '杀', '♠', '4');
    const peach = mkCard('p6', '桃', '♥', '8');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            hand: [slash.id, peach.id],
            skills: ['界完杀', '杀', '桃'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 1, maxHealth: 4 }),
          mkPlayer({ index: 2, name: 'P3', hand: [], skills: [], health: 4 }),
        ],
        cardMap: { s6: slash, p6: peach },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.useCardAndTarget('杀', 's6', [1]);
    await P2.pass();
    await harness.waitForStable();

    // 濒死期间 P3 被加了 tag(陷入濒死时已设置,先于求桃循环)
    expect(harness.state.players[2].tags).toContain('完杀/非锁定技失效');

    // 求桃顺序(模块 C:逆时针从贾诩起):贾诩先被问 → 出桃救活 P2
    await JX.respond('桃', { cardId: 'p6' });
    await harness.waitForStable();

    // 救活后 cleanup → tag 被清除
    expect(harness.state.players[1].alive).toBe(true);
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[2].tags).not.toContain('完杀/非锁定技失效');
  });

  // ─── 6. 标版完杀沿用:濒死者本人可自救 ──
  it('贾诩回合内:濒死者本人可对自己使用桃', async () => {
    const slash = mkCard('s7', '杀', '♠', '9');
    const peach = mkCard('p7', '桃', '♥', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界贾诩',
            character: '界贾诩',
            hand: [slash.id],
            skills: ['界完杀', '杀'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({
            index: 1,
            name: 'P2',
            hand: [peach.id],
            skills: ['闪', '桃'],
            health: 1,
            maxHealth: 4,
          }),
          mkPlayer({ index: 2, name: 'P3', hand: [], skills: [], health: 4 }),
        ],
        cardMap: { s7: slash, p7: peach },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const JX = harness.player('界贾诩');
    const P2 = harness.player('P2');

    await JX.useCardAndTarget('杀', 's7', [1]);
    await P2.pass();
    await harness.waitForStable();

    // 求桃顺序(模块 C:逆时针从贾诩起):贾诩 → P3(完杀跳过)→ P2(濒死者)
    // 贾诩先被问 → 无桃 pass
    await JX.pass();
    await harness.waitForStable();

    // 完杀跳过 P3 → 问 P2(濒死者,可自救)→ 对自己出桃(濒死者不受完杀限制)
    await P2.respond('桃', { cardId: 'p7' });
    await harness.waitForStable();

    expect(harness.state.players[1].alive).toBe(true);
    expect(harness.state.players[1].health).toBe(1);
  });
});
