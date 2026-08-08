// tests/skill-tests/青釭剑.test.ts
// 青釭剑(武器,攻击范围 2):锁定技。你使用【杀】指定目标后,目标角色的防具无效
// (仁王盾/八卦阵/藤甲/白银狮子不能对该次杀发动)。防具无效发生在"目标成为杀目标后、防具发动前"。
//
// 本文件为青釭剑装备技能审查新建(此前无测试文件),写法参考 tests/skill-tests/贯石斧.test.ts。
//
// 实现要点(src/engine/skills/青釭剑.ts):指定目标 after hook 临时卸载目标防具技能实例
// (unloadSkillInstance,只摘 hook,不动 player.skills/装备区),杀结算完毕后恢复(instantiateSkill)。
//
// 验证:
//   1. 核心:黑杀对仁王盾——青釭剑无视防具,杀不被判无效,命中扣血,结算后防具 hook 恢复
//   2. 对照(无青釭剑):黑杀对仁王盾——仁王盾生效,杀无效,不询问闪、不扣血
//   3. 杀被闪抵消后防具 hook 必须恢复(原实现仅在"造成伤害后"恢复,dodge 路径漏恢复)
//   4. 青釭剑只对【杀】生效:对非杀目标牌(过河拆桥)不应卸载防具且不泄漏
//   5. 无视八卦阵:杀指定目标后不弹八卦阵判定询问,直接询问闪
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import { getBeforeHooks } from '../../src/engine/core/skill';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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
    judgeZone: [],
    tags: [],
  };
}

const QINGGANG = makeCard('qc', '青釭剑', '♠', '6', '装备牌');
const RENWANG = makeCard('rw', '仁王盾', '♣', '2', '装备牌');
const BAGUA = makeCard('bg', '八卦阵', '♣', '2', '装备牌');

/** 目标(idx)的防具 before-hook 是否已注册(防具技能实例是否在位)。
 *  仁王盾挂 检测有效性 before-hook;八卦阵挂 询问闪 before-hook。 */
function armorHookLoaded(
  state: GameState,
  atomType: string,
  skillId: string,
  ownerId: number,
): boolean {
  return getBeforeHooks(state, atomType).some(
    (e) => e.skillId === skillId && e.ownerId === ownerId,
  );
}

describe('青釭剑', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 核心:黑杀对仁王盾,青釭剑无视 → 命中 + 命中后恢复 ─────

  it('用例1:青釭剑黑杀无视仁王盾,杀命中扣血,结算后防具hook恢复', async () => {
    const kill = makeCard('k1', '杀', '♠', '7'); // 黑杀
    const dodge = makeCard('d1', '闪', '♦', '2'); // P2 持闪,使询问闪产生 pending
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '青釭剑'],
          equipment: { 武器: 'qc' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪', '仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { qc: QINGGANG, rw: RENWANG, k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 初始仁王盾 hook 已注册
    expect(armorHookLoaded(harness.state, '检测有效性', '仁王盾', 1)).toBe(true);

    // P1 出黑杀指定 P2
    await P1.useCardAndTarget('杀', 'k1', [1]);
    // 青釭剑无视仁王盾 → 杀未被判无效 → 询问闪
    P2.expectPending('询问闪');
    // 不出闪
    await P2.pass();

    // 命中:P2 扣血(若无青釭剑,黑杀会被仁王盾判无效,不扣血)
    expect(harness.state.players[1].health).toBe(3);
    // 造成伤害后恢复:仁王盾 hook 回来
    expect(armorHookLoaded(harness.state, '检测有效性', '仁王盾', 1)).toBe(true);
  });

  // ─── 对照:无青釭剑,黑杀对仁王盾无效 ──────────────────

  it('用例2(对照):无青釭剑时黑杀对仁王盾无效,不询问闪、不扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7'); // 黑杀
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: ['闪', '仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { rw: RENWANG, k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);

    // 仁王盾生效:黑杀无效 → 不询问闪、不扣血
    P1.expectNoPending();
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── Bug:杀被闪抵消后防具 hook 必须恢复 ─────────────────

  it('用例3:黑杀被闪抵消后,仁王盾hook应恢复(原实现dodge路径漏恢复)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7'); // 黑杀
    const dodge = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '青釭剑'],
          equipment: { 武器: 'qc' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪', '仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { qc: QINGGANG, rw: RENWANG, k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // P2 出闪 → 杀被抵消
    await P2.respond('闪', { cardId: 'd1' });

    // 被抵消:无伤害
    expect(harness.state.players[1].health).toBe(4);
    // 青釭剑只在本次杀期间卸载防具,杀结算完毕(含被抵消)后必须恢复
    expect(armorHookLoaded(harness.state, '检测有效性', '仁王盾', 1)).toBe(true);
  });

  // ─── Bug:青釭剑只对【杀】生效,对非杀目标牌不应卸载防具 ───

  it('用例4:过河拆桥(非杀目标牌)不应触发青釭剑卸载防具,且防具hook不泄漏', async () => {
    const gq = makeCard('gq1', '过河拆桥', '♠', '3', '锦囊牌');
    const victim = makeCard('v1', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['gq1'],
          skills: ['过河拆桥', '青釭剑'],
          equipment: { 武器: 'qc' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['v1'],
          skills: ['仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { qc: QINGGANG, rw: RENWANG, gq1: gq, v1: victim },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 初始仁王盾 hook 已注册
    expect(armorHookLoaded(harness.state, '检测有效性', '仁王盾', 1)).toBe(true);

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass(); // 跳过无懈可击窗口
    // 选牌:拆 P2 手牌
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });

    // 过河拆桥结算完毕:仁王盾 hook 必须仍在(青釭剑只对杀生效,非杀牌不卸载防具)
    expect(harness.state.players[1].hand).toEqual([]);
    expect(armorHookLoaded(harness.state, '检测有效性', '仁王盾', 1)).toBe(true);
  });

  // ─── 无视八卦阵:杀指定目标后不弹判定询问,直接询问闪 ────

  it('用例5:青釭剑杀无视八卦阵,不弹八卦阵判定询问而直接询问闪', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♦', '2'); // P2 持闪,使询问闪产生 pending
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '青釭剑'],
          equipment: { 武器: 'qc' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪', '八卦阵'],
          equipment: { 防具: 'bg' },
        }),
      ],
      cardMap: { qc: QINGGANG, bg: BAGUA, k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // 八卦阵被青釭剑临时卸载 → 不弹 八卦阵/confirm,直接询问闪
    P2.expectPending('询问闪');
    await P2.pass();

    // 命中扣血
    expect(harness.state.players[1].health).toBe(3);
    // 八卦阵 hook(询问闪 before)结算后恢复
    expect(armorHookLoaded(harness.state, '询问闪', '八卦阵', 1)).toBe(true);
  });
});
