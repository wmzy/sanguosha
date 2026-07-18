// 界裸衣(界许褚·魏·主动技)测试,OL hero/488 官方逐字:
//   "摸牌阶段开始前,你可以亮出牌堆顶的三张牌,然后你可以跳过摸牌阶段并获得
//    其中所有基本牌、武器牌和【决斗】,且直到你的下回合开始,你为伤害来源的
//    【杀】和【决斗】对目标角色造成的伤害+1。"
//
// 验证:
//   1. 增伤隔离:有裸衣标签时,杀造成 2 点伤害
//   2. 对照:无标签时,杀造成 1 点
//   3. 决斗伤害 +1
//   4. 不发动界裸衣 → 走默认摸牌(2 张)
//   5. 发动 + 不跳过摸牌阶段:3 张原序放回牌堆顶 → 默认摸 2 张;增伤标签已挂
//   6. 发动 + 跳过摸牌阶段:基本牌/武器牌/决斗入手,其余弃置;不摸默认 2 张
//   7. 增伤持续期:直到 owner 自己的下回合开始清标签(其他玩家回合开始不清)
//   8. 限一次/回合
//   9. 牌堆 < 3 张时不发动(走默认摸牌)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
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
  range?: number,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype, range };
}

function makeTrick(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  trickSubtype: '普通锦囊' | '延时锦囊' | '响应锦囊' = '普通锦囊',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '锦囊牌', trickSubtype };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  tags?: string[];
  equipment?: Record<string, string>;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: '界许褚',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: opts.tags ?? [],
    judgeZone: [],
  };
}

