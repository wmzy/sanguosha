// 张绣(群·风林火山 hero/415)技能测试:
//   雄乱(限定技):出牌阶段指定一名其他角色并废除你的判定区和装备区,
//     本回合对其使用牌无距离和次数限制,其本回合不能使用和打出手牌。
//   从谏(被动技):成为多目标锦囊的目标时,可交给其中一名目标角色一张牌,
//     然后摸一张牌,若给出的是装备牌,改为摸两张牌。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, fireTimeoutAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { skillLoaders } from '../../src/engine/skills';
import * as 雄乱Module from '../../src/engine/skills/雄乱';
import * as 从谏Module from '../../src/engine/skills/从谏';
import { createGameState, suitColor } from '../../src/engine/types';
import { slashMax } from '../../src/engine/rules/slash-quota';
import { isDistanceExempted } from '../../src/engine/rules/distance';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

// 本地注册技能模块(主 agent 统一在 skills/index.ts 注册;测试本地兜底)
skillLoaders['雄乱'] = async () => 雄乱Module;
skillLoaders['从谏'] = async () => 从谏Module;

const ABOLISH_PREFIX = '雄乱/废除:';
const TARGET_VAR = '雄乱/目标';
const USED_KEY = '雄乱/used';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  subtype?: string,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, subtype };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  equipment?: PlayerState['equipment'];
  health?: number;
  maxHealth?: number;
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '张绣',
    health: opts.health ?? opts.maxHealth ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['雄乱', '从谏'],
    vars: (opts.vars as PlayerState['vars']) ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 构建标准 state:P0=张绣(满血4/4,出牌阶段),P1=敌方 */
