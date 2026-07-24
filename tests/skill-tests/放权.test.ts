// 放权(刘禅·主动技)行为测试:
//   1. 发动放权 → 跳过出牌阶段(直接进入弃牌阶段,设 active 标记)
//   2. 不发动放权 → 出牌阶段正常进行
//   3. 3 人局:刘禅放权选 P2 → P2 进行额外回合 → 额外回合结束后恢复正常座次(P1 → P2)
//      并验证额外回合是全新回合(per-turn 标记被清空)
//   4. 2 人局:刘禅放权选对方 → 对方额外回合中使用限一次技(制衡)→ 标记清空 → 正常回合可再用
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
    health: opts.health ?? opts.maxHealth ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

describe('放权', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('发动放权 → 跳过出牌阶段,设 active 标记', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    const c2 = mkCard('c2', '闪', '♥', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '刘禅',
            character: '刘禅',
            hand: ['c1', 'c2'],
            skills: ['回合管理', '放权'],
            health: 1,
            maxHealth: 1,
          }),
          mkPlayer({ index: 1, name: 'P1' }),
        ],
        cardMap: { c1, c2 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LC = harness.player('刘禅');

    // 触发出牌阶段开始(放权 before-hook 询问)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    LC.expectPending('请求回应');

    // 选择发动放权
    await LC.respond('放权', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 出牌阶段被跳过:phase 推进到弃牌(阶段结束 已 apply)
    expect(harness.state.phase).toBe('弃牌');
    // active 标记已设(回合结束时消费)
    expect(harness.state.localVars['放权/active']).toBe(true);
    // 手牌未变(弃牌发生在回合结束)
    expect(harness.state.players[0].hand).toEqual(['c1', 'c2']);
  });

  it('不发动放权 → 出牌阶段正常进行(不设标记)', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '刘禅',
            character: '刘禅',
            hand: ['c1'],
            skills: ['回合管理', '放权'],
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
    const LC = harness.player('刘禅');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    LC.expectPending('请求回应');

    // 选择不发动
    await LC.respond('放权', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 未设放权标记
    expect(harness.state.localVars['放权/active']).toBeFalsy();
    // 出牌阶段正常进行(phase 仍为出牌)
    expect(harness.state.phase).toBe('出牌');
    // 手牌未变
    expect(harness.state.players[0].hand).toEqual(['c1']);
  });

  it('3人局:放权选 P2 → P2 额外回合 → 恢复正常座次(P1 → P2)', async () => {
    // 座次 0=刘禅(放权), 1=P1, 2=P2
    const c1 = mkCard('c1', '杀', '♠', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '刘禅',
            character: '刘禅',
            hand: ['c1'],
            skills: ['回合管理', '放权'],
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
    // 预设 P2 的限一次标记:验证 Case 1 的清理(额外回合应是全新回合)
    harness.state.players[2].vars['测试/usedThisTurn'] = true;
    harness.rebuildViews();
    const LC = harness.player('刘禅');

    // 1. 刘禅发动放权(跳过出牌)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    await LC.respond('放权', { choice: true });
    // 发动放权 → 跳过出牌 → 弃牌(无弃牌)→ 回合结束 → 放权情况1:弃牌代价 + 选目标
    // (回合收尾已集中到 回合管理 hook:跳过出牌后自动级联到 回合结束 atom,无需手动 end)
    await harness.waitForStable();
    harness.processAllEvents();
    // 情况1:弃一张手牌(放权代价)
    LC.expectPending('请求回应');
    await LC.respond('放权', { cardId: 'c1' }); // 放权弃一张手牌
    await harness.waitForStable();
    harness.processAllEvents();
    LC.expectPending('请求回应');
    await LC.respond('放权', { target: 2 }); // 选 P2 进行额外回合
    await harness.waitForStable();
    harness.processAllEvents();

    // c1 被弃置
    expect(harness.state.zones.discardPile).toContain('c1');

    // 3. P2 进行额外回合(currentPlayerIndex 经历 P2)
    expect(harness.state.currentPlayerIndex).toBe(2);
    expect(harness.state.phase).toBe('出牌');
    // P2 的预设限一次标记已被情况1 的 per-turn 清理清空(额外回合是全新回合)
    expect(harness.state.players[2].vars['测试/usedThisTurn']).toBeFalsy();
    // 放权内部标记已记录
    expect(harness.state.localVars['放权/extraTarget']).toBe(2);

    // 4. P2 结束额外回合 → 情况2 → 启动 P1(刘禅的正常下家)
    const P2 = harness.player('P2');
    await P2.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.currentPlayerIndex).toBe(1); // 正常下家 P1
    // 情况2 已清除放权内部标记
    expect(harness.state.localVars['放权/extraTarget']).toBeFalsy();
    expect(harness.state.localVars['放权/originalNext']).toBeFalsy();

    // 5. P1 结束回合 → 座次恢复正常:轮到 P2(而非刘禅)
    const P1 = harness.player('P1');
    await P1.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.currentPlayerIndex).toBe(2); // P2 正常回合,座次顺序已恢复
  });

  it('2人局:放权选对方 → 对方额外回合用制衡 → 标记清空 → 正常回合可再用', async () => {
    // 座次 0=刘禅(放权), 1=对方(孙权·制衡)
    const c1 = mkCard('c1', '杀', '♠', '5');
    const p1 = mkCard('p1', '闪', '♥', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '刘禅',
            character: '刘禅',
            hand: ['c1'],
            skills: ['回合管理', '放权'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({
            index: 1,
            name: '对方',
            character: '孙权',
            hand: ['p1'],
            skills: ['回合管理', '制衡'],
            health: 5,
            maxHealth: 5,
          }),
        ],
        cardMap: { c1, p1 },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const LC = harness.player('刘禅');

    // 刘禅发动放权(跳过出牌)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    await LC.respond('放权', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 刘禅结束回合 → 情况1:弃牌 + 选目标
    await LC.triggerAction('回合管理', 'end', {});
    LC.expectPending('请求回应');
    await LC.respond('放权', { cardId: 'c1' });
    await harness.waitForStable();
    harness.processAllEvents();
    LC.expectPending('请求回应');
    await LC.respond('放权', { target: 1 }); // 选对方(唯一可选)
    await harness.waitForStable();
    harness.processAllEvents();

    // 对方进行额外回合
    expect(harness.state.currentPlayerIndex).toBe(1);
    expect(harness.state.phase).toBe('出牌');

    // 对方在额外回合中使用制衡(限一次)
    const OP = harness.player('对方');
    // 额外回合摸了 2 张,加上初始 p1,共 3 张;用 p1 发动制衡
    await OP.triggerAction('制衡', 'use', { cardIds: ['p1'] });
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.players[1].vars['制衡/usedThisTurn']).toBe(true);

    // 对方结束额外回合 → 情况2 清空 per-turn 标记 → 启动对方的正常回合
    await OP.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();
    harness.processAllEvents();
    // 限一次标记已清空(额外回合结束 → 正常回合开始)
    expect(harness.state.players[1].vars['制衡/usedThisTurn']).toBeFalsy();
    // 恢复正常下家(对方=originalNext)→ 对方正常回合
    expect(harness.state.currentPlayerIndex).toBe(1);

    // 对方在正常回合中可再次使用制衡(标记已清)
    expect(harness.state.players[1].hand.length).toBeGreaterThan(0);
    const reuseCard = harness.state.players[1].hand[0];
    await OP.triggerAction('制衡', 'use', { cardIds: [reuseCard] });
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.players[1].vars['制衡/usedThisTurn']).toBe(true);
  });
});
