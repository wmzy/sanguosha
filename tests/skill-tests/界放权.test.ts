// 界放权(界刘禅·主动技)行为测试:
//   1. 发动放权 → 跳过出牌阶段 → 弃牌阶段出现弃牌询问(放权代价)
//   2. 不发动放权 → 出牌阶段正常进行
//   3. 弃牌阶段开始时弃牌+选目标(对齐官方时机,非回合结束)
//   4. 3 人局:放权选 P2 → P2 额外回合 → 恢复正常座次(P1 → P2)
//   5. 自选额外回合(界限突破):刘禅令自己进行额外回合,不死循环,恢复正常下家
//
// 与标版放权区别:
//   - 触发时机:标版「回合结束时」弃牌+选目标;界版「弃牌阶段开始时」弃牌+选目标
//   - 自选:标版仅限其他角色;界版可令自己进行额外回合
//
// 注意:跳过出牌后,回合管理的阶段推进 after-hook 会立即链式触发 阶段开始(弃牌),
//   故 respond(choice:true) 返回时 ACTIVE 标记已被 弃牌 hook 消费(不再持久)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? opts.maxHealth ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['回合管理'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界放权', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('发动放权 → 跳过出牌阶段 → 弃牌阶段出现弃牌询问', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    const c2 = mkCard('c2', '闪', '♥', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界刘禅',
            character: '界刘禅',
            hand: ['c1', 'c2'],
            skills: ['回合管理', '界放权'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1' }),
        ],
        cardMap: { c1, c2 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LC = harness.player('界刘禅');

    // 触发出牌阶段开始(界放权 before-hook 询问)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    LC.expectPending('请求回应');

    // 选择发动放权
    await LC.respond('界放权', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 出牌阶段被跳过:链式触发 阶段开始(弃牌) before-hook,出现放权代价弃牌询问
    // (此时 phase 尚为出牌——before-hook 在 阶段开始(弃牌).apply 之前运行)
    LC.expectPending('请求回应');
    expect(harness.state.currentPlayerIndex).toBe(0); // 仍是刘禅回合(未结束回合)
  });

  it('不发动放权 → 出牌阶段正常进行', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界刘禅',
            character: '界刘禅',
            hand: ['c1'],
            skills: ['回合管理', '界放权'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1' }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LC = harness.player('界刘禅');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    LC.expectPending('请求回应');

    // 选择不发动
    await LC.respond('界放权', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 未设放权标记
    expect(harness.state.localVars['放权/active']).toBeFalsy();
    // 出牌阶段正常进行(phase 仍为出牌)
    expect(harness.state.phase).toBe('出牌');
    // 手牌未变
    expect(harness.state.players[0].hand).toEqual(['c1']);
  });

  it('弃牌阶段开始时弃牌+选目标(对齐官方时机,非回合结束)', async () => {
    // 关键验证:弃牌+选目标发生在「弃牌阶段」,而非「回合结束」
    const c1 = mkCard('c1', '杀', '♠', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界刘禅',
            character: '界刘禅',
            hand: ['c1'],
            skills: ['回合管理', '界放权'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1' }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LC = harness.player('界刘禅');

    // 1. 发动放权(跳过出牌)→ 链式触发 弃牌阶段开始
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    await LC.respond('界放权', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 2. 弃牌阶段开始 → 放权 before-hook 请求弃一张手牌(before-hook 运行在 apply 前,phase 尚为出牌)
    //    关键:弃牌询问在「结束回合」之前出现(证明时机是弃牌阶段开始,非回合结束)
    LC.expectPending('请求回应');
    expect(harness.state.currentPlayerIndex).toBe(0); // 仍是刘禅回合
    await LC.respond('界放权', { cardId: 'c1' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 3. 弃牌阶段开始 → 请求选额外回合目标(仍在刘禅回合,未结束)
    LC.expectPending('请求回应');
    expect(harness.state.currentPlayerIndex).toBe(0);
    await LC.respond('界放权', { target: 1 }); // 选 P1
    await harness.waitForStable();
    harness.processAllEvents();

    // c1 已在弃牌阶段被弃置(放权代价)
    expect(harness.state.zones.discardPile).toContain('c1');
    // extraTarget 已记录(回合结束时消费)——弃牌+选目标在回合结束前完成,证明时机是弃牌阶段开始
    expect(harness.state.localVars['放权/extraTarget']).toBe(1);
    // 弃牌 before-hook 已完成 → 阶段开始(弃牌).apply 已运行 → phase=弃牌(尚未到回合结束)
    expect(harness.state.phase).toBe('弃牌');
    expect(harness.state.currentPlayerIndex).toBe(0); // 刘禅尚未结束回合
  });

  it('3人局:放权选 P2 → P2 额外回合 → 恢复正常座次(P1 → P2)', async () => {
    // 座次 0=界刘禅(放权), 1=P1, 2=P2
    const c1 = mkCard('c1', '杀', '♠', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界刘禅',
            character: '界刘禅',
            hand: ['c1'],
            skills: ['回合管理', '界放权'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1' }),
          mkPlayer({ index: 2, name: 'P2' }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    // 预设 P2 的限一次标记:验证额外回合的 per-turn 清理(额外回合应是全新回合)
    harness.state.players[2].vars['测试/usedThisTurn'] = true;
    harness.rebuildViews();
    const LC = harness.player('界刘禅');

    // 1. 界刘禅发动放权(跳过出牌)→ 链式触发 弃牌阶段开始
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    await LC.respond('界放权', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 2. 弃牌阶段开始 → 弃牌 + 选目标(对齐官方时机)
    LC.expectPending('请求回应');
    await LC.respond('界放权', { cardId: 'c1' }); // 放权弃一张手牌
    await harness.waitForStable();
    harness.processAllEvents();
    LC.expectPending('请求回应');
    await LC.respond('界放权', { target: 2 }); // 选 P2 进行额外回合
    await harness.waitForStable();
    harness.processAllEvents();

    // c1 被弃置
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.localVars['放权/extraTarget']).toBe(2);

    // 3. 界刘禅结束回合 → 回合结束 → 情况1:启动 P2 额外回合
    await LC.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.currentPlayerIndex).toBe(2);
    expect(harness.state.phase).toBe('出牌');
    // P2 的预设限一次标记已被情况1 的 per-turn 清理清空(额外回合是全新回合)
    expect(harness.state.players[2].vars['测试/usedThisTurn']).toBeFalsy();

    // 4. P2 结束额外回合 → 情况2 → 启动 P1(界刘禅的正常下家)
    const P2 = harness.player('P2');
    await P2.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.currentPlayerIndex).toBe(1); // 正常下家 P1
    // 情况2 已清除放权内部标记
    expect(harness.state.localVars['放权/extraTarget']).toBeFalsy();
    expect(harness.state.localVars['放权/originalNext']).toBeFalsy();
    expect(harness.state.localVars['放权/extraActive']).toBeFalsy();

    // 5. P1 结束回合 → 座次恢复正常:轮到 P2(而非界刘禅)
    const P1 = harness.player('P1');
    await P1.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.currentPlayerIndex).toBe(2); // P2 正常回合,座次顺序已恢复
  });

  it('自选额外回合(界限突破):刘禅令自己进行额外回合,不死循环,恢复正常下家', async () => {
    // 座次 0=界刘禅(放权,自选), 1=P1
    const c1 = mkCard('c1', '杀', '♠', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界刘禅',
            character: '界刘禅',
            hand: ['c1'],
            skills: ['回合管理', '界放权'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1' }),
        ],
        cardMap: { c1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LC = harness.player('界刘禅');

    // 1. 发动放权(跳过出牌)→ 链式触发 弃牌阶段开始
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    await LC.respond('界放权', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 2. 弃牌阶段开始 → 弃牌 + 选自己(0)进行额外回合
    LC.expectPending('请求回应');
    await LC.respond('界放权', { cardId: 'c1' });
    await harness.waitForStable();
    harness.processAllEvents();
    LC.expectPending('请求回应');
    await LC.respond('界放权', { target: 0 }); // 自选(界限突破)
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.localVars['放权/extraTarget']).toBe(0);

    // 3. 界刘禅结束主回合 → 情况1:启动自己的额外回合
    await LC.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.currentPlayerIndex).toBe(0); // 仍是自己(额外回合)
    expect(harness.state.localVars['放权/extraActive']).toBe(true);

    // 4. 额外回合的出牌阶段:放权再次询问(每回合可用)→ 选择不发动
    LC.expectPending('请求回应');
    await LC.respond('界放权', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 5. 界刘禅结束额外回合 → 情况2(player===ownerId 但 extraActive → 走 Case 2)→ 启动 P1
    await LC.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.currentPlayerIndex).toBe(1); // 正常下家 P1
    // 放权内部标记已全部清除
    expect(harness.state.localVars['放权/extraTarget']).toBeFalsy();
    expect(harness.state.localVars['放权/extraActive']).toBeFalsy();
    expect(harness.state.localVars['放权/originalNext']).toBeFalsy();
  });
});
