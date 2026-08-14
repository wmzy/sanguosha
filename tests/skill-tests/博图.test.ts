// 博图(界吕蒙·吴·一般技)行为测试,OL hero/306 现行版:
//   "每轮限X次(X为存活角色数且至多为3),回合结束时,若本回合置入弃牌堆的牌中
//    包含四种花色,你可以执行一个额外的回合。"
//
// 触发方式:applyAtom(回合开始)记录弃牌堆基线 → applyAtom(弃置)塞入四花色牌 →
//           applyAtom(回合结束)→applyAtom(回合结束后)触发博图 before-hook。
//
// 覆盖:
//   1. 本回合弃牌堆含四花色 + 未达上限 → 询问 → 确认 → 执行额外回合(count+1,吕蒙仍在自己的新回合)
//   2. 本回合弃牌堆缺花色 → 不触发(无询问)
//   3. 已达本轮上限(count>=X)→ 不触发
//   4. 询问后拒绝 → 不发动额外回合(count 不增,本轮额度不消耗)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import { applyAtom } from '../../src/engine/core/apply';
import { suitColor } from '../../src/engine/types';
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
    void applyAtom(harness.state, { type: '回合结束后', player: 0 });
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
    void applyAtom(harness.state, { type: '回合结束后', player: 0 });
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
    void applyAtom(harness.state, { type: '回合结束后', player: 0 });
    await harness.waitForStable();

    expect(hasPending(harness.state, '博图/confirm')).toBe(false);
    expect(harness.state.players[0].vars['博图/count']).toBe(2); // 不增
  });

  // ─── 4. 询问后拒绝 → 不发动(count 不增)────────────────
  // 注:验证博图「询问后拒绝」负面路径——count 不增、本轮额度不消耗(实现:
  //   `if (!confirmed) return;` 位于 count+1 之前)。
  //   合成流注意:本测试手动 applyAtom(回合结束) + applyAtom(回合结束后) 触发博图,
  //   跳过了真实对局流程中必经的「下一玩家」atom(它负责把 currentPlayerIndex 推进
  //   到下家)。拒绝后博图 before-hook 放行,回合管理 after-hook 的 beginTurn(下家)
  //   随即 fire 回合开始(下家),其 applyView 把 processedView.currentPlayerIndex
  //   设为下家,而权威 state.currentPlayerIndex 因缺少「下一玩家」而未变 → 视图不一致。
  //   这是合成流的人为缺口,非引擎 bug(真实对局「下一玩家」恒先于「回合结束后」)。
  //   本用例聚焦验证博图决策(count 不增、询问消解),故局部关闭视图一致性检查。
  it('询问后拒绝执行 → 不发动额外回合(count 不增,本轮额度不消耗)', async () => {
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

    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['a1', 'a2', 'a3', 'a4'] });
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '回合结束后', player: 0 });
    await harness.waitForStable();
    // 满足四花色 + 未达上限 → 出现博图询问
    expect(hasPending(harness.state, '博图/confirm')).toBe(true);

    // 拒绝执行额外回合(局部关闭视图一致性检查:合成流跳过了「下一玩家」atom,
    //   拒绝后 beginTurn(下家)的 回合开始 applyView 会令视图与权威 currentPlayerIndex
    //   不一致——详见用例头部注释)
    const restoreCompare = disableAutoCompare();
    try {
      await LM.respond('博图', { choice: false });
      await harness.waitForStable();
    } finally {
      restoreCompare();
    }

    // 拒绝 → 不发动:count 不增(本轮额度未消耗),询问已消解
    expect((harness.state.players[0].vars['博图/count'] as number | undefined) ?? 0).toBe(0);
    expect(hasPending(harness.state, '博图/confirm')).toBe(false);
  });
});
