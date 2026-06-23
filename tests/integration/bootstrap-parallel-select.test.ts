// 开局并行选将端到端测试:走完整 bootstrap 流程,验证主公串行选 + 其余人并行选。
//
// 关键验证点:
//   1. bootstrap 后先出现主公的单独选将 pending(1 个 slot)
//   2. 主公选完后,其余 3 人同时出现选将 pending(3 个并行 slot)
//   3. 其余人各自独立选,全部选完后进入游戏(发牌 + 回合开始)
import { describe, it, expect, beforeEach } from 'vitest';
import { waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { bootstrap, dispatch, resetForTest } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';

// 复刻 session.ts 的默认武将列表(测试独立,避免 import server)
const CHARACTERS: Array<{ name: string; skills: string[] }> = [
  { name: '刘备', skills: ['仁德'] },
  { name: '曹操', skills: ['护甲'] },
  { name: '孙权', skills: ['制衡'] },
  { name: '关羽', skills: ['武圣'] },
  { name: '张飞', skills: ['咆哮'] },
  { name: '赵云', skills: ['龙胆'] },
  { name: '郭嘉', skills: ['遗计'] },
  { name: '司马懿', skills: ['反馈'] },
  { name: '荀彧', skills: ['驱虎'] },
  { name: '貂蝉', skills: ['离间'] },
  { name: '周瑜', skills: ['英姿'] },
  { name: '陆逊', skills: ['连营'] },
  { name: '吕布', skills: ['无双'] },
  { name: '华佗', skills: ['青囊'] },
  { name: '张角', skills: ['雷击'] },
  { name: '甄姬', skills: ['倾国'] },
  { name: '甘宁', skills: ['奇袭'] },
  { name: '黄月英', skills: ['集智'] },
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
    judgeZone: [],
  };
}

/** 发选将 respond */
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

describe('开局 bootstrap:主公串行 + 其他人并行选将', () => {
  let state: GameState;

  beforeEach(() => {
    resetForTest();
    state = createGameState({
      players: [
        makePlayer(0, 'P1'),
        makePlayer(1, 'P2'),
        makePlayer(2, 'P3'),
        makePlayer(3, 'P4'),
      ],
      cardMap: {},
    });
    // 自动填充牌堆(bootstrap 发牌需要)
    for (let i = 0; i < 40; i++) {
      const id = `deck_${i}`;
      state.cardMap[id] = { id, name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
      state.zones.deck.push(id);
    }
  });

  it('主公先单独选,然后其余 3 人同时选(并行 slot)', async () => {
    // bootstrap 是 fire-and-forget,会挂在选将 pending 上
    void bootstrap(state, {
      characters: CHARACTERS,
      playerCount: 4,
      seed: 42,
      gameId: 'test',
    });
    // bootstrap 初始化(抽身份/打乱池/动态 import 开局+character-meta)需要微任务推进,
    // 轮询等主公选将 slot 出现(窗口留定足,避免环境抖动导致误判)
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    await waitForStable(state);

    // 第一步:只有主公 1 个选将 slot(主公由抽身份决定,这里 P0-P3 都可能)
    expect(state.pendingSlots.size).toBe(1);
    const lordSlot = [...state.pendingSlots.values()][0];
    expect(lordSlot.atom.type).toBe('选将询问');
    const lordTarget = (lordSlot.atom as { target: number }).target;
    const lordCandidates = (lordSlot.atom as { candidates: Array<{ name: string }> }).candidates;
    expect(lordCandidates.length).toBeGreaterThan(0);

    // 主公选第一个候选人
    await respondCharSelect(state, lordTarget, lordCandidates[0].name);

    // 并行选将创建需要额外微任务推进,多等一轮
    await waitForStable(state);

    // 第二步:其余 3 人并行选(3 个 slot 同时存在)
    expect(state.pendingSlots.size).toBe(3);
    const parallelTargets = [...state.pendingSlots.values()].map(s => (s.atom as { target: number }).target);
    expect(parallelTargets).not.toContain(lordTarget);
    expect(parallelTargets.length).toBe(3);

    // 各 slot 的候选人现在可能重叠(池子小,所有非主公共享同一份 5 张候选人)
    // 核心验证:3 个 slot 都是 选将询问 类型
    for (const slot of state.pendingSlots.values()) {
      expect(slot.atom.type).toBe('选将询问');
    }

    // 其他人各自选:必须选不同的武将(并行场景下 validate 保证唯一,先选先得)
    const taken = new Set<string>([lordCandidates[0].name]);
    for (const t of parallelTargets) {
      const slot = state.pendingSlots.get(t)!;
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates;
      const choice = cand.find(c => !taken.has(c.name));
      expect(choice).toBeDefined();
      taken.add(choice!.name);
      await respondCharSelect(state, t, choice!.name);
    }

    // 全部选完 → 进入游戏(发牌 + 回合开始),无 pending 残留
    // bootstrap 后续流程(技能注册/洗牌/发牌/回合开始)需要多次微任务推进。
    // 轮询直到所有玩家都拿到手牌(发牌完成的可观察信号),避免固定 setTimeout 在
    // 高负载/多技能实例化场景下的 flaky(更多 DEFAULT_SKILLS → 更多 dynamic import)。
    const bootDeadline = Date.now() + 8000;
    while (Date.now() < bootDeadline) {
      await waitForStable(state);
      if (state.pendingSlots.size === 0 && state.players.every(p => p.hand.length > 0)) break;
      await new Promise(r => setTimeout(r, 50));
    }
    await waitForStable(state);
    expect(state.pendingSlots.size).toBe(0);

    // 所有玩家都选了武将
    for (const p of state.players) {
      expect(p.character).toBeTruthy();
    }
    // 已发牌(每人有手牌)
    for (const p of state.players) {
      expect(p.hand.length).toBeGreaterThan(0);
    }
  }, 15000);
});
