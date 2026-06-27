// 集成测试:弃置装备区的牌时,装备自带的技能实例被卸载(防残留)。
//
// Bug 根因:弃置 atom 直接把 equipment 的牌移到弃牌堆,没有触发 移除技能。
// 换装备(装备通用)走显式 移除技能→卸下→弃牌堆 序列,技能正常卸载;
// 但 制衡/寒冰剑/麒麟弓/过河拆桥 等用 弃置 atom 弃装备时,技能实例(hook/vars/action)残留。
//
// 修复:系统规则 注册 弃置 after-hook——apply 后检查被弃的牌是否原属装备区且自带技能,
// 若是则 applyAtom(移除技能) 卸载实例。所有调用 弃置 的技能自动受益。
//
// 验证维度:
//   1. player.skills 不再含装备技能名(移除技能 apply)
//   2. 技能 hook 实例已卸载(卸载后 slashMax 提供者消失 / vars 清除)
//   3. 弃牌堆含被弃装备(弃置 本身仍正常)
import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest, registerSkillsFromState } from '../../src/engine/create-engine';
import { dispatchAndWait } from '../engine-harness';
import { slashMax } from '../../src/engine/slash-quota';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number; name: string;
  hand?: string[]; equipment?: Record<string, string>;
  skills?: string[]; health?: number; maxHealth?: number;
}) {
  return {
    index: opts.index, name: opts.name, character: '',
    health: opts.health ?? 4, maxHealth: opts.maxHealth ?? 4, alive: true,
    hand: opts.hand ?? [], equipment: opts.equipment ?? {},
    skills: opts.skills ?? [], vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [],
  };
}

function makeEquip(id: string, name: string, subtype: string, range?: number): Card {
  return { id, name, suit: '♣', color: '黑', rank: 'A', type: '装备牌', subtype, range };
}
function makeCard(id: string, name: string): Card {
  return { id, name, suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
}

describe('弃置装备:卸载自带技能实例', () => {
  beforeEach(() => { resetForTest(); });

  it('制衡弃掉武器(诸葛连弩)→ skills 不再含 诸葛连弩,slashMax 提供者消失', async () => {
    const zhuge = makeEquip('wp-zg', '诸葛连弩', '武器', 1);
    const d1 = makeCard('d1', '杀');
    const state: GameState = createGameState({
      players: [
        // 初始已装备诸葛连弩:skills 含 '诸葛连弩' 让 registerSkillsFromState 实例化它。
        // 武器范围 vars(距离/出杀范围)由 装备 atom 设,初始装备不走 atom,这里手动补齐。
        makePlayer({
          index: 0, name: 'P0', hand: [],
          equipment: { 武器: 'wp-zg' },
          skills: ['制衡', '杀', '诸葛连弩'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { 'wp-zg': zhuge, d1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.players[0].vars['距离/出杀范围'] = 1;
    await registerSkillsFromState(state);

    // 诸葛连弩 实例已挂载:skills 含它 + slashMax=∞
    expect(state.players[0].skills).toContain('诸葛连弩');
    expect(slashMax(state, 0)).toBe(Infinity);

    // 制衡:弃掉装备区的诸葛连弩
    await dispatchAndWait(state, {
      skillId: '制衡', actionType: 'use', ownerId: 0,
      params: { cardIds: ['wp-zg'] }, baseSeq: state.seq,
    });

    // 装备走了
    expect(state.players[0].equipment['武器']).toBeUndefined();
    expect(state.zones.discardPile).toContain('wp-zg');
    // 装备技能实例被卸载:skills 不再含 诸葛连弩
    expect(state.players[0].skills).not.toContain('诸葛连弩');
    // hook 提供者消失 → slashMax 回落基础值 1
    expect(slashMax(state, 0)).toBe(1);
  });

  it('制衡弃掉防具(八卦阵)→ skills 不再含 八卦阵', async () => {
    const bagua = makeEquip('ar-bg', '八卦阵', '防具');
    const d1 = makeCard('d1', '杀');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0', hand: [],
          equipment: { 防具: 'ar-bg' },
          skills: ['制衡', '杀', '八卦阵'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { 'ar-bg': bagua, d1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    expect(state.players[0].skills).toContain('八卦阵');

    await dispatchAndWait(state, {
      skillId: '制衡', actionType: 'use', ownerId: 0,
      params: { cardIds: ['ar-bg'] }, baseSeq: state.seq,
    });

    expect(state.players[0].equipment['防具']).toBeUndefined();
    expect(state.zones.discardPile).toContain('ar-bg');
    expect(state.players[0].skills).not.toContain('八卦阵');
  });

  it('制衡弃掉进攻马(赤兔)→ 距离/进攻修正 vars 被清除', async () => {
    const chitu = makeEquip('mt-ct', '赤兔', '进攻马');
    const d1 = makeCard('d1', '杀');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0', hand: [],
          equipment: { 进攻马: 'mt-ct' },
          skills: ['制衡', '杀', '赤兔'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { 'mt-ct': chitu, d1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 赤兔 onInit 设了距离修正
    expect(state.players[0].skills).toContain('赤兔');
    expect(state.players[0].vars['距离/进攻修正']).toBe(1);

    await dispatchAndWait(state, {
      skillId: '制衡', actionType: 'use', ownerId: 0,
      params: { cardIds: ['mt-ct'] }, baseSeq: state.seq,
    });

    expect(state.players[0].equipment['进攻马']).toBeUndefined();
    expect(state.zones.discardPile).toContain('mt-ct');
    expect(state.players[0].skills).not.toContain('赤兔');
    // 马匹技能 onInit 返回的 cleanup 清 vars
    expect(state.players[0].vars['距离/进攻修正']).toBeUndefined();
  });

  it('制衡弃手牌(无装备)→ 不触发任何技能卸载(回归:非装备弃置不受影响)', async () => {
    const h1 = makeCard('h1', '杀');
    const d1 = makeCard('d1', '杀');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['h1'], equipment: {}, skills: ['制衡', '杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { h1, d1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const skillsBefore = state.players[0].skills.slice();

    await dispatchAndWait(state, {
      skillId: '制衡', actionType: 'use', ownerId: 0,
      params: { cardIds: ['h1'] }, baseSeq: state.seq,
    });

    // 手牌制衡不应改变 skills
    expect(state.players[0].skills).toEqual(skillsBefore);
    expect(state.zones.discardPile).toContain('h1');
  });
});