function makeZhangXiuState(opts?: {
  p0Hand?: string[];
  p0Skills?: string[];
  p0Equipment?: PlayerState['equipment'];
  p0Vars?: Record<string, unknown>;
  playerCount?: number;
  extraCards?: Record<string, Card>;
  currentPlayer?: number;
}) {
  const n = opts?.playerCount ?? 2;
  const players: PlayerState[] = [
    makePlayer({
      index: 0,
      name: '张绣',
      hand: opts?.p0Hand ?? [],
      skills: opts?.p0Skills ?? ['雄乱', '从谏', '杀'],
      equipment: opts?.p0Equipment,
      vars: opts?.p0Vars,
    }),
  ];
  for (let i = 1; i < n; i++) {
    players.push(
      makePlayer({
        index: i,
        name: `P${i}`,
        character: `P${i}`,
        hand: [],
        skills: i === 1 ? ['闪'] : [],
      }),
    );
  }
  const cardMap: Record<string, Card> = { ...(opts?.extraCards ?? {}) };
  return createGameState({
    players,
    cardMap,
    currentPlayerIndex: opts?.currentPlayer ?? 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('雄乱', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 废除判定区+装备区 + 标记目标 ───────────────────
  it('发动雄乱 → 废除判定区和全部装备区,标记本回合目标', async () => {
    const state = makeZhangXiuState();
    await harness.setup(state);
    const P0 = harness.player('张绣');

    await P0.triggerAction('雄乱', 'use', { target: 1 });

    const vars = harness.state.players[0].vars;
    // 判定区废除
    expect(vars[`${ABOLISH_PREFIX}判定`]).toBe(true);
    // 装备区 5 槽全部废除
    expect(vars[`${ABOLISH_PREFIX}武器`]).toBe(true);
    expect(vars[`${ABOLISH_PREFIX}防具`]).toBe(true);
    expect(vars[`${ABOLISH_PREFIX}进攻马`]).toBe(true);
    expect(vars[`${ABOLISH_PREFIX}防御马`]).toBe(true);
    expect(vars[`${ABOLISH_PREFIX}宝物`]).toBe(true);
    // 限定技已用
    expect(vars[USED_KEY]).toBe(true);
    // 本回合目标
    expect(harness.state.turn.vars[TARGET_VAR]).toBe(1);
  });

  // ─── 弃置已有装备 ────────────────────────────────
  it('发动雄乱时已有装备被弃置', async () => {
    const weapon = makeCard('w1', '诸葛连弩', '♣', 'A', '装备牌', '武器');
    const state = makeZhangXiuState({
      p0Equipment: { 武器: 'w1' },
      extraCards: { w1: weapon },
    });
    await harness.setup(state);
    const P0 = harness.player('张绣');

    expect(harness.state.players[0].equipment['武器']).toBe('w1');

    await P0.triggerAction('雄乱', 'use', { target: 1 });

    // 装备被弃置
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[0].vars[`${ABOLISH_PREFIX}武器`]).toBe(true);
  });

  // ─── 限定技整局一次 ──────────────────────────────
  it('雄乱已使用 → 第二次发动被拒', async () => {
    const state = makeZhangXiuState();
    await harness.setup(state);
    const P0 = harness.player('张绣');

    await P0.triggerAction('雄乱', 'use', { target: 1 });
    expect(harness.state.players[0].vars[USED_KEY]).toBe(true);

    await P0.expectRejected({ skillId: '雄乱', actionType: 'use', params: { target: 1 } });
  });

  // ─── 目标不能出闪:杀必中 ─────────────────────────
  it('雄乱目标本回合不能出闪 → 杀直接命中(即便目标手中有闪)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state = makeZhangXiuState({
      p0Hand: ['k1'],
      extraCards: { k1: kill, d1: dodge },
    });
    // 给 P1 一张闪(证明其有闪却出不了)
    state.players[1].hand = ['d1'];
    await harness.setup(state);
    const P0 = harness.player('张绣');

    await P0.triggerAction('雄乱', 'use', { target: 1 });

    expect(harness.state.players[1].health).toBe(4);
    // 张绣对 P1 出杀
    await P0.useCardAndTarget('杀', 'k1', [1]);

    // 询问闪被雄乱取消 → 不创建 pending,杀直接结算
    // P1 仍有闪在手(出不了)
    expect(harness.state.players[1].hand).toContain('d1');
    // P1 受到 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 对目标使用牌无距离限制 ───────────────────────
  it('雄乱目标 → 对其使用牌无距离限制(距离豁免)', async () => {
    // 4 人座,P0 与 P3 距离最远
    const state = makeZhangXiuState({ playerCount: 4 });
    await harness.setup(state);
    const P0 = harness.player('张绣');

    // 雄乱前:P0→P3 不豁免
    expect(isDistanceExempted(harness.state, 0, 3)).toBe(false);

    await P0.triggerAction('雄乱', 'use', { target: 3 });

    // 雄乱后:P0→雄乱目标(P3)豁免;P0→P1(非目标)不豁免
    expect(isDistanceExempted(harness.state, 0, 3)).toBe(true);
    expect(isDistanceExempted(harness.state, 0, 1)).toBe(false);
  });

  // ─── 对目标使用杀无次数限制 ───────────────────────
  it('雄乱目标 → 对其使用杀无次数限制(slashMax=∞)', async () => {
    const k1 = makeCard('k1', '杀', '♠', '7');
    const k2 = makeCard('k2', '杀', '♠', '8');
    const state = makeZhangXiuState({
      p0Hand: ['k1', 'k2'],
      extraCards: { k1, k2 },
    });
    await harness.setup(state);
    const P0 = harness.player('张绣');

    // 雄乱前:基础杀次数 1
    expect(slashMax(harness.state, 0)).toBe(1);

    await P0.triggerAction('雄乱', 'use', { target: 1 });

    // 雄乱后:无限出杀
    expect(slashMax(harness.state, 0)).toBe(Infinity);

    // 第一刀命中(P1 无闪+被禁出牌)
    await P0.useCardAndTarget('杀', 'k1', [1]);
    expect(harness.state.players[1].health).toBe(3);
    // 第二刀也能出(无次数限制)
    await P0.useCardAndTarget('杀', 'k2', [1]);
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── validate:不能选自己 ─────────────────────────
  it('雄乱不能选择自己为目标', async () => {
    const state = makeZhangXiuState();
    await harness.setup(state);
    const P0 = harness.player('张绣');

    await P0.expectRejected({ skillId: '雄乱', actionType: 'use', params: { target: 0 } });
    expect(harness.state.players[0].vars[USED_KEY]).toBeUndefined();
  });

  // ─── validate:非自己回合不能发动 ──────────────────
  it('雄乱非自己回合不能发动', async () => {
    const state = makeZhangXiuState({ currentPlayer: 1 });
    await harness.setup(state);
    const P0 = harness.player('张绣');

    await P0.expectRejected({ skillId: '雄乱', actionType: 'use', params: { target: 1 } });
    expect(harness.state.players[0].vars[USED_KEY]).toBeUndefined();
  });

  // ─── 废除后不可再装装备(永久) ─────────────────────
  it('废除装备区后不可再装备(永久生效)', async () => {
    const weapon = makeCard('w2', '诸葛连弩', '♣', '2', '装备牌', '武器');
    const state = makeZhangXiuState({
      p0Hand: ['w2'],
      extraCards: { w2: weapon },
    });
    await harness.setup(state);
    const P0 = harness.player('张绣');

    await P0.triggerAction('雄乱', 'use', { target: 1 });
    expect(harness.state.players[0].vars[`${ABOLISH_PREFIX}武器`]).toBe(true);
    // w2 仍在手牌(雄乱只弃置已装备的牌,不动手牌)
    expect(harness.state.players[0].hand).toContain('w2');

    // 尝试装备武器 → 被 before-hook cancel,牌仍留手牌
    const { applyAtom } = await import('../../src/engine/core/apply');
    await applyAtom(harness.state, { type: '装备', player: 0, cardId: 'w2' });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('w2');
  });

  // ─── 废除判定区后免疫延时锦囊(永久) ───────────────
  it('废除判定区后免疫延时锦囊(乐不思蜀不可置入)', async () => {
    const indulgence = makeCard('ind1', '乐不思蜀', '♠', 'A', '锦囊牌', '延时锦囊');
    const state = makeZhangXiuState({
      extraCards: { ind1: indulgence },
    });
    await harness.setup(state);
    const P0 = harness.player('张绣');

    await P0.triggerAction('雄乱', 'use', { target: 1 });
    expect(harness.state.players[0].vars[`${ABOLISH_PREFIX}判定`]).toBe(true);

    // 尝试置入延时锦囊
    const { applyAtom } = await import('../../src/engine/core/apply');
    await applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: indulgence },
    });
    await harness.waitForStable();
    harness.processAllEvents();

    // 判定区为空(被取消)
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);
  });
});

