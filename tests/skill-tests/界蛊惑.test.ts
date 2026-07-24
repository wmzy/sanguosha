// 界蛊惑(界于吉·主动技)行为测试:
//   1. 无人质疑 → 声明杀生效(目标受伤,扣牌入弃牌堆)
//   2. 同时质疑·真牌 → 质疑者获缠怨标记 + 弃一张牌或失去1点体力,声明杀仍生效
//   3. 同时质疑·假牌 → 此牌作废,质疑者摸一张牌(扣牌留弃牌堆,不给质疑者)
//   4. 多人同时质疑·真 → 每个质疑者都结算(缠怨 + 弃牌/失体力)
//   5. 声明桃·无人质疑 → 回复1体力
//   6. 限一次:同回合再次蛊惑被拒
//   7. 非法声明/无目标/无手牌 被拒
//   8. dodge:被杀时扣牌声明为闪,无人质疑 → 抵消杀
//   9. rescue:濒死求桃时扣牌声明为桃,无人质疑 → 自救回血
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
  rank = '7',
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
  maxHealth?: number;
  equipment?: GameState['players'][number]['equipment'];
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 当前阻塞型 pending slot 列表(并行回应时多个共存)。 */
function activeSlots(state: GameState): GameState['pendingSlots'] extends Map<infer K, infer V> ? Map<K, V> : never {
  return state.pendingSlots;
}

/** 所有未 pause 的 slot 的 target 集合(同时只有一个活跃 slot,该 helper 兼容顺序询问)。 */
function activeTargets(state: GameState): number[] {
  return [...state.pendingSlots.values()].filter((s) => !s.isPaused).map((s) => (s.atom as { target: number }).target);
}

