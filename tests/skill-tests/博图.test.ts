// 博图(界吕蒙·吴·一般技)行为测试,OL hero/306 现行版:
//   "每轮限X次(X为存活角色数且至多为3),回合结束时,若本回合置入弃牌堆的牌中
//    包含四种花色,你可以执行一个额外的回合。"
//
// 触发方式:applyAtom(回合开始)记录弃牌堆基线 → applyAtom(弃置)塞入四花色牌 →
//           applyAtom(回合结束)触发博图 before-hook。
//
// 覆盖:
//   1. 本回合弃牌堆含四花色 + 未达上限 → 询问 → 确认 → 执行额外回合(count+1,吕蒙仍在自己的新回合)
//   2. 本回合弃牌堆缺花色 → 不触发(无询问)
//   3. 已达本轮上限(count>=X)→ 不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as PlayerState['vars'],
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 当前 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  if (state.pendingSlots.size === 0) return null;
  const slot = [...state.pendingSlots.values()][0];
  return (slot.atom as { requestType?: string }).requestType ?? null;
}

/** 是否存在 requestType 为 rt 的 pending */
function hasPending(state: GameState, rt: string): boolean {
  for (const slot of state.pendingSlots.values()) {
    if ((slot.atom as { requestType?: string }).requestType === rt) return true;
  }
  return false;
}

describe('博图', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 四花色 + 未达上限 → 确认 → 额外回合 ───────────────
  it('本回合弃牌堆含四花色 → 确认 → 执行额外回合(count+1,吕蒙仍处自己的新回合)', async () => {
    const c1 = mkCard('a1', '杀', '♠', '7');
    const c2 = mkCard('a2', '闪', '♥', '3');
    const c3 = mkCard('a3', '桃', '♣', '5');
    const c4 = mkCard('a4', '酒', '♦', '9');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界吕蒙',
            hand: ['a1', 'a2', 'a3', 'a4'],
            skills: ['博图', '回合管理'],
          }),
          mkPlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
        ],
        cardMap: { a1: c1, a2: c2, a3: c3, a4: c4 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LM = harness.player('界吕蒙');

    // 1) 回合开始 → 博图记录弃牌堆基线
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    // 2) 本回合置入四花色牌到弃牌堆
    await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['a1', 'a2', 'a3', 'a4'] });
    // 3) 回合结束 → 博图 before-hook 询问
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    expect(hasPending(harness.state, '博图/confirm')).toBe(true);

    // 确认执行额外回合
    await LM.respond('博图', { choice: true });
    await harness.waitForStable();

    // 额外回合启动:count=1,吕蒙仍是当前玩家,推进到出牌阶段(出牌窗口 pending)
    expect(harness.state.players[0].vars['博图/count']).toBe(1);
    expect(harness.state.currentPlayerIndex).toBe(0);
    expect(harness.state.phase).toBe('出牌');
  });

  // ─── 2. 缺花色 → 不触发 ────────────────────────────────
  it('本回合弃牌堆缺花色 → 博图不触发(无询问)', async () => {
    const c1 = mkCard('a1', '杀', '♠', '7');
    const c2 = mkCard('a2', '闪', '♠', '3'); // 只有一种花色
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界吕蒙',
            hand: ['a1', 'a2'],
            skills: ['博图', '回合管理'],
          }),
          mkPlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
        ],
        cardMap: { a1: c1, a2: c2 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['a1', 'a2'] });
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();

    // 不触发博图:无 博图/confirm 询问,且 count 未增
    expect(hasPending(harness.state, '博图/confirm')).toBe(false);
    expect((harness.state.players[0].vars['博图/count'] as number | undefined) ?? 0).toBe(0);
    // 回合结束未被 cancel(博图放行):回合管理 after-hook 启动下家回合
    // (注:直接 applyAtom(回合结束) 不走 下一玩家 atom,故 currentPlayerIndex 不变;
    //  这里仅验证博图决策——不询问、count 不增——即未发动。)
  });

  // ─── 3. 已达本轮上限(count>=X)→ 不触发 ─────────────────
  it('已达本轮上限(count>=X)→ 即使四花色也不触发', async () => {
    // 2 人局 X=min(2,3)=2;预置 count=2 → 达上限
    const c1 = mkCard('a1', '杀', '♠', '7');
    const c2 = mkCard('a2', '闪', '♥', '3');
    const c3 = mkCard('a3', '桃', '♣', '5');
    const c4 = mkCard('a4', '酒', '♦', '9');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界吕蒙',
            hand: ['a1', 'a2', 'a3', 'a4'],
            skills: ['博图', '回合管理'],
            vars: { '博图/lastRound': 1, '博图/count': 2 }, // 已达上限
          }),
          mkPlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
        ],
        cardMap: { a1: c1, a2: c2, a3: c3, a4: c4 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['a1', 'a2', 'a3', 'a4'] });
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();

    expect(hasPending(harness.state, '博图/confirm')).toBe(false);
    expect(harness.state.players[0].vars['博图/count']).toBe(2); // 不增
    expect(currentRequestType(harness.state)).not.toBe('博图/confirm');
  });
});
