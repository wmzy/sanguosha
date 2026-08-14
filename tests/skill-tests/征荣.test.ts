// 征荣(毌丘俭·魏·被动技)行为测试:
//   当你使用【杀】或伤害锦囊牌时,你可以选择其中一个手牌数不小于你的目标角色,
//   将其一张牌置于你的武将牌上,称为"荣"。
//
// 验证:
//   1. 使用杀 + 目标手牌数≥己 → 发动征荣 → 取目标一张手牌置为荣
//   2. 询问发动时选择不发动 → 不取荣
//   3. 使用非伤害牌(桃) → 不触发征荣
//   4. 无合格目标(目标无可取牌 / 手牌数<己) → 不询问、不取荣
//
// 鸿举(毌丘俭·魏·觉醒技)行为测试:
//   准备阶段,若"荣"的数量不小于3,你用任意手牌替换等量的荣,减1体力上限并获"清侧"。
//
//   5. 荣≥3 准备阶段 → 觉醒:换荣 + 减1上限 + 获清侧 + 整局一次标记
//   6. 荣<3 → 不觉醒
//   7. 已觉醒 → 不再触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import * as 征荣Module from '../../src/engine/skills/征荣';
import * as 鸿举Module from '../../src/engine/skills/鸿举';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

// 本地注册 征荣/鸿举 技能模块(主 agent 统一在 skills/index.ts 注册;测试本地兜底)
setSkillModuleOverride('征荣', async () => 征荣Module);
setSkillModuleOverride('鸿举', async () => 鸿举Module);

