// 界贞烈(界王异·魏·被动技)行为测试:
//   OL 界限突破官方逐字:
//   "当你成为其他角色【杀】或普通锦囊牌的目标后,你可以失去1点体力令此牌对你无效,
//    然后你可以选择一项:1.获得使用者一张牌;2.本回合结束阶段,发动一次'秘计'。"
//
// 验证场景:
//   ① 杀 + 选项①(获得一张牌):失 1 体 + 杀无效 + 获得来源 1 张牌
//   ② 杀 + 选项②(秘计挂起):失 1 体 + 杀无效 + 写 turn.vars 秘计挂起标记
//   ③ 杀 + 不发动:正常询问闪,不出闪扣血
//   ④ 顺手牵羊 + 选项①:失 1 体 + 锦囊无效(不获得王异任何牌) + 获来源 1 张牌
//   ⑤ 南蛮入侵:失 1 体 + 不询问出杀 + 不受伤害
//   ⑥ 自己用杀 → 不触发(描述"其他角色")
//   ⑦ 1 体力发动贞烈:0 体力进濒死;选项不再询问;无效仍生效
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  trickSubtype?: '普通锦囊' | '延时锦囊' | '响应锦囊',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, trickSubtype };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界王异',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: '魏',
  };
}

describe('界贞烈', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── ① 杀 + 选项①(获得来源一张牌)─────────────────────────

  it('①:成杀目标后发动贞烈,选项① → 失1体+杀无效+获来源一张牌', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const sourceCard = makeCard('p1c1', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界贞烈', '界秘计'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1', 'p1c1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k1: kill, p1c1: sourceCard },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await harness.player('P1').useCardAndTarget('杀', 'k1', [0]);
    P0.expectPending('请求回应'); // 贞烈发动确认

    await P0.respond('界贞烈', { choice: true });
    P0.expectPending('请求回应'); // 选项①/②

    await P0.respond('界贞烈', { choice: true }); // confirm=true → 选项①(获得一张牌)
    P0.expectPending('请求回应'); // 选牌面板

    // 来源仅 1 张手牌(闪) → 选 handIndex=0
    await P0.respond('界贞烈', { zone: 'hand', handIndex: 0 });
    await harness.waitForStable();

    // 断言:P0 失1体(3→2);杀无效(P0 不再扣血);P0 获得 P1 的闪;杀入弃牌堆
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand).toEqual(['p1c1']);
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── ② 杀 + 选项②(秘计挂起)──────────────────────────────

  it('②:成杀目标后发动贞烈,选项② → 失1体+杀无效+写秘计挂起标记', async () => {
    const kill = makeCard('k2', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界贞烈', '界秘计'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k2'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k2: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await harness.player('P1').useCardAndTarget('杀', 'k2', [0]);
    P0.expectPending('请求回应'); // 贞烈发动确认

    await P0.respond('界贞烈', { choice: true });
    P0.expectPending('请求回应'); // 选项①/②

    // choice=false → 选项②(发动秘计)
    await P0.respond('界贞烈', { choice: false });
    await harness.waitForStable();

    // 断言:P0 失1体;杀无效;秘计挂起标记已写
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.zones.discardPile).toContain('k2');
    expect(harness.state.turn.vars['秘计/pendingFrom贞烈/0']).toBe(true);
  });

  // ─── ③ 不发动贞烈 → 正常询问闪 ────────────────────────────

  it('③:不发动贞烈 → 正常询问闪,不出闪扣血', async () => {
    const kill = makeCard('k3', '杀', '♠', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界贞烈', '界秘计'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k3'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k3: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await harness.player('P1').useCardAndTarget('杀', 'k3', [0]);
    P0.expectPending('请求回应'); // 贞烈发动确认

    // 不发动
    await P0.respond('界贞烈', { choice: false });
    P0.expectPending('询问闪'); // 正常进入询问闪

    await P0.pass(); // 不出闪
    await harness.waitForStable();

    // 断言:P0 扣 1 血(3→2);杀入弃牌堆
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.zones.discardPile).toContain('k3');
  });

  // ─── ④ 顺手牵羊 + 选项①:锦囊无效 + 获来源一张牌 ─────────

  it('④:成顺手牵羊目标后发动贞烈 → 失1体+锦囊无效+获来源一张牌', async () => {
    const trick = makeCard('t1', '顺手牵羊', '♠', '3', '锦囊牌', '普通锦囊');
    const sourceCard = makeCard('p1c2', '桃', '♦', '5');
    const myCard = makeCard('p0c1', '杀', '♣', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['p0c1'],
          skills: ['界贞烈', '界秘计'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['t1', 'p1c2'],
          skills: ['顺手牵羊'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { t1: trick, p1c2: sourceCard, p0c1: myCard },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P1 用顺手牵羊 → 贞烈在无懈窗口打开前触发
    await P1.triggerAction('顺手牵羊', 'use', { cardId: 't1', target: 0 });
    await harness.waitForStable();
    P0.expectPending('请求回应'); // 贞烈发动确认

    await P0.respond('界贞烈', { choice: true });
    P0.expectPending('请求回应'); // 选项①/②

    await P0.respond('界贞烈', { choice: true }); // 选项①(获得来源一张牌)
    P0.expectPending('请求回应'); // 选牌面板(从 P1 处选)

    await P0.respond('界贞烈', { zone: 'hand', handIndex: 0 }); // 选 P1 手牌[0]=p1c2
    await harness.waitForStable();

    // 无懈窗口(广播)超时
    await P0.pass();
    await harness.waitForStable();

    // P1 顺手牵羊选牌面板(即使贞烈已令锦囊无效,仍弹面板 — 获得 atom 会被 cancel)
    P1.expectPending('请求回应');
    await P1.respond('顺手牵羊', { zone: 'hand', handIndex: 0 }); // P1 试图获 p0c1
    await harness.waitForStable();

    // 断言:P0 失1体(3→2);贞烈获来源 p1c2 成功;顺手牵羊无效(P0 未失去 p0c1)
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand).toContain('p0c1');
    expect(harness.state.players[0].hand).toContain('p1c2');
    expect(harness.state.players[1].hand).not.toContain('p1c2');
    expect(harness.state.zones.discardPile).toContain('t1');
  });

  // ─── ⑤ 南蛮入侵:失1体+不询问出杀+不受伤害 ────────────────

  it('⑤:成南蛮入侵目标后发动贞烈 → 失1体+不被询问出杀+不受伤害', async () => {
    const trick = makeCard('nm1', '南蛮入侵', '♠', 'A', '锦囊牌', '普通锦囊');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界贞烈', '界秘计'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['nm1'],
          skills: ['南蛮入侵'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { nm1: trick },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await harness.player('P1').useCard('南蛮入侵', 'nm1');
    // 无懈窗口打开前 → 贞烈触发
    P0.expectPending('请求回应');

    await P0.respond('界贞烈', { choice: true });
    P0.expectPending('请求回应'); // 选项①/②

    await P0.respond('界贞烈', { choice: true }); // 选项①,但来源无牌 → 跳过
    await harness.waitForStable();

    // 等待无懈窗口超时
    await P0.pass();
    await harness.waitForStable();

    // 断言:P0 失1体(3→2);南蛮无效(P0 不被询问出杀、不受伤害);
    // P0 不会进入濒死(2>0);锦囊入弃牌堆
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.zones.discardPile).toContain('nm1');
    // 验证未被询问出杀:无 pending 残留
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── ⑥ 自己用杀 → 不触发贞烈("其他角色") ────────────────

  it('⑥:王异自己用杀指定目标 → 贞烈不触发(非"其他角色"对王异)', async () => {
    const kill = makeCard('k6', '杀', '♠', '6');
    const dodge = makeCard('d6', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k6'],
          skills: ['界贞烈', '界秘计', '杀'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['d6'],
          skills: ['闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k6: kill, d6: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await harness.player('P0').useCardAndTarget('杀', 'k6', [1]);
    // P1 被询问闪(无贞烈触发,因 atom.source=0=王异自己,非"其他角色")
    P1.expectPending('询问闪');

    await P1.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3); // P1 扣 1 血
  });
});
