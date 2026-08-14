// 规则包(rules/)解耦 + 游戏模式(身份局/1v1)集成测试。
// 归并建议:后续模式(国战等)的模式级开局/胜负测试继续追加到本文件。
// 覆盖点(ADR 0029):
//   1. registry:loadRuleset 动态加载身份局/1v1,未知模式抛错
//   2. core.checkGameOver:异步经规则包判定,state.config.mode 路由正确
//   3. 开局流程:1v1 无主公特权——开局直接全员并行选将(无单独主公 slot),
//      每人 5 候选;身份局仍为主公串行先行(回归保护)
//   4. restore 路径:mode 经 state.config 持久化,1v1 快照恢复后 checkGameOver 仍按 1v1 判定
import { describe, it, expect, beforeEach } from 'vitest';
import { waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import { bootstrap, dispatch, checkGameOver, create as createEngine } from '../../src/engine/index';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';
import { loadRuleset } from '../../src/engine/rules/registry';
import { hasBlockingPending } from '../../src/engine/core/skill';

const CHARACTERS: Array<{ name: string; skills: string[] }> = [
  { name: '刘备', skills: ['仁德'] },
  { name: '曹操', skills: ['奸雄'] },
  { name: '孙权', skills: ['制衡'] },
  { name: '关羽', skills: ['武圣'] },
  { name: '张飞', skills: ['咆哮'] },
  { name: '赵云', skills: ['龙胆'] },
  { name: '郭嘉', skills: ['遗计'] },
  { name: '司马懿', skills: ['反馈'] },
  { name: '吕布', skills: ['无双'] },
  { name: '华佗', skills: ['青囊'] },
];

function makePlayer(index: number, name: string) {
  return {
    index,
    name,
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

function seedDeck(state: GameState, n = 20) {
  for (let i = 0; i < n; i++) {
    const id = `deck_${i}`;
    state.cardMap[id] = { id, name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
    state.zones.deck.push(id);
  }
}

async function respondCharSelect(state: GameState, target: number, character: string) {
  void dispatch(state, {
    skillId: '系统规则',
    actionType: '选将',
    ownerId: target,
    params: { character },
    baseSeq: 0,
  });
  await waitForStable(state);
}

async function waitForSlot(state: GameState, want: number) {
  for (let i = 0; i < 100 && state.pendingSlots.size < want; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await waitForStable(state);
}

describe('规则包 registry', () => {
  it('loadRuleset 动态加载身份局/1v1,模块契约完整', async () => {
    const identity = await loadRuleset('身份局');
    expect(identity.mode).toBe('身份局');
    expect(identity.opening.lordPickEnabled).toBe(true);
    expect(identity.opening.candidatesPerIdentity['主公']).toBe(7);

    const duel = await loadRuleset('1v1');
    expect(duel.mode).toBe('1v1');
    expect(duel.opening.lordPickEnabled).toBe(false);
    // ES 模块缓存:重复加载同一实例
    expect(await loadRuleset('身份局')).toBe(identity);
  });

  it('未知模式抛错', () => {
    expect(() => loadRuleset('国战' as never)).toThrow('不支持的游戏模式');
  });
});

describe('checkGameOver:经规则包路由', () => {
  function duelState(lordAlive: boolean): GameState {
    return createGameState({
      players: [
        { ...makePlayer(0, 'P1'), identity: '主公', alive: lordAlive },
        { ...makePlayer(1, 'P2'), identity: '反贼', alive: !lordAlive },
      ],
      cardMap: {},
    });
  }

  it('无 config.mode 缺省身份局(兼容旧快照)', async () => {
    const state = duelState(false);
    expect(state.config?.mode).toBeUndefined();
    const { gameOver, winner } = await checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBe(1); // 反贼胜
  });

  it("config.mode='1v1' 路由到同一判定(主公死=反贼胜)", async () => {
    const state = createEngine({ characters: CHARACTERS, playerCount: 2, seed: 1, gameId: 'g', mode: '1v1' });
    state.players[0].identity = '主公';
    state.players[1].identity = '反贼';
    state.players[0].alive = false;
    const { gameOver, winner } = await checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBe(1);
  });

  it('create 持久化 mode 到 state.config(restore 快照可用)', () => {
    const state = createEngine({ characters: CHARACTERS, playerCount: 2, seed: 1, gameId: 'g', mode: '1v1', timeoutSec: 30 });
    expect(state.config).toEqual({ timeoutSec: 30, mode: '1v1' });
  });
});

describe('开局流程:1v1 无主公特权', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState({
      players: [makePlayer(0, 'P1'), makePlayer(1, 'P2')],
      cardMap: {},
    });
    seedDeck(state);
  });

  it('开局直接全员并行选将(无单独主公 slot),每人 5 候选', async () => {
    void bootstrap(state, {
      characters: CHARACTERS,
      playerCount: 2,
      seed: 42,
      gameId: 'test',
      mode: '1v1',
    });
    await waitForSlot(state, 2);

    // 两人同时出现选将 slot(lordPickEnabled=false,无串行主公先行)
    expect(state.pendingSlots.size).toBe(2);
    for (const slot of state.pendingSlots.values()) {
      expect(slot.atom.type).toBe('选将询问');
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates;
      expect(cand.length).toBe(5); // 1v1 等额 5 候选
    }

    // 各自选不同的武将;随后 bootstrap 后续流程(技能注册/洗牌/发牌/回合开始)
    // 需多次微任务推进,轮询直到发牌完成(handSize=4 落到每人手牌)。
    const targets = [...state.pendingSlots.keys()];
    const taken = new Set<string>();
    for (const t of targets) {
      const slot = state.pendingSlots.get(t)!;
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates;
      const choice = cand.find((c) => !taken.has(c.name))!;
      taken.add(choice.name);
      await respondCharSelect(state, t, choice.name);
    }
    const bootDeadline = Date.now() + 8000;
    while (Date.now() < bootDeadline) {
      await waitForStable(state);
      if (!hasBlockingPending(state) && state.players.every((p) => p.hand.length >= 4)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await waitForStable(state);
    // 发牌完成:两人各 4 张起手(首回合摸牌阶段再 +2,故断言 >=4)
    for (const p of state.players) {
      expect(p.hand.length).toBeGreaterThanOrEqual(4);
      expect(p.character).not.toBe('');
    }
    // 2 人局主公不 +1 体力上限(分配武将的 +1 仅 5 人以上)
    const lord = state.players.find((p) => p.identity === '主公');
    expect(lord?.maxHealth).toBe(lord?.health);
  }, 15000);
});

describe('开局流程:身份局回归保护', () => {
  it('主公仍先单独选(lordPickEnabled=true 路径未受影响)', async () => {
    const state = createGameState({
      players: [makePlayer(0, 'P1'), makePlayer(1, 'P2'), makePlayer(2, 'P3')],
      cardMap: {},
    });
    seedDeck(state);
    void bootstrap(state, {
      characters: CHARACTERS,
      playerCount: 3,
      seed: 42,
      gameId: 'test',
      // 不传 mode:缺省身份局
    });
    await waitForSlot(state, 1);
    expect(state.pendingSlots.size).toBe(1);
    const slot = [...state.pendingSlots.values()][0];
    expect(slot.atom.type).toBe('选将询问');
  }, 15000);
});