const RONG_PREFIX = '征荣/荣:';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  marks?: PlayerState['marks'];
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '毌丘俭',
    health: opts.health ?? opts.maxHealth ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: (opts.vars as PlayerState['vars']) ?? {},
    marks: opts.marks ?? [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function rongCount(state: GameState, player: number): number {
  return state.players[player].marks.filter((m) => m.id.startsWith(RONG_PREFIX)).length;
}

describe('征荣', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 1. 使用杀 + 目标手牌数≥己 → 发动征荣 → 取目标一张手牌置为荣
  it('使用杀指定手牌数不小于己的目标 → 发动征荣取其一牌置为荣', async () => {
    const cardMap: Record<string, Card> = {
      c1: makeCard('c1', '杀', '♠', '7'),
      c2: makeCard('c2', '杀', '♥', '3'),
      c3: makeCard('c3', '桃', '♥', '5'),
    };
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['征荣', '鸿举'] }),
          makePlayer({ index: 1, name: 'P1', hand: ['c2', 'c3'] }),
        ],
        cardMap,
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // P0 出杀指定 P1 → 使用时触发征荣 confirm
    await P0.useCardAndTarget('杀', 'c1', [1]);
    P0.expectPending('请求回应'); // 征荣 confirm
    await P0.respond('征荣', { choice: true });

    // 仅 1 名合格目标 → 跳过选目标,直接弹选牌面板
    P0.expectPending('请求回应'); // 征荣/选牌
    await P0.respond('征荣', { zone: 'hand', handIndex: 0 });

    // 征荣结算完成:获得 P1 手牌 → 弃置入武将牌 → 加荣标记;
    // 随后杀继续结算:P1 剩余手牌非闪 → 询问闪(silent)需 P1 放弃
    await harness.player('P1').pass();

    expect(rongCount(harness.state, 0)).toBe(1); // P0 有 1 张荣
    expect(harness.state.players[1].hand.length).toBe(1); // P1 被取走 1 张(剩 1)
    expect(harness.state.players[0].hand.length).toBe(0); // 取到的牌已弃置为荣,不在手牌
    expect(harness.state.players[1].health).toBe(3); // 杀造成 1 伤害
  });

  // 2. 询问发动时选择不发动 → 不取荣
  it('选择不发动征荣 → 不取荣', async () => {
    const cardMap: Record<string, Card> = {
      c1: makeCard('c1', '杀', '♠', '7'),
      c2: makeCard('c2', '杀', '♥', '3'),
    };
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['征荣', '鸿举'] }),
          makePlayer({ index: 1, name: 'P1', hand: ['c2'] }),
        ],
        cardMap,
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('杀', 'c1', [1]);
    P0.expectPending('请求回应'); // 征荣 confirm
    await P0.respond('征荣', { choice: false }); // 不发动
    // 杀继续结算:P1 手牌非闪 → 询问闪(silent)需 P1 放弃
    await harness.player('P1').pass();

    expect(rongCount(harness.state, 0)).toBe(0); // 不取荣
    expect(harness.state.players[1].hand.length).toBe(1); // P1 手牌未变
    expect(harness.state.players[1].health).toBe(3); // 杀仍造成伤害
  });

  // 3. 使用非伤害牌(桃) → 不触发征荣
  it('使用桃(非伤害牌) → 不触发征荣', async () => {
    const cardMap: Record<string, Card> = {
      c1: makeCard('c1', '桃', '♥', '5'),
    };
    await harness.setup(
      createGameState({
        players: [
          // P0 受伤(3/4)才能用桃
          makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['征荣', '鸿举'], health: 3, maxHealth: 4 }),
          makePlayer({ index: 1, name: 'P1', hand: [] }),
        ],
        cardMap,
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('桃', 'c1', [0]);
    await harness.waitForStable();

    // 桃非杀/伤害锦囊 → 征荣不触发
    expect(rongCount(harness.state, 0)).toBe(0);
    expect(harness.state.players[0].health).toBe(4); // 桃回复 1 体力
  });

  // 4. 无合格目标(目标手牌数<己 且无可取装备) → 不询问、不取荣
  it('目标手牌数小于己且无可取牌 → 不询问征荣', async () => {
    const cardMap: Record<string, Card> = {
      c1: makeCard('c1', '杀', '♠', '7'),
      c4: makeCard('c4', '桃', '♥', '5'),
    };
    await harness.setup(
      createGameState({
        players: [
          // P0 出杀后仍持 1 张(桃),myHand=1
          makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c4'], skills: ['征荣', '鸿举'] }),
          // P1 无手牌无装备 → hand(0) < myHand(1) 且无可取牌
          makePlayer({ index: 1, name: 'P1', hand: [] }),
        ],
        cardMap,
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('杀', 'c1', [1]);
    await harness.waitForStable();

    // 无合格目标 → 征荣不询问
    expect(rongCount(harness.state, 0)).toBe(0);
    expect(harness.state.players[1].health).toBe(3); // 杀仍造成伤害
  });
});

describe('鸿举', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 5. 荣≥3 准备阶段 → 觉醒:换荣 + 减1上限 + 获清侧
  it('荣≥3 准备阶段 → 用手牌替换荣 + 减1体力上限 + 获清侧', async () => {
    const cardMap: Record<string, Card> = {
      h1: makeCard('h1', '杀', '♠', '2'),
      h2: makeCard('h2', '闪', '♥', '2'),
      h3: makeCard('h3', '桃', '♥', '3'),
      d1: makeCard('d1', '杀', '♠', '4'),
      d2: makeCard('d2', '杀', '♣', '5'),
      d3: makeCard('d3', '杀', '♦', '6'),
    };
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: 'P0',
            hand: ['h1', 'h2', 'h3'],
            skills: ['征荣', '鸿举'],
            health: 4,
            maxHealth: 4,
            // 预置 3 张荣
            marks: [
              { id: `${RONG_PREFIX}1`, scope: 0, payload: { cardId: 'd1' } },
              { id: `${RONG_PREFIX}2`, scope: 0, payload: { cardId: 'd2' } },
              { id: `${RONG_PREFIX}3`, scope: 0, payload: { cardId: 'd3' } },
            ],
          }),
          makePlayer({ index: 1, name: 'P1' }),
        ],
        cardMap,
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // 触发准备阶段:鸿举强制觉醒,弹换荣询问
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    P0.expectPending('请求回应'); // 鸿举/换荣
    // 选 2 张手牌替换等量(2)荣
    await P0.respond('鸿举', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(3); // 4→3
    // 设上限 clamp 体力:health=min(4,3)=3
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].skills).toContain('清侧');
    expect(harness.state.players[0].vars['鸿举/awakened']).toBe(true);
    // 荣总数不变(3 旧 -2 移 +2 新 = 3)
    expect(rongCount(harness.state, 0)).toBe(3);
    // 选中的 2 张手牌已弃置为荣,剩 h3 在手
    expect(harness.state.players[0].hand).toEqual(['h3']);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['h1', 'h2']));
  });

  // 6. 荣<3 → 不觉醒
  it('荣<3 准备阶段 → 不觉醒', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: 'P0',
            skills: ['征荣', '鸿举'],
            health: 4,
            maxHealth: 4,
            marks: [
              { id: `${RONG_PREFIX}1`, scope: 0, payload: { cardId: 'd1' } },
              { id: `${RONG_PREFIX}2`, scope: 0, payload: { cardId: 'd2' } },
            ],
          }),
          makePlayer({ index: 1, name: 'P1' }),
        ],
        cardMap: { d1: makeCard('d1', '杀'), d2: makeCard('d2', '杀') },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(4); // 不变
    expect(harness.state.players[0].skills).not.toContain('清侧');
    expect(harness.state.players[0].vars['鸿举/awakened']).toBeFalsy();
  });

  // 7. 已觉醒 → 不再触发
  it('已觉醒再次准备阶段 → 不再触发', async () => {
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: 'P0',
            skills: ['征荣', '鸿举'],
            health: 3,
            maxHealth: 3,
            vars: { '鸿举/awakened': true },
            marks: [
              { id: `${RONG_PREFIX}1`, scope: 0, payload: { cardId: 'd1' } },
              { id: `${RONG_PREFIX}2`, scope: 0, payload: { cardId: 'd2' } },
              { id: `${RONG_PREFIX}3`, scope: 0, payload: { cardId: 'd3' } },
            ],
          }),
          makePlayer({ index: 1, name: 'P1' }),
        ],
        cardMap: {
          d1: makeCard('d1', '杀'),
          d2: makeCard('d2', '杀'),
          d3: makeCard('d3', '杀'),
        },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    // 已觉醒 → 不再触发:max上限不变(仍3),荣不变(3)
    expect(harness.state.players[0].maxHealth).toBe(3);
    expect(rongCount(harness.state, 0)).toBe(3);
  });
});
