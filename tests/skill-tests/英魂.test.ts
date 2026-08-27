// 英魂(孙坚·主动技)测试(标版BUG修复后,OL hero/458):
//   准备阶段,若已受伤,孙坚选一名其他角色,孙坚自己选方案(摸X弃1/摸1弃X),
//   目标摸牌后自选弃牌(X=孙坚已损失体力值)。
//
// 通过直接 dispatch 阶段开始(准备) 触发英魂 before-hook
//   (准备阶段是回合一首个阶段,无法由更早阶段推进进入,故直接派发)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/core/apply';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
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
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  faction?: '吴' | '魏' | '蜀' | '群';
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '孙坚',
    health: opts.health ?? 4,
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
    faction: opts.faction ?? '吴',
    identity: '主公',
  };
}

/** 触发孙坚(player 0)的准备阶段,启动英魂 before-hook */
function triggerReadyPhase(harness: SkillTestHarness): void {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
}

describe('英魂', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 选项1:摸X弃1(孙坚选方案) ─────────────────────────────
  it('发动英魂 → 孙坚选选项1(摸X弃1):P1 摸2弃1,净+1', async () => {
    // 孙坚 4血剩2血 → X=2
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 2,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1a', 'p1b'],
          skills: ['回合管理'],
          faction: '魏',
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        d1: makeCard('d1', '桃', '♥'),
        d2: makeCard('d2', '酒', '♣'),
        d3: makeCard('d3', '杀', '♠'),
        d4: makeCard('d4', '闪', '♦'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');
    const P1 = harness.player('P1');

    triggerReadyPhase(harness);
    await waitForStable(harness.state); // confirm 询问
    孙坚.expectPending('请求回应');
    await 孙坚.respond('英魂', { choice: true }); // 发动

    await waitForStable(harness.state); // choosePlayer 询问
    await 孙坚.respond('英魂', { targets: [1] }); // 选 P1

    await waitForStable(harness.state); // 孙坚 option 询问(标版BUG修复:决策方=孙坚)
    孙坚.expectPending('请求回应');
    await 孙坚.respond('英魂', { choice: true }); // 孙坚选选项1(摸2弃1)

    await waitForStable(harness.state); // 目标选弃牌
    await P1.respond('英魂', { cardIds: ['p1a'] }); // 弃 p1a
    await harness.waitForStable();

    // P1 原2张 +摸2 -弃1 = 3张
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.players[1].hand).not.toContain('p1a');
    // 摸牌消耗牌堆2张
    expect(harness.state.zones.deck.length).toBe(2);
    // 弃牌堆含 p1a
    expect(harness.state.zones.discardPile).toContain('p1a');
  });

  // ─── 选项2:摸1弃X(孙坚选方案) ─────────────────────────────
  it('发动英魂 → 孙坚选选项2(摸1弃X):P1 摸1弃2,净-1', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 2,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1a', 'p1b'],
          skills: ['回合管理'],
          faction: '魏',
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        d1: makeCard('d1', '桃', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');
    const P1 = harness.player('P1');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { choice: true });
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { targets: [1] });
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { choice: false }); // 孙坚选选项2(摸1弃2)
    await waitForStable(harness.state);
    // P1 手牌:p1a,p1b + 摸1(d1) = 3张,需弃2
    await P1.respond('英魂', { cardIds: ['p1a', 'p1b'] });
    await harness.waitForStable();

    // P1 原2张 +摸1 -弃2 = 1张
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.zones.deck.length).toBe(0);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['p1a', 'p1b']));
  });

  // ─── 满血不触发 ──────────────────────────────────────────────
  it('孙坚满血(未受伤)→ 英魂不发动,无询问', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 4,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1a'], skills: ['回合管理'], faction: '魏' }),
      ],
      cardMap: { p1a: makeCard('p1a', '杀') },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    triggerReadyPhase(harness);
    await harness.waitForStable();

    // 无任何 pending(英魂未触发)
    expect(harness.state.pendingSlots.size).toBe(0);
    // 手牌不变
    expect(harness.state.players[1].hand.length).toBe(1);
  });

  // ─── 孙坚选择不发动 ──────────────────────────────────────────
  it('孙坚已受伤但选择不发动 → 无效果', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 2,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1a'], skills: ['回合管理'], faction: '魏' }),
      ],
      cardMap: { p1a: makeCard('p1a', '杀'), d1: makeCard('d1', '桃', '♥') },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    孙坚.expectPending('请求回应');
    await 孙坚.respond('英魂', { choice: false }); // 不发动
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].hand).toEqual(['p1a']);
    expect(harness.state.zones.deck.length).toBe(1); // 未摸牌
  });

  // ─── 孙坚选方案超时默认选项1 ───────────────────────────────
  it('孙坚超时不选 → 默认选项1(摸X弃1)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 2,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1a', 'p1b', 'p1c'],
          skills: ['回合管理'],
          faction: '魏',
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        p1c: makeCard('p1c', '桃', '♥'),
        d1: makeCard('d1', '酒', '♣'),
        d2: makeCard('d2', '桃', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    // X = 4-2 = 2:选项1 摸2弃1(净+1)≠ 选项2 摸1弃2(净-1),
    // 超时默认选项1 才可被区分验证(原 health=3 即 X=1 时两选项相同,断言无法证伪)。
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');
    const P1 = harness.player('P1');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { choice: true });
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { targets: [1] });
    await waitForStable(harness.state); // 孙坚 option 询问

    // 孙坚超时(pass)→ 默认选项1(摸X弃1)
    await 孙坚.pass();
    await waitForStable(harness.state); // 弃牌询问(选项1 弃1)
    P1.expectPending('请求回应');
    await P1.respond('英魂', { cardIds: ['p1a'] });
    await harness.waitForStable();

    // P1 原3张 +摸2(d1,d2) -弃1(p1a) = 4张(若默认选项2 则为 2 张 → 据此验证默认选项1)
    expect(harness.state.players[1].hand.length).toBe(4);
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.players[1].hand).toContain('d2');
    expect(harness.state.zones.deck.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('p1a');
  });

  // ─── 弃牌询问 mandatory:目标超时仍自动弃牌(不放弃弃牌义务) ──
  // bug:原实现弃牌询问为普通 useCard respond,目标可"不回应"跳过或超时静默放弃弃牌,
  // 且前端只支持单牌点击(发 cardId),无法选弃多张。修复:弃牌询问标 mandatory=true,
  // 前端走多牌选择 UI + 无"不回应"按钮;超时由技能自身 auto-discard 补齐。
  it('目标弃牌超时 → 自动从手牌补弃(mandatory,不跳过)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 2,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({
          index: 1, name: 'P1', hand: ['p1a', 'p1b'], skills: ['回合管理'], faction: '魏' }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        d1: makeCard('d1', '桃', '♥'),
        d2: makeCard('d2', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    // X = 4-2 = 2:选项2 摸1弃2
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');
    const P1 = harness.player('P1');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { choice: true });
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { targets: [1] });
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { choice: false }); // 选项2:摸1弃2
    await waitForStable(harness.state); // 弃牌询问(弃2)
    P1.expectPending('请求回应');

    // 目标超时(pass)不弃 → 技能 auto-discard 补齐(不放弃弃牌义务)
    await P1.pass();
    await harness.waitForStable();

    // P1 原2张 +摸1(d1) -自动弃2 = 1张,弃牌堆含2张
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.zones.discardPile.length).toBe(2);
  });

  // ─── 回归:魂姿觉醒当回合,英魂在同一个准备阶段立即发动 ────────
  // bug:魂姿(标/界)准备阶段觉醒获得英魂后,英魂 before-hook 已错过本准备阶段的
  //   快照收集时机(before-hook 在 applyAtom 入口即快照,此时英魂尚未添加),本回合不发动,
  //   要等下回合。修复:魂姿觉醒 after-hook 在 applyAtom(添加技能,'英魂') 之后显式调用
  //   英魂.performYinghunPrepare,让英魂在觉醒当回合的准备阶段立即发动。
  //   关键断言:仅一次 阶段开始(准备) dispatch 后,英魂 confirm 询问即出现(同阶段生效)。
  it('标孙策准备阶段觉醒 → 英魂在同一个准备阶段立即发动(询问+效果)', async () => {
    // 孙策 4血剩1血 → 魂姿觉醒(减1上限 4→3)+获得英魂;此时仍 health=1 < 新上限3 → 英魂 X=2 发动
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙策',
          character: '孙策',
          health: 1,
          maxHealth: 4,
          hand: [],
          skills: ['魂姿'],
        }),
        makePlayer({
          index: 1, name: 'P1', hand: ['p1a', 'p1b'], faction: '魏' }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        d1: makeCard('d1', '桃', '♥'),
        d2: makeCard('d2', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙策 = harness.player('孙策');
    const P1 = harness.player('P1');

    // 一次阶段开始(准备):魂姿觉醒 + 英魂同阶段立即发动
    triggerReadyPhase(harness);
    await waitForStable(harness.state); // 英魂 confirm(觉醒当回合立即发动,非下回合)
    孙策.expectPending('请求回应');
    await 孙策.respond('英魂', { choice: true }); // 发动

    await waitForStable(harness.state); // 选目标
    await 孙策.respond('英魂', { targets: [1] });

    await waitForStable(harness.state); // 选方案
    await 孙策.respond('英魂', { choice: true }); // 选项1:摸2弃1

    await waitForStable(harness.state); // 目标选弃牌
    await P1.respond('英魂', { cardIds: ['p1a'] });
    await harness.waitForStable();

    // 觉醒:上限 4→3,获得英魂/英姿
    expect(harness.state.players[0].maxHealth).toBe(3);
    expect(harness.state.players[0].skills).toContain('英魂');
    expect(harness.state.players[0].vars['魂姿/awakened']).toBe(true);
    // 英魂效果(同阶段生效):P1 原2张 +摸2(d1,d2) -弃1(p1a) = 3张
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.players[1].hand).not.toContain('p1a');
    expect(harness.state.zones.deck.length).toBe(0); // 摸2消耗2张
    expect(harness.state.zones.discardPile).toContain('p1a');
  });

  it('界孙策准备阶段觉醒 → 英魂在同一个准备阶段立即发动(询问+效果)', async () => {
    // 界孙策 4血剩1血 → 界魂姿觉醒(减1上限 4→3)+获得英魂;此时仍 health=1 < 新上限3 → 英魂 X=2 发动
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孙策',
          character: '界孙策',
          health: 1,
          maxHealth: 4,
          hand: [],
          skills: ['界魂姿'],
        }),
        makePlayer({
          index: 1, name: 'P1', hand: ['p1a', 'p1b'], faction: '魏' }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        d1: makeCard('d1', '桃', '♥'),
        d2: makeCard('d2', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 界孙策 = harness.player('界孙策');
    const P1 = harness.player('P1');

    // 一次阶段开始(准备):界魂姿觉醒 + 英魂同阶段立即发动
    triggerReadyPhase(harness);
    await waitForStable(harness.state); // 英魂 confirm(觉醒当回合立即发动,非下回合)
    界孙策.expectPending('请求回应');
    await 界孙策.respond('英魂', { choice: true }); // 发动

    await waitForStable(harness.state); // 选目标
    await 界孙策.respond('英魂', { targets: [1] });

    await waitForStable(harness.state); // 选方案
    await 界孙策.respond('英魂', { choice: true }); // 选项1:摸2弃1

    await waitForStable(harness.state); // 目标选弃牌
    await P1.respond('英魂', { cardIds: ['p1a'] });
    await harness.waitForStable();

    // 觉醒:上限 4→3,获得英魂/英姿
    expect(harness.state.players[0].maxHealth).toBe(3);
    expect(harness.state.players[0].skills).toContain('英魂');
    expect(harness.state.players[0].vars['魂姿/awakened']).toBe(true);
    // 英魂效果(同阶段生效):P1 原2张 +摸2(d1,d2) -弃1(p1a) = 3张
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.players[1].hand).not.toContain('p1a');
    expect(harness.state.zones.deck.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('p1a');
  });

  // ─── 回归(2026-08-27):弃牌校验缺去重 ──────────────────────
  // 旧校验只查「恰好 N 张 + 全在自己手牌」,ids=[a,a] 且 need=2 时通过 →
  // 弃置 atom 把同 id push 进弃牌堆两次(复制牌)。修复:追加 Set 去重,
  // 重复提交不写 DISCARD_KEY → 走 mandatory 兜底(手牌首张起补弃),无复制。
  it('目标弃牌回应重复 id → 拦截并兜底补弃,弃牌堆无复制', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 2,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1a', 'p1b'],
          skills: ['回合管理'],
          faction: '魏',
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        d1: makeCard('d1', '桃', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    // X = 4-2 = 2:选项2 摸1弃2 → P1 摸1后 3 张,need=2
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');
    const P1 = harness.player('P1');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { choice: true });
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { targets: [1] });
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { choice: false }); // 选项2:摸1弃2
    await waitForStable(harness.state); // 弃牌询问(弃2)
    P1.expectPending('请求回应');

    // 重复 id:[p1a, p1a] 数量=2 但重复 → 去重校验拦截,不写 DISCARD_KEY
    await P1.respond('英魂', { cardIds: ['p1a', 'p1a'] });
    await harness.waitForStable();

    // 兜底从手牌首张起补弃 2 张(p1a, p1b):P1 原2张 +摸1 -弃2 = 1 张(仅剩 d1)
    expect(harness.state.players[1].hand).toEqual(['d1']);
    // 弃牌堆无复制:p1a 恰出现一次(修复前:弃置 [p1a,p1a] 把 p1a push 两次)
    expect(harness.state.zones.discardPile.filter((id) => id === 'p1a').length).toBe(1);
    expect(harness.state.zones.discardPile).toContain('p1b');
  });
});
