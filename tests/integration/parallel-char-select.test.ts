// 并行选将(并行选将 atom)集成测试:
//   主公选完后,其余玩家同时选将(各自独立 pending slot,Promise.all 等全部 resolve)。
//
// 验证:
//   1. applyAtom(并行选将) 后,每个 target 都有独立 pendingSlot(slot.atom.type='选将询问')
//   2. 各 target 独立 respond,互不阻塞;全部 respond 后 并行选将 的 applyAtom 才 resolve
//   3. 每个 target 拿到各自的候选人(不混淆)
//   4. respond 前 pendingSlots.size === selections.length;respond 后逐个减少
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';

function makePlayer(opts: { index: number; name: string }) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('并行选将:多 target 同时选将', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('applyAtom(并行选将) 为每个 target 创建独立 选将询问 slot', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1' }),
        makePlayer({ index: 1, name: 'P2' }),
        makePlayer({ index: 2, name: 'P3' }),
      ],
      cardMap: {},
    });
    await harness.setup(state);

    // 触发并行选将(不 await,它会挂起在 pending 上)
    const p = applyAtom(harness.state, {
      type: '并行选将',
      selections: [
        {
          target: 0,
          candidates: [
            { name: '刘备', skills: ['仁德'] },
            { name: '关羽', skills: ['武圣'] },
          ],
        },
        {
          target: 1,
          candidates: [
            { name: '孙权', skills: ['制衡'] },
            { name: '曹操', skills: ['奸雄'] },
          ],
        },
      ],
    });
    await waitForStable(harness.state);

    // 两个独立 slot(P0 和 P1),P2 无 slot
    expect(harness.state.pendingSlots.size).toBe(2);
    expect(harness.state.pendingSlots.get(0)?.atom.type).toBe('选将询问');
    expect(harness.state.pendingSlots.get(1)?.atom.type).toBe('选将询问');
    expect(harness.state.pendingSlots.has(2)).toBe(false);

    // 各 slot 候选人独立
    const slot0 = harness.state.pendingSlots.get(0)!;
    const slot1 = harness.state.pendingSlots.get(1)!;
    expect(
      (slot0.atom as { candidates: Array<{ name: string }> }).candidates.map((c) => c.name),
    ).toEqual(['刘备', '关羽']);
    expect(
      (slot1.atom as { candidates: Array<{ name: string }> }).candidates.map((c) => c.name),
    ).toEqual(['孙权', '曹操']);

    // P0 先选:只 resolve P0 的 slot,P1 仍 pending
    await harness.player(0).triggerAction('系统规则', '选将', { character: '关羽' });
    await waitForStable(harness.state);
    expect(harness.state.pendingSlots.size).toBe(1);
    expect(harness.state.pendingSlots.has(0)).toBe(false);
    expect(harness.state.pendingSlots.has(1)).toBe(true);
    expect(harness.state.players[0].character).toBe('关羽');

    // P1 再选:全部 resolve,并行选将 的 applyAtom resolve
    await harness.player(1).triggerAction('系统规则', '选将', { character: '孙权' });
    await p; // 等待 applyAtom 完成
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].character).toBe('孙权');
  });

  it('并行选将未全部 respond 时,父 applyAtom 不 resolve', async () => {
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
      cardMap: {},
    });
    await harness.setup(state);

    let resolved = false;
    const p = applyAtom(harness.state, {
      type: '并行选将',
      selections: [
        { target: 0, candidates: [{ name: '刘备', skills: ['仁德'] }] },
        { target: 1, candidates: [{ name: '孙权', skills: ['制衡'] }] },
      ],
    });
    p.then(() => {
      resolved = true;
    });
    await waitForStable(harness.state);

    // 只 P0 respond,P1 未 respond → 父不应 resolve
    await harness.player(0).triggerAction('系统规则', '选将', { character: '刘备' });
    await waitForStable(harness.state);
    expect(resolved).toBe(false);
    expect(harness.state.pendingSlots.size).toBe(1);

    // P1 respond 后才 resolve
    await harness.player(1).triggerAction('系统规则', '选将', { character: '孙权' });
    await p;
    expect(resolved).toBe(true);
  });

  it('validate:selections 为空 → 抛出异常', async () => {
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' })],
      cardMap: {},
    });
    await harness.setup(state);

    // applyAtom validate 失败时抛出异常
    await expect(
      applyAtom(harness.state, {
        type: '并行选将',
        selections: [],
      }),
    ).rejects.toThrow('selections required');
  });
});
