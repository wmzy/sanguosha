// 界姜维 志继 行为测试(界限突破版):
//   核心差异:志继触发时机从「回合开始」改为「准备阶段 **或结束阶段**」。
//   1. 无手牌准备阶段 → 选摸两张牌:摸2牌 + 减1上限 + 获得观星
//   2. 无手牌准备阶段 → 选回复1点体力:回复1 + 减1上限 + 获得观星
//   3. 回合开始时不触发(原版会触发,界版不触发 — 关键差异验证)
//   4. 有手牌时准备阶段不触发
//   5. 觉醒后再次准备阶段不再触发(整局一次)
//   6. 无手牌结束阶段(回合结束阶段) → 选摸两张牌:触发觉醒(界版新增时机)
//   7. 准备阶段未触发(有手牌),结束阶段手牌打空 → 补触发觉醒(界版两段保险)
//   8. 结束阶段觉醒后,后续回合准备/结束阶段均不再触发(整局一次)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  return { id, name, suit, color, rank, type };
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
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界姜维·志继', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('准备阶段触发:选摸两张牌 → 摸2牌 + 减1上限 + 获得观星', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界姜维',
            character: '界姜维',
            hand: [],
            skills: ['界志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const JW = harness.player('界姜维');

    // 触发准备阶段(志继 after-hook 询问二选一)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    JW.expectPending('请求回应');

    // 选择摸两张牌(choice=true → draw)
    await JW.respond('界志继', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(2); // 摸了2张
    expect(harness.state.players[0].maxHealth).toBe(3); // 减1上限(4→3)
    expect(harness.state.players[0].health).toBe(2); // 体力不变
    expect(harness.state.players[0].skills).toContain('观星'); // 永久获得观星
    expect(harness.state.players[0].vars['志继/awakened']).toBe(true); // 觉醒标记
  });

  it('准备阶段触发:选回复1点体力 → 回复1 + 减1上限 + 获得观星', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界姜维',
            character: '界姜维',
            hand: [],
            skills: ['界志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const JW = harness.player('界姜维');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    JW.expectPending('请求回应');

    // 选择回复1点体力(choice=false → heal)
    await JW.respond('界志继', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3); // 2→3 回复1点
    expect(harness.state.players[0].hand.length).toBe(0); // 不摸牌
    expect(harness.state.players[0].maxHealth).toBe(3); // 减1上限(4→3)
    expect(harness.state.players[0].skills).toContain('观星');
    expect(harness.state.players[0].vars['志继/awakened']).toBe(true);
  });

  it('回合开始时不触发(界版差异:仅准备阶段触发)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界姜维',
            character: '界姜维',
            hand: [],
            skills: ['界志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 回合开始:界版志继不在此触发(原版会)
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0); // 无询问
    expect(harness.state.players[0].vars['志继/awakened']).toBeFalsy(); // 未觉醒
    expect(harness.state.players[0].maxHealth).toBe(4); // 上限不变
    expect(harness.state.players[0].skills).not.toContain('观星');
  });

  it('有手牌时准备阶段不触发志继', async () => {
    const c = mkCard('h1', '闪', '♥', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界姜维',
            character: '界姜维',
            hand: ['h1'],
            skills: ['界志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: { h1: c },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 准备阶段:有手牌,志继不触发
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].vars['志继/awakened']).toBeFalsy();
    expect(harness.state.players[0].maxHealth).toBe(4);
    expect(harness.state.players[0].skills).not.toContain('观星');
  });

  it('觉醒后再次准备阶段不再触发(整局一次)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界姜维',
            character: '界姜维',
            hand: [],
            skills: ['界志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const JW = harness.player('界姜维');

    // 第一次准备阶段:触发觉醒,选摸牌
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    await JW.respond('界志继', { choice: true });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['志继/awakened']).toBe(true);
    const maxAfterAwaken = harness.state.players[0].maxHealth; // 3

    // 清空手牌模拟下一回合准备阶段前的状态(用弃置 atom 保持视图一致)
    const handCards = [...harness.state.players[0].hand];
    if (handCards.length > 0) {
      await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: handCards });
    }

    // 第二次准备阶段:已觉醒,志继不再触发
    // (觉醒后获得观星,准备阶段也会触发观星 — 需处理其 pending)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    // 观星可能触发(觉醒后获得),回应不发动
    if (harness.state.pendingSlots.size > 0) {
      await JW.respond('观星', { choice: false });
      await harness.waitForStable();
    }

    // 志继不再触发:上限不再减、不摸牌
    expect(harness.state.players[0].maxHealth).toBe(maxAfterAwaken); // 上限不再减
    expect(harness.state.players[0].hand.length).toBe(0); // 没有再摸牌
  });

  // ── 界版新增时机:结束阶段(回合结束阶段)触发 ──

  it('无手牌结束阶段触发:选摸两张牌 → 摸2牌 + 减1上限 + 获得观星', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界姜维',
            character: '界姜维',
            hand: [],
            skills: ['界志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} },
      }),
    );
    const JW = harness.player('界姜维');

    // 触发结束阶段(志继 after-hook 询问二选一)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    JW.expectPending('请求回应');

    // 选择摸两张牌
    await JW.respond('界志继', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(2); // 摸了2张
    expect(harness.state.players[0].maxHealth).toBe(3); // 减1上限(4→3)
    expect(harness.state.players[0].health).toBe(2); // 体力不变
    expect(harness.state.players[0].skills).toContain('观星'); // 永久获得观星
    expect(harness.state.players[0].vars['志继/awakened']).toBe(true); // 觉醒标记
  });

  it('准备阶段有手牌不触发,结束阶段手牌打空 → 补触发觉醒', async () => {
    const c = mkCard('h1', '闪', '♥', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界姜维',
            character: '界姜维',
            hand: ['h1'],
            skills: ['界志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: { h1: c },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const JW = harness.player('界姜维');

    // 准备阶段:有手牌,志继不触发
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['志继/awakened']).toBeFalsy();

    // 模拟出牌阶段把这张手牌打出去了
    await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['h1'] });
    await harness.waitForStable();
    expect(harness.state.players[0].hand.length).toBe(0);

    // 结束阶段:无手牌,志继触发觉醒
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    JW.expectPending('请求回应');
    await JW.respond('界志继', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].vars['志继/awakened']).toBe(true);
    expect(harness.state.players[0].maxHealth).toBe(3); // 减1上限
    expect(harness.state.players[0].skills).toContain('观星');
  });

  it('结束阶段觉醒后,后续回合结束阶段不再触发(整局一次)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界姜维',
            character: '界姜维',
            hand: [],
            skills: ['界志继'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} },
      }),
    );
    const JW = harness.player('界姜维');

    // 第一次结束阶段:触发觉醒
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    await JW.respond('界志继', { choice: true });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['志继/awakened']).toBe(true);
    const maxAfterAwaken = harness.state.players[0].maxHealth; // 3

    // 清空觉醒新摸的手牌
    const handCards = [...harness.state.players[0].hand];
    if (handCards.length > 0) {
      await applyAtom(harness.state, { type: '弃置', player: 0, cardIds: handCards });
    }

    // 第二次结束阶段:已觉醒,志继不再触发(但观星可能被询问)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    if (harness.state.pendingSlots.size > 0) {
      await JW.respond('观星', { choice: false });
      await harness.waitForStable();
    }

    expect(harness.state.players[0].maxHealth).toBe(maxAfterAwaken); // 上限不再减
    expect(harness.state.players[0].hand.length).toBe(0); // 没有再摸牌
  });
});