describe('从谏', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 多目标锦囊(万箭齐发)→ 给牌+摸1 ──────────────
  it('成为万箭齐发目标(多目标)→ 给另一目标一张牌,摸1张', async () => {
    const wanjian = makeCard('wj1', '万箭齐发', '♥', 'A', '锦囊牌');
    const give = makeCard('g1', '杀', '♠', '3'); // 张绣给出的牌(基本牌→摸1)
    const state: GameState = createGameState({
      players: [
        // P0 = 万箭使用者
        makePlayer({
          index: 0,
          name: 'P0',
          character: '曹操',
          hand: ['wj1'],
          skills: ['万箭齐发'],
        }),
        // P1 = 张绣(从谏持有者),有牌可给
        makePlayer({
          index: 1,
          name: '张绣',
          character: '张绣',
          hand: ['g1'],
          skills: ['雄乱', '从谏'],
        }),
        // P2 = 另一目标(接收张绣给的牌)
        makePlayer({ index: 2, name: 'P2', character: '刘备', hand: [], skills: [] }),
      ],
      cardMap: { wj1: wanjian, g1: give },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('张绣');

    // P0 使用万箭齐发(自动目标 = 所有其他角色 [P1, P2])
    await P0.useCard('万箭齐发', 'wj1');

    // 从谏触发:张绣(P1)看到给牌询问 → 把 g1 给 P2
    P1.processEvents();
    await P1.respond('从谏', { cardId: 'g1', target: 2 });

    // 验证:张绣给出了 g1(手牌不再含 g1),摸了 1 张(基本牌→摸1)
    expect(harness.state.players[1].hand).not.toContain('g1');
    expect(harness.state.players[1].hand.length).toBe(1); // 摸1张
    // P2 收到 g1
    expect(harness.state.players[2].hand).toContain('g1');

    // 万箭结算继续:无懈窗口 + 询问闪。逐个 pass 推进。
    // 张绣(P1)的万箭伤害结算:过无懈 + 不闪
    await drainPending(harness);

    // 最终张绣与 P2 各受 1 点伤害(万箭效果,与从谏无关)
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 给装备牌 → 摸2 ──────────────────────────────
  it('从谏给出装备牌 → 摸2张', async () => {
    const wanjian = makeCard('wj1', '万箭齐发', '♥', 'A', '锦囊牌');
    const equip = makeCard('e1', '诸葛连弩', '♣', 'A', '装备牌', '武器'); // 张绣给出的装备牌
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '曹操',
          hand: ['wj1'],
          skills: ['万箭齐发'],
        }),
        makePlayer({
          index: 1,
          name: '张绣',
          character: '张绣',
          hand: ['e1'],
          skills: ['雄乱', '从谏'],
        }),
        makePlayer({ index: 2, name: 'P2', character: '刘备', hand: [], skills: [] }),
      ],
      cardMap: { wj1: wanjian, e1: equip },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('张绣');

    await P0.useCard('万箭齐发', 'wj1');

    P1.processEvents();
    // 给装备牌 e1 给 P2
    await P1.respond('从谏', { cardId: 'e1', target: 2 });

    // 张绣给出 e1,摸 2 张(装备牌)
    expect(harness.state.players[1].hand).not.toContain('e1');
    expect(harness.state.players[1].hand.length).toBe(2);
    expect(harness.state.players[2].hand).toContain('e1');

    await drainPending(harness);
  });

  // ─── 单目标锦囊不触发 ─────────────────────────────
  it('成为单目标锦囊(顺手牵羊)目标 → 从谏不触发', async () => {
    const shunshou = makeCard('ss1', '顺手牵羊', '♠', 'A', '锦囊牌');
    const give = makeCard('g1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '曹操',
          hand: ['ss1'],
          skills: ['顺手牵羊'],
        }),
        makePlayer({
          index: 1,
          name: '张绣',
          character: '张绣',
          hand: ['g1'],
          skills: ['雄乱', '从谏'],
        }),
      ],
      cardMap: { ss1: shunshou, g1: give },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const handBefore = harness.state.players[1].hand.length;

    // P0 对张绣使用顺手牵羊(单目标)
    await P0.useCardAndTarget('顺手牵羊', 'ss1', [1]);
    await harness.waitForStable();

    // 单目标 → 从谏不触发:当前 pending 不应是 从谏/给牌 询问
    const slots = [...harness.state.pendingSlots.values()];
    for (const s of slots) {
      const rt = (s.atom as { requestType?: string }).requestType;
      expect(rt).not.toBe('从谏/给牌');
    }
    // 张绣手牌未因从谏变化(从谏未摸牌)
    expect(harness.state.players[1].hand.length).toBe(handBefore);
    expect(harness.state.localVars['从谏/给牌']).toBeUndefined();

    // 排干后续结算(无懈/选牌)
    await drainPending(harness);
  });

  // ─── 放弃发动(pass)→ 无效果 ─────────────────────
  it('从谏放弃发动(pass)→ 不给牌不摸牌', async () => {
    const wanjian = makeCard('wj1', '万箭齐发', '♥', 'A', '锦囊牌');
    const give = makeCard('g1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          character: '曹操',
          hand: ['wj1'],
          skills: ['万箭齐发'],
        }),
        makePlayer({
          index: 1,
          name: '张绣',
          character: '张绣',
          hand: ['g1'],
          skills: ['雄乱', '从谏'],
        }),
        makePlayer({ index: 2, name: 'P2', character: '刘备', hand: [], skills: [] }),
      ],
      cardMap: { wj1: wanjian, g1: give },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('张绣');

    await P0.useCard('万箭齐发', 'wj1');

    // 从谏触发 → 张绣选择放弃(pass/超时)
    P1.processEvents();
    await P1.pass();

    // 未给牌、未摸牌(g1 仍在手,手牌数不变)
    expect(harness.state.players[1].hand).toContain('g1');
    expect(harness.state.players[1].hand.length).toBe(1);

    await drainPending(harness);
  });
});

/** 排干所有 pending(无懈广播窗口/询问闪/询问杀/选牌 等),用 fireTimeout(=pass/不回应)
 *  逐个推进直到稳定。适用于从谏触发后的锦囊结算收尾。 */
async function drainPending(harness: SkillTestHarness): Promise<void> {
  let guard = 0;
  while (harness.state.pendingSlots.size > 0 && guard < 30) {
    await fireTimeoutAndWait(harness.state);
    harness.processAllEvents();
    guard++;
  }
  await harness.waitForStable();
  harness.processAllEvents();
}