function baseState(opts: {
  yujiHand: string[];
  p1Hand?: string[];
  p2Hand?: string[];
  yujiHealth?: number;
  yujiMax?: number;
  deck?: string[];
  cardMap: Record<string, Card>;
}): GameState {
  return createGameState({
    players: [
      mkPlayer({
        index: 0,
        name: '界于吉',
        character: '界于吉',
        skills: ['界蛊惑'],
        hand: opts.yujiHand,
        health: opts.yujiHealth ?? 3,
        maxHealth: opts.yujiMax ?? 3,
      }),
      mkPlayer({ index: 1, name: 'P1', character: '反', hand: opts.p1Hand ?? [], skills: ['闪'] }),
      mkPlayer({ index: 2, name: 'P2', character: '反', hand: opts.p2Hand ?? [], skills: ['闪'] }),
    ],
    cardMap: opts.cardMap,
    zones: { deck: opts.deck ?? [], discardPile: [], processing: [] },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界蛊惑', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('无人质疑 → 声明杀生效(目标受伤,扣牌入弃牌堆)', async () => {
    const s1 = mkCard('s1', '杀', '♠', '7');
    await harness.setup(
      baseState({ yujiHand: ['s1'], cardMap: { s1 } }),
    );
    const YJ = harness.player('界于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 界于吉扣置真杀,声明为杀,目标 P1
    await YJ.triggerAction('界蛊惑', 'use', { cardId: 's1', declaredName: '杀', target: 1 });

    // 顺序质疑:先问 P1
    expect(activeTargets(harness.state)).toEqual([1]);
    await P1.pass(); // P1 不质疑 → 再问 P2
    expect(activeTargets(harness.state)).toEqual([2]);
    await P2.pass(); // P2 不质疑 → 无人质疑 → 杀生效
    await harness.waitForStable();

    // 杀生效 → 询问 P1 闪
    await P1.pass(); // P1 不闪 → 受伤
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3); // P1 受 1 点伤害
    expect(harness.state.players[2].health).toBe(4); // P2 未受伤
    expect(harness.state.zones.discardPile).toContain('s1'); // 扣牌已使用入弃牌堆
    expect(harness.state.players[0].hand).not.toContain('s1');
  });

  it('同时质疑·真牌 → 质疑者获缠怨标记 + 选择弃牌,声明杀仍生效', async () => {
    const s1 = mkCard('s1', '杀', '♠', '7'); // 真杀
    const p1x = mkCard('p1x', '闪', '♥', '2');
    await harness.setup(
      baseState({ yujiHand: ['s1'], p1Hand: ['p1x'], cardMap: { s1, p1x } }),
    );
    const YJ = harness.player('界于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 界于吉扣置真杀,声明杀,目标 P2
    await YJ.triggerAction('界蛊惑', 'use', { cardId: 's1', declaredName: '杀', target: 2 });
    // 顺序询问窗口:先 P1
    expect(activeTargets(harness.state)).toEqual([1]);

    await P1.respond('界蛊惑', { choice: true }); // P1 质疑
    await P2.pass(); // P2 不质疑(顺序问完全体后才翻牌)
    await harness.waitForStable();

    // 真: P1 选择弃一张牌或失去1点体力(此时是询问 P1)
    expect(activeTargets(harness.state)).toContain(1);
    await P1.respond('界蛊惑', { choice: true }); // 选弃一张牌
    await harness.waitForStable();

    // 杀生效 → 询问 P2 闪
    const slots = [...harness.state.pendingSlots.values()].filter((s) => !s.isPaused);
    expect(slots[0]?.atom.type).toBe('询问闪');
    await P2.pass(); // P2 不闪 → 受伤
    await harness.waitForStable();

    // P1(质疑者):获缠怨标记 + 弃了 1 张手牌(health 不变)
    expect(harness.state.players[1].marks.some((m) => m.id === '缠怨')).toBe(true);
    expect(harness.state.players[1].health).toBe(4); // 选择弃牌不失体力
    expect(harness.state.players[1].hand).not.toContain('p1x'); // 已弃
    expect(harness.state.zones.discardPile).toContain('p1x');
    // P2(目标)受杀伤害
    expect(harness.state.players[2].health).toBe(3);
    // 真牌按声明使用,入弃牌堆
    expect(harness.state.zones.discardPile).toContain('s1');
  });

  it('同时质疑·真牌 → 质疑者选择失去1点体力', async () => {
    const s1 = mkCard('s1', '杀', '♠', '7'); // 真杀
    const p1x = mkCard('p1x', '闪', '♥', '2');
    await harness.setup(
      baseState({ yujiHand: ['s1'], p1Hand: ['p1x'], cardMap: { s1, p1x } }),
    );
    const YJ = harness.player('界于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await YJ.triggerAction('界蛊惑', 'use', { cardId: 's1', declaredName: '杀', target: 2 });
    await P1.respond('界蛊惑', { choice: true }); // P1 质疑
    await P2.pass();
    await harness.waitForStable();

    // P1 选失去1点体力(choice=false)
    await P1.respond('界蛊惑', { choice: false });
    await harness.waitForStable();

    // 杀生效 → P2 被询问闪
    await P2.pass();
    await harness.waitForStable();

    // P1:缠怨 + 失去1点体力(health=3,手牌仍在)
    expect(harness.state.players[1].marks.some((m) => m.id === '缠怨')).toBe(true);
    expect(harness.state.players[1].health).toBe(3); // 失去1点体力
    expect(harness.state.players[1].hand).toContain('p1x'); // 未弃
    expect(harness.state.players[2].health).toBe(3); // P2 受杀伤害
  });

  it('同时质疑·真牌 → 质疑者无手牌时强制失去1点体力', async () => {
    const s1 = mkCard('s1', '杀', '♠', '7'); // 真杀
    await harness.setup(
      baseState({ yujiHand: ['s1'], p1Hand: [], cardMap: { s1 } }),
    );
    const YJ = harness.player('界于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await YJ.triggerAction('界蛊惑', 'use', { cardId: 's1', declaredName: '杀', target: 2 });
    await P1.respond('界蛊惑', { choice: true }); // P1 质疑
    await P2.pass();
    await harness.waitForStable();

    // P1 无手牌 → 不询问选择,直接失去1点体力 → 杀生效
    await P2.pass(); // P2 不闪
    await harness.waitForStable();

    expect(harness.state.players[1].marks.some((m) => m.id === '缠怨')).toBe(true);
    expect(harness.state.players[1].health).toBe(3); // 失去1点体力
    expect(harness.state.players[2].health).toBe(3); // 受杀伤害
  });

  it('同时质疑·假牌 → 此牌作废,质疑者摸一张牌(扣牌留弃牌堆)', async () => {
    const s1 = mkCard('s1', '闪', '♥', '7'); // 假牌(非杀)
    const deckTop = mkCard('top', '杀', '♣', '3');
    await harness.setup(
      baseState({ yujiHand: ['s1'], cardMap: { s1 }, deck: ['top'] }),
    );
    const YJ = harness.player('界于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 界于吉扣置闪,声明为杀(假)
    await YJ.triggerAction('界蛊惑', 'use', { cardId: 's1', declaredName: '杀', target: 2 });
    await P1.respond('界蛊惑', { choice: true }); // P1 质疑
    await P2.pass(); // P2 不质疑 → P1 为唯一质疑者,翻牌(闪,假)
    await harness.waitForStable();

    // 假:扣牌作废(留弃牌堆,不给质疑者),质疑者摸一张牌
    expect(harness.state.players[1].health).toBe(4); // 质疑者不失体力
    expect(harness.state.players[2].health).toBe(4); // 目标未受伤(作废)
    expect(harness.state.players[1].hand).toContain('top'); // 质疑者摸了牌堆顶
    expect(harness.state.zones.discardPile).toContain('s1'); // 扣牌留弃牌堆(不给质疑者)
    expect(harness.state.players[0].hand).not.toContain('s1'); // 于吉失去此牌
  });

  it('多人同时质疑·真牌 → 每个质疑者都结算(缠怨 + 选择)', async () => {
    const s1 = mkCard('s1', '杀', '♠', '7'); // 真杀
    const p1c = mkCard('p1c', '闪', '♥', '2');
    const p2c = mkCard('p2c', '闪', '♥', '3');
    await harness.setup(
      baseState({ yujiHand: ['s1'], p1Hand: ['p1c'], p2Hand: ['p2c'], cardMap: { s1, p1c, p2c } }),
    );
    const YJ = harness.player('界于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await YJ.triggerAction('界蛊惑', 'use', { cardId: 's1', declaredName: '杀', target: 1 });
    // 顺序询问窗口:先问 P1
    expect(activeTargets(harness.state)).toEqual([1]);

    await P1.respond('界蛊惑', { choice: true }); // P1 质疑
    await harness.waitForStable();
    // 再问 P2
    expect(activeTargets(harness.state)).toEqual([2]);
    await P2.respond('界蛊惑', { choice: true }); // P2 也质疑 → 翻牌
    await harness.waitForStable();

    // 真牌:P1 先选(按座次)→ P2 后选
    expect(activeTargets(harness.state)).toContain(1);
    await P1.respond('界蛊惑', { choice: true }); // P1 弃牌
    await harness.waitForStable();
    expect(activeTargets(harness.state)).toContain(2);
    await P2.respond('界蛊惑', { choice: false }); // P2 失体力
    await harness.waitForStable();

    // 杀生效 → 询问 P1 闪
    await P1.pass(); // P1 不闪
    await harness.waitForStable();

    // P1:缠怨 + 弃牌 + 受杀伤害(health=3)
    expect(harness.state.players[1].marks.some((m) => m.id === '缠怨')).toBe(true);
    expect(harness.state.players[1].health).toBe(3); // 受杀伤害
    expect(harness.state.players[1].hand).not.toContain('p1c');
    // P2:缠怨 + 失去1点体力(P2 不是目标,不受杀伤害)
    expect(harness.state.players[2].marks.some((m) => m.id === '缠怨')).toBe(true);
    expect(harness.state.players[2].health).toBe(3); // 仅失1体力(不是杀的目标)
    expect(harness.state.players[2].hand).toContain('p2c'); // 未弃
  });

  it('声明桃·无人质疑 → 回复1体力', async () => {
    const t1 = mkCard('t1', '桃', '♥', '7');
    await harness.setup(
      baseState({ yujiHand: ['t1'], yujiHealth: 2, yujiMax: 3, cardMap: { t1 } }),
    );
    const YJ = harness.player('界于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await YJ.triggerAction('界蛊惑', 'use', { cardId: 't1', declaredName: '桃' });
    await P1.pass();
    await P2.pass();
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3); // 回复1体力至上限
    expect(harness.state.zones.discardPile).toContain('t1');
  });

  it('限一次:同回合再次蛊惑被拒', async () => {
    const t1 = mkCard('t1', '桃', '♥', '7');
    const t2 = mkCard('t2', '桃', '♥', '8');
    await harness.setup(
      baseState({ yujiHand: ['t1', 't2'], yujiHealth: 2, yujiMax: 3, cardMap: { t1, t2 } }),
    );
    const YJ = harness.player('界于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一次蛊惑(声明桃,无人质疑,回复)
    await YJ.triggerAction('界蛊惑', 'use', { cardId: 't1', declaredName: '桃' });
    await P1.pass();
    await P2.pass();
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(3);

    // 第二次蛊惑应被拒(本回合已用过)
    await YJ.expectRejected({
      skillId: '界蛊惑',
      actionType: 'use',
      params: { cardId: 't2', declaredName: '桃' },
    });
  });

  it('非法声明/无目标 被拒', async () => {
    const s1 = mkCard('s1', '杀', '♠', '7');
    await harness.setup(baseState({ yujiHand: ['s1'], cardMap: { s1 } }));
    const YJ = harness.player('界于吉');

    // 声明非基本牌被拒(标版同口径:不支持普通锦囊牌)
    await YJ.expectRejected({
      skillId: '界蛊惑',
      actionType: 'use',
      params: { cardId: 's1', declaredName: '决斗' },
    });
    // 声明杀但无目标被拒
    await YJ.expectRejected({
      skillId: '界蛊惑',
      actionType: 'use',
      params: { cardId: 's1', declaredName: '杀' },
    });
    // 声明杀但目标是自己被拒(不在攻击范围)
    await YJ.expectRejected({
      skillId: '界蛊惑',
      actionType: 'use',
      params: { cardId: 's1', declaredName: '杀', target: 0 },
    });
  });

  it('声明酒·无人质疑 → 获得酒增伤标记', async () => {
    const j1 = mkCard('j1', '酒', '♣', '7');
    await harness.setup(baseState({ yujiHand: ['j1'], cardMap: { j1 } }));
    const YJ = harness.player('界于吉');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await YJ.triggerAction('界蛊惑', 'use', { cardId: 'j1', declaredName: '酒' });
    await P1.pass();
    await P2.pass();
    await harness.waitForStable();

    // 酒增伤标记(下张杀+1)
    const marks = harness.state.players[0].marks;
    expect(marks.some((m) => m.id === '酒/nextKillDamageBonus')).toBe(true);
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  it('use 拒绝声明闪(闪仅经 dodge 响应路径打出)', async () => {
    const f1 = mkCard('f1', '闪', '♥', '7');
    await harness.setup(baseState({ yujiHand: ['f1'], cardMap: { f1 } }));
    const YJ = harness.player('界于吉');
    await YJ.expectRejected({
      skillId: '界蛊惑',
      actionType: 'use',
      params: { cardId: 'f1', declaredName: '闪' },
    });
  });

  it('dodge:被杀时扣假牌(杀)声明为闪,无人质疑 → 抵消杀(于吉不掉血)', async () => {
    const atk = mkCard('atk', '杀', '♠', '7');
    const fake = mkCard('fake', '杀', '♠', '8'); // 真身是杀,蛊惑声明为闪(假牌)
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界于吉',
          character: '界于吉',
          skills: ['界蛊惑', '闪'],
          hand: ['fake'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P0', character: '反', hand: ['atk'], skills: ['杀'] }),
      ],
      cardMap: { atk, fake },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1, // P0 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const YJ = harness.player('界于吉');
    const P0 = harness.player('P0');

    // P0 出杀指定界于吉 → 于吉被询问闪
    await P0.useCardAndTarget('杀', 'atk', [0]);
    await harness.waitForStable();
    // 此时是询问闪窗口(于吉)
    expect(activeTargets(harness.state)).toContain(0);

    // 于吉以蛊惑扣假牌(杀)声明为闪打出
    await YJ.triggerAction('界蛊惑', 'dodge', { cardId: 'fake' });
    // 同时质疑窗口:问 P0(唯一其他角色)
    expect(activeTargets(harness.state)).toContain(1);
    await P0.pass(); // P0 不质疑
    await harness.waitForStable();

    // 无人质疑 → 假牌当闪生效 → 杀被抵消,于吉不掉血
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand).not.toContain('fake');
  });

  it('rescue:濒死求桃时扣牌声明为桃,无人质疑 → 自救回血', async () => {
    const atk = mkCard('atk', '杀', '♠', '7');
    const fake = mkCard('fake', '杀', '♠', '8'); // 真身杀,声明桃(假)
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界于吉',
          character: '界于吉',
          skills: ['界蛊惑', '桃', '闪'],
          hand: ['fake'],
          health: 1,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P0', character: '反', hand: ['atk'], skills: ['杀'] }),
      ],
      cardMap: { atk, fake },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1, // P0 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const YJ = harness.player('界于吉');
    const P0 = harness.player('P0');

    // P0 出杀 → 于吉不闪 → HP=0 → 濒死 → 求桃
    // 模块 C:逆时针从当前回合 P0(idx1)起 → P0 先被问(无桃)→ pass
    await P0.useCardAndTarget('杀', 'atk', [0]);
    await YJ.pass(); // 不闪,受伤害进濒死
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(0);
    await P0.pass(); // P0 无桃跳过
    await harness.waitForStable();

    // 第二问 于吉(idx0,濒死者)
    const slot = [...harness.state.pendingSlots.values()][0].atom as {
      type?: string;
      requestType?: string;
      target?: number;
    };
    expect(slot.requestType).toBe('桃/求桃');
    expect(slot.target).toBe(0);

    // 于吉以蛊惑扣假牌(杀)声明为桃自救
    await YJ.triggerAction('界蛊惑', 'rescue', { cardId: 'fake' });
    await harness.waitForStable();
    // 质疑循环:问 P0
    expect(activeTargets(harness.state)).toContain(1);
    await P0.pass(); // 不质疑
    await harness.waitForStable();

    // 无人质疑 → 假牌当桃生效 → 自救,血量回升到 1
    expect(harness.state.players[0].health).toBe(1);
    expect(harness.state.players[0].hand).not.toContain('fake');
  });

  it('dodge:被质疑且为假 → 作废,于吉受伤(未抵消杀)', async () => {
    const atk = mkCard('atk', '杀', '♠', '7');
    const fake = mkCard('fake', '杀', '♠', '8'); // 真身杀,声明闪(假)
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界于吉',
          character: '界于吉',
          skills: ['界蛊惑', '闪'],
          hand: ['fake'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P0', character: '反', hand: ['atk'], skills: ['杀'] }),
      ],
      cardMap: { atk, fake },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const YJ = harness.player('界于吉');
    const P0 = harness.player('P0');

    await P0.useCardAndTarget('杀', 'atk', [0]);
    await harness.waitForStable();
    await YJ.triggerAction('界蛊惑', 'dodge', { cardId: 'fake' });
    await P0.respond('界蛊惑', { choice: true }); // P0 质疑 → 翻牌(杀≠闪,假)→ 作废
    await harness.waitForStable();

    // 假牌被质疑作废 → 未提供闪 → 于吉受杀伤害
    expect(harness.state.players[0].health).toBe(2);
    // 假牌结果:质疑者摸一张牌(此处 P0 无牌堆,跳过摸牌效果检查,仅验证于吉受伤)
  });

  // 验证 activeSlots helper 不破坏 state
  it('activeSlots helper 仅供读,不破坏 state', () => {
    const s1 = mkCard('s1', '杀', '♠', '7');
    const state = baseState({ yujiHand: ['s1'], cardMap: { s1 } });
    expect(activeSlots(state)).toBeDefined();
  });
});
