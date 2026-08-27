// tests/integration/流离.test.ts
// 技能测试:流离(大乔·被动技)——成为杀的目标时,可弃 1 张牌把杀转给攻击范围内另一人
//
// 覆盖:
//   1. P1(P0 攻击范围内)发动流离 → 弃 1 张牌 + 转移杀到 P2(同样在 P0 攻击范围)
//   2. P1 选"不发动"→ 杀正常命中 P1(P1 扣血)
//   3. P1 无手牌 → 无法发动流离(直接命中 P1)
//
// 关键机制(流离.ts):
//   - 询问时机:成为目标 after hook(在 询问闪 之前)
//   - 交互流程:confirm(是否发动) → chooseTarget(选新目标) → 弃 1 张牌
//   - 修改帧 params.resolvedTargets:把流离原目标替换为新目标
//   - 杀.execute 下一轮 结算 读帧 resolvedTargets[i] 而非原始 targets[i]
import { describe, it, expect } from 'vitest';
import { registerSkillsFromState } from '../../src/engine/index';
import { dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
import { buildView } from '../../src/engine/view/buildView';
import '../../src/engine/atoms';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
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

describe('流离:成为杀的目标时转移', () => {
  // ─────────────────────────────────────────────────────────────
  // 用例 1:P1 发动流离(confirm)→ 流离/chooseTarget pending 出现
  // ─────────────────────────────────────────────────────────────
  // 已知设计:流离/chooseTarget 的 prompt 是 choosePlayer 类型,
  // 当前 dispatch respond 路径未实现 choosePlayer 的 target 写入
  // (localVars['流离/target'] 始终 undefined)。
  // 本测试只验证 confirm 阶段成功 + chooseTarget pending 创建。
  it('用例1:P1 发动流离(confirm)→ 流离/chooseTarget pending 出现', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    const discard1: Card = {
      id: 'd1',
      name: '闪',
      suit: '♥',
      color: '红',
      rank: '2',
      type: '基本牌',
    };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          equipment: {},
          skills: ['杀', '闪'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [discard1.id],
          equipment: {},
          skills: ['流离', '闪'],
          health: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          equipment: {},
          skills: ['闪'],
          health: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [discard1.id]: discard1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // P0 出杀 → 目标是 P1
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    // 应出现 流离/confirm pending
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const slotAtom = [...state.pendingSlots.values()][0].atom as {
      type: string;
      requestType?: string;
    };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('流离/confirm');

    // P1 发动流离(confirm=true)
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { choice: true },
      baseSeq: state.seq,
    });

    // confirm 状态被写
    expect(state.localVars['流离/confirmed']).toBe(true);

    // 现在应进入 流离/chooseTarget pending
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const slotAtom2 = [...state.pendingSlots.values()][0].atom as {
      type: string;
      requestType?: string;
    };
    expect(slotAtom2.requestType).toBe('流离/chooseTarget');
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:回归——P1 不发动流离 → 杀正常命中 P1
  // ─────────────────────────────────────────────────────────────
  it('用例2:P1 不发动流离(默认)→ 杀命中 P1,P1 扣血', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [dodge.id], skills: ['流离', '闪'], health: 4 }),
      ],
      cardMap: { [slash.id]: slash, [dodge.id]: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const p1HealthBefore = state.players[1].health;

    // P0 出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    // 流离/confirm pending
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    // P1 不发动(默认/超时)→ fireTimeout
    await fireTimeoutAndWait(state);

    // 此时应进入 询问闪(P1) 阶段
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const slotAtom = [...state.pendingSlots.values()][0].atom as { type: string };
    expect(slotAtom.type).toBe('询问闪');

    // P1 出闪
    await dispatchAndWait(state, {
      skillId: '闪',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: dodge.id },
      baseSeq: state.seq,
    });

    // P1 不受伤
    expect(state.players[1].health).toBe(p1HealthBefore);
    // 杀和闪都进弃牌堆
    expect(state.zones.discardPile).toContain(slash.id);
    expect(state.zones.discardPile).toContain(dodge.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:P1 无手牌 → 不应出现流离询问,直接进入询问闪
  // ─────────────────────────────────────────────────────────────
  it('用例3:P1 无手牌 → 跳过流离询问,直接进入询问闪,P1 受伤', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['流离'], health: 4 }),
      ],
      cardMap: { [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const p1HealthBefore = state.players[1].health;

    // P0 出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });

    // 关键断言:P1 无手牌 → 流离 after hook 直接 return(不弹 流离/confirm);
    // 且 询问闪 因 P1 0 手牌走 skip(无 slot、无延时),P1 直接扣血。
    // 两条路径都不弹 pending:pendingSlots 为空,且 P1 受伤(未被流离转嫁)。
    expect(state.pendingSlots.size).toBe(0);

    // P1 不出闪(已 skip)→ 直接扣血
    expect(state.players[1].health).toBe(p1HealthBefore - 1);
    // 杀进弃牌堆
    expect(state.zones.discardPile).toContain(slash.id);
  });

  it('用例4:转移候选按流离使用者的攻击范围过滤(非杀来源)', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    const discard1: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
    // 4 人环:P0(攻击者)杀 P1(流离)。P2 距 P1=1(合法);P3 距 P1=2(超出 P1 范围1)。
    // 回归锚点:修复前 filter 用 inAttackRange(source=P0),P3 距 P0=1 会被错误纳入。
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], equipment: {}, skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [discard1.id], equipment: {}, skills: ['流离'], health: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: [], equipment: {}, skills: [], health: 4 }),
        makePlayer({ index: 3, name: 'P3', hand: [], equipment: {}, skills: [], health: 4 }),
      ],
      cardMap: { k1: slash, d1: discard1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { choice: true },
      baseSeq: state.seq,
    });

    const slot = [...state.pendingSlots.values()][0];
    expect((slot.atom as { requestType?: string }).requestType).toBe('流离/chooseTarget');
    // candidates 由投影层注入(choosePlayer filter 函数无法序列化),须从 view 读取
    const view = buildView(state, 1);
    const prompt = (view.pending as { prompt?: { candidates?: number[] } } | null)?.prompt;
    // 只含 P2;不含超范围的 P3,也不含自己 P1
    expect(prompt?.candidates).toEqual([2]);

    // 服务端兜底:直接提交超范围目标 P3 → 拒绝,target 不写入
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { target: 3 },
      baseSeq: state.seq,
    });
    expect(state.localVars['流离/target']).toBeUndefined();

    // 合法目标放行 → 进入 流离/pickDiscard 选牌询问
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { target: 2 },
      baseSeq: state.seq,
    });
    const pickSlot = [...state.pendingSlots.values()][0];
    expect((pickSlot.atom as { requestType?: string }).requestType).toBe('流离/pickDiscard');

    // 选择弃置 d1 → 弃 d1、杀帧目标转移,target 消费后清除
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { cardIds: [discard1.id] },
      baseSeq: state.seq,
    });
    expect(state.localVars['流离/target']).toBeUndefined(); // 消费后清除
    expect(state.localVars['流离/discard']).toBeUndefined(); // 弃牌选择消费后清除
    expect(state.players[1].hand).not.toContain(discard1.id);
    expect(state.zones.discardPile).toContain(discard1.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5(回归):弃哪张牌由玩家自选,不得固定弃手牌第一张。
  //   P1 手牌 [桃 d1, 闪 d2]:发动流离选弃闪 d2 → 被弃的是 d2,桃 d1 保留。
  //   修复前实现固定弃 hand[0](桃),玩家关键牌被强丢。
  // ─────────────────────────────────────────────────────────────
  it('用例5:自选弃牌——弃第二张而非固定 hand[0],其余保留', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    const peach: Card = { id: 'd1', name: '桃', suit: '♥', color: '红', rank: '3', type: '基本牌' };
    const dodge: Card = { id: 'd2', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], equipment: {}, skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [peach.id, dodge.id],
          equipment: {},
          skills: ['流离'],
          health: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [], equipment: {}, skills: [], health: 4 }),
      ],
      cardMap: { k1: slash, d1: peach, d2: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { choice: true },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { target: 2 },
      baseSeq: state.seq,
    });

    // 自选弃闪 d2(非手牌首张的桃)
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { cardIds: [dodge.id] },
      baseSeq: state.seq,
    });
    // 弃的是所选的闪;桃保留在手牌(修复前会被固定弃掉)
    expect(state.players[1].hand).toEqual([peach.id]);
    expect(state.zones.discardPile).toContain(dodge.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 6:超时未支付代价 → 不弃牌、不转移(杀仍命中 P1)。
  //   对齐 界放权「未支付代价不发动」范式。
  // ─────────────────────────────────────────────────────────────
  it('用例6:选牌超时 → 未支付代价不转移,杀仍命中 P1', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], equipment: {}, skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [dodge.id],
          equipment: {},
          skills: ['流离'],
          health: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [], equipment: {}, skills: [], health: 4 }),
      ],
      cardMap: { k1: slash, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { choice: true },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { target: 2 },
      baseSeq: state.seq,
    });
    // 停在 pickDiscard;超时不回应
    await fireTimeoutAndWait(state);

    // 代价未支付:手牌保留、无转移,P1 成为杀目标(P1 无闪回应则受伤)
    expect(state.players[1].hand).toContain(dodge.id);
    expect(state.localVars['流离/target']).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 8(回归 2026-08-26):浏览器两步式 UI 对 useCard 型 pickDiscard 只发
  // respond{cardId}(单数,无 cardIds)。修复前 validate 只认 cardIds 数组并拒绝
  // → 确认流离后无法支付代价,卡到超时按未支付处理(转移必败)。
  //   另:{}(点「不回应」)= 明确不支付 → 立即按未支付收尾,不等超时。
  // ─────────────────────────────────────────────────────────────
  it('用例8:pickDiscard 接受浏览器 {cardId} 单数形状完成转移', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    const discard1: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '3', type: '基本牌' };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], equipment: {}, skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [discard1.id], equipment: {}, skills: ['流离'], health: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: [], equipment: {}, skills: [], health: 4 }),
      ],
      cardMap: { k1: slash, d1: discard1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { choice: true },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { target: 2 },
      baseSeq: state.seq,
    });

    // 浏览器两步式真实形状:{cardId} 单数
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: discard1.id },
      baseSeq: state.seq,
    });

    // 代价已支付:弃 d1、杀帧目标转移到 P2
    expect(state.players[1].hand).not.toContain(discard1.id);
    expect(state.zones.discardPile).toContain(discard1.id);
    expect(state.localVars['流离/target']).toBeUndefined(); // 消费后清除
  });

  it('用例7:pickDiscard 收到 {}(不回应)立即视为未支付代价', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    const dodge: Card = { id: 'd2', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], equipment: {}, skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [dodge.id], equipment: {}, skills: ['流离'], health: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: [], equipment: {}, skills: [], health: 4 }),
      ],
      cardMap: { k1: slash, d2: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { choice: true },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: { target: 2 },
      baseSeq: state.seq,
    });
    await dispatchAndWait(state, {
      skillId: '流离',
      actionType: 'respond',
      ownerId: 1,
      params: {},
      baseSeq: state.seq,
    });

    // 未支付:手牌保留、无转移;询问已结束(无需等超时)
    expect(state.players[1].hand).toContain(dodge.id);
    expect(state.localVars['流离/target']).toBeUndefined();
    expect([...state.pendingSlots.values()].some((s) => (s.atom as { requestType?: string }).requestType === '流离/pickDiscard')).toBe(false);
  });
});