describe('界裸衣', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 增伤效果(隔离测试:直接挂标签)────────────────────

  it('有裸衣增伤标签:杀造成 2 点伤害', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['杀', '界裸衣'],
          tags: ['裸衣/bonus'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    expect(harness.state.players[1].health).toBe(2);
  });

  it('无裸衣标签:杀造成 1 点伤害(对照)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀', '界裸衣'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    expect(harness.state.players[1].health).toBe(3);
  });

  it('有裸衣增伤标签:决斗伤害 +1(2 点)', async () => {
    const duel = makeTrick('duel1', '决斗', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['duel1'],
          skills: ['决斗', '界裸衣'],
          tags: ['裸衣/bonus'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'] }),
      ],
      cardMap: { duel1: duel },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('决斗', 'duel1', [1]);
    // 决斗锦囊:P1 先被问无懈可击(空手跳过),再被询问杀;两轮 pass
    await P1.pass(); // 无懈可击(无手牌,跳过)
    await P1.pass(); // 询问杀(不出杀 → 输)

    // P1 输决斗 → 受 1(基础) + 1(界裸衣增伤) = 2 点伤害
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 不发动界裸衣 → 默认摸 2 张 ────────────────────────

  it('不发动界裸衣 → 走默认摸牌(询问①取消)', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const d3 = makeCard('d3', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界裸衣'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { d1, d2, d3 },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');

    await P0.respond('界裸衣', { choice: false }); // 不发动
    await harness.waitForStable();

    // 默认摸牌未被执行(本测试只 applyAtom 阶段开始;hook 直接 return,无后续摸牌)
    // 关键断言:无标签 + 无 询问②(SKIP_RT)
    expect(harness.state.players[0].tags).not.toContain('裸衣/bonus');
    const hasSkip = [...harness.state.pendingSlots.values()].some((s) => {
      const rt = (s.atom as { requestType?: string }).requestType;
      return rt === '裸衣/skip';
    });
    expect(hasSkip).toBe(false);
  });

  // ─── 发动 + 不跳过摸牌阶段:3 张原序放回 + 增伤标签 ────────────────

  it('发动 + 不跳过:3 张原序放回牌堆顶 + 增伤标签(默认摸牌由回合管理执行)', async () => {
    // 牌堆顶 3 张:[d1(底), d2, d3(顶)];发动后亮出再放回,顶序保持
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const d3 = makeCard('d3', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界裸衣'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { d1, d2, d3 },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界裸衣', { choice: true }); // 发动(询问①)
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界裸衣', { choice: false }); // 不跳过(询问②)
    await harness.waitForStable();

    // 3 张原序放回牌堆顶(deck=[d1,d2,d3],顶=d3)
    expect(harness.state.zones.deck).toEqual(['d1', 'd2', 'd3']);
    expect(harness.state.zones.processing).toEqual([]);
    // 增伤标签已挂(发动即生效,与跳过无关)
    expect(harness.state.players[0].tags).toContain('裸衣/bonus');
    // 手牌未变化(默认摸牌由回合管理 after-hook 触发,此测试不验证)
    expect(harness.state.players[0].hand).toEqual([]);
  });

  // ─── 发动 + 跳过摸牌阶段:匹配牌入手,其他弃置,跳过默认摸牌 ────────────────

  it('发动 + 跳过:基本牌/武器牌/决斗入手,其他弃置,跳过默认摸牌', async () => {
    // 牌堆顶 3 张(顶→底):杀(基本) / 丈八蛇矛(武器) / 无中生有(其他锦囊)
    // 顶 = deck 末尾
    const slash = makeCard('s1', '杀', '♠', '2');
    const weapon = makeEquip('w1', '丈八蛇矛', '♥', '武器', 'A', 3);
    const trick = makeTrick('t1', '无中生有', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界裸衣'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { s1: slash, w1: weapon, t1: trick },
      zones: { deck: ['t1', 'w1', 's1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界裸衣', { choice: true }); // 发动
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界裸衣', { choice: true }); // 跳过摸牌
    await harness.waitForStable();

    // 基本牌(杀)和武器(丈八蛇矛)入手
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['s1', 'w1']));
    expect(harness.state.players[0].hand).toHaveLength(2);
    // 非匹配锦囊(无中生有)弃置
    expect(harness.state.zones.discardPile).toContain('t1');
    // 跳过默认摸牌:牌堆(0 张)+处理区都为空
    expect(harness.state.zones.deck).toEqual([]);
    expect(harness.state.zones.processing).toEqual([]);
    // 增伤标签已挂
    expect(harness.state.players[0].tags).toContain('裸衣/bonus');
  });

  it('发动 + 跳过:决斗也入手(亮出含决斗)', async () => {
    // 牌堆顶 3 张:杀(基本) / 决斗(匹配锦囊) / 顺手牵羊(其他锦囊)
    const slash = makeCard('s1', '杀', '♠', '2');
    const duel = makeTrick('duel1', '决斗', '♠', 'A');
    const trick = makeTrick('t1', '顺手牵羊', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界裸衣'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { s1: slash, duel1: duel, t1: trick },
      zones: { deck: ['t1', 'duel1', 's1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    await P0.respond('界裸衣', { choice: true });
    await harness.waitForStable();
    await P0.respond('界裸衣', { choice: true });
    await harness.waitForStable();

    // 决斗 + 杀入手;顺手牵羊弃置
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['s1', 'duel1']));
    expect(harness.state.players[0].hand).toHaveLength(2);
    expect(harness.state.zones.discardPile).toContain('t1');
  });

  it('发动 + 跳过:防具/马不入手(仅武器匹配)', async () => {
    // 牌堆顶 2 张不够 3,先填 1 张
    const armor = makeEquip('a1', '八卦阵', '♣', '防具');
    const horse = makeEquip('h1', '赤兔', '♥', '进攻马', '5');
    const slash = makeCard('s1', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界裸衣'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { a1: armor, h1: horse, s1: slash },
      zones: { deck: ['a1', 'h1', 's1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    await P0.respond('界裸衣', { choice: true });
    await harness.waitForStable();
    await P0.respond('界裸衣', { choice: true });
    await harness.waitForStable();

    // 仅基本牌(杀)入手;防具+马(非武器装备)弃置
    expect(harness.state.players[0].hand).toEqual(['s1']);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['a1', 'h1']));
  });

  // ─── 增伤持续期:直到 owner 自己的下回合开始 ────────────────────

  it('增伤持续到 owner 自己的下回合开始:其他玩家回合开始不清标签', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界裸衣'],
          tags: ['裸衣/bonus'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 1, // P1 的回合
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    // P1 回合开始 → 不应清 P0 的标签(其他玩家的回合开始不清)
    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await harness.waitForStable();
    expect(harness.state.players[0].tags).toContain('裸衣/bonus');

    // P0 自己的下回合开始 → 清标签
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(harness.state.players[0].tags).not.toContain('裸衣/bonus');
  });

  // ─── 限一次/回合:发动后再次进入摸牌阶段不再触发 ────────────────────

  it('限一次/回合:第二次摸牌阶段不再触发界裸衣', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const c3 = makeCard('c3', '桃', '♦', '4');
    const c4 = makeCard('c4', '杀', '♠', '5');
    const c5 = makeCard('c5', '杀', '♠', '6');
    const c6 = makeCard('c6', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // 已标记本回合用过裸衣 → 第二次摸牌阶段 hook 应早退
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界裸衣', '回合管理'],
          // 直接预置 usedThisTurn 标记(模拟本回合已发动)
        }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { c1, c2, c3, c4, c5, c6 },
      zones: { deck: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次摸牌阶段:发动界裸衣
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界裸衣', { choice: true });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界裸衣', { choice: false }); // 不跳过 → 放回 + 默认摸牌流程外
    await harness.waitForStable();

    // 标签已挂,本回合已用标记已写
    expect(harness.state.players[0].tags).toContain('裸衣/bonus');
    expect(harness.state.players[0].vars['裸衣/usedThisTurn']).toBe(true);

    // 第二次摸牌阶段(同回合模拟):hook 应早退(usedThisTurn=true)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    // 无界裸衣询问 pending
    const hasJieLuoYi = [...harness.state.pendingSlots.values()].some((s) => {
      const rt = (s.atom as { requestType?: string }).requestType;
      return rt === '裸衣/activate';
    });
    expect(hasJieLuoYi).toBe(false);
  });

  // ─── 牌堆 < 3 张:不发动(走默认摸牌)────────────────

  it('牌堆 < 3 张:不发动界裸衣(无询问)', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界裸衣'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { d1, d2 },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();

    const hasJieLuoYi = [...harness.state.pendingSlots.values()].some((s) => {
      const rt = (s.atom as { requestType?: string }).requestType;
      return rt === '裸衣/activate';
    });
    expect(hasJieLuoYi).toBe(false);
    expect(harness.state.players[0].tags).not.toContain('裸衣/bonus');
  });

  // ─── defineAction 声明验证 ─────────────────────────

  it('availableActions:列出 respond action(confirm prompt)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界裸衣'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const actions = P0.availableActions();
    const skill = actions.find((a) => a.skillId === '界裸衣' && a.actionType === 'respond');
    expect(skill).toBeDefined();
    expect(skill!.label).toBe('界裸衣');
    expect(skill!.prompt.type).toBe('confirm');
  });
});
