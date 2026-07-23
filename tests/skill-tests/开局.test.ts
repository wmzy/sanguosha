// 开局(系统级):开局流程。由 bootstrap() 在游戏开始时调用。
//   start action:抽身份 → 选将 → 初始化洗牌 → 发牌 → 回合开始(主公)
//
// 验证:
//   1. 正面:完整开局流程(2人)→ 身份分配、选将完成、发牌完成
//   2. 正面:发牌 atom 给所有玩家发 handSize 张(主公不加)
//   3. 正面:主公先选(串行)
//   4. 负面:playerCount < 2 → validate 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrap, type GameConfig } from '../../src/engine/create-engine';
import { dispatchAndWait, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { GameState, PlayerState } from '../../src/engine/types';
import { allCharacters } from '../../src/engine/cards/characters';

function makePlayer(opts: { index: number; name: string }): PlayerState {
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

const CHARACTERS: Array<{ name: string; skills: string[] }> = allCharacters.map((c) => ({
  name: c.name,
  skills: c.skills.map((s) => s.name),
}));

/** 处理所有选将 pending:对每个有选将 pending 的玩家,选第一个候选人 */
async function resolveAllSelections(state: GameState): Promise<void> {
  let loops = 0;
  while (loops < 20) {
    await waitForStable(state);
    if (state.pendingSlots.size === 0) break;

    let resolved = false;
    for (const [idx, slot] of state.pendingSlots) {
      const player = state.players[idx];
      if (!player || player.character) continue;
      const atom = slot.atom as {
        type?: string;
        candidates?: Array<{ name: string }>;
        selections?: Array<{ target: number; candidates: Array<{ name: string }> }>;
      };
      let candidates: Array<{ name: string }> | undefined;
      if (atom.type === '选将询问') {
        candidates = atom.candidates;
      } else if (atom.type === '并行选将' && atom.selections) {
        candidates = atom.selections.find((s) => s.target === idx)?.candidates;
      }
      if (candidates && candidates.length > 0) {
        const character = candidates[0].name;
        await dispatchAndWait(state, {
          skillId: '系统规则',
          actionType: '选将',
          ownerId: idx,
          params: { character },
          baseSeq: state.seq,
        });
        resolved = true;
        break;
      }
    }
    if (!resolved) break;
    loops++;
  }
}

/** 等待发牌完成(所有玩家有手牌) */
async function waitForDealComplete(state: GameState): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await waitForStable(state);
    if (state.players.every((p) => p.hand.length > 0)) return;
  }
}

describe('开局', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState({
      players: [makePlayer({ index: 0, name: 'P0' }), makePlayer({ index: 1, name: 'P1' })],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 0, phase: '准备', vars: {} },
    });
  });

  // ─── 正面:完整开局流程 ─────────────────────────────────────

  it('正面:完整开局(2人)→ 身份分配 + 选将 + 发牌', async () => {
    const config: GameConfig = {
      characters: CHARACTERS,
      gameId: 'test',
      playerCount: 2,
      seed: 42,
      handSize: 4,
    };
    await bootstrap(state, config);
    await waitForStable(state);
    await resolveAllSelections(state);
    await waitForDealComplete(state);

    // 验证:身份分配(有主公)
    const lord = state.players.find((p) => p.identity === '主公');
    expect(lord).toBeDefined();

    // 验证:选将完成
    for (const player of state.players) {
      expect(player.character).toBeTruthy();
    }

    // 验证:发牌完成
    for (const player of state.players) {
      expect(player.hand.length).toBeGreaterThan(0);
    }

    // 验证:技能已注册(默认技能)
    for (const player of state.players) {
      expect(player.skills).toContain('使用牌');
      expect(player.skills).toContain('打出牌');
      expect(player.skills).toContain('回合管理');
    }

    // 验证:牌堆已初始化
    expect(state.zones.deck.length).toBeGreaterThan(0);
  }, 30000);

  // ─── 正面:发牌 atom 给所有玩家发 handSize 张(主公不加) ────

  it('正面:发牌 atom 给所有玩家发 handSize 张(主公不加)', async () => {
    const config: GameConfig = {
      characters: CHARACTERS,
      gameId: 'test',
      playerCount: 2,
      seed: 42,
      handSize: 4,
    };
    await bootstrap(state, config);
    await waitForStable(state);
    await resolveAllSelections(state);
    await waitForDealComplete(state);

    // 发牌 atom 不再区分主公:handSize=4 且无 lordBonus 字段(不受后续摸牌阶段影响)
    const dealEvent = state.atomHistory.find(
      (e): e is typeof e & { atom: { type: string; handSize?: number } } =>
        e.kind === 'atom' && (e as { atom: { type: string } }).atom.type === '发牌',
    );
    expect(dealEvent).toBeDefined();
    expect(dealEvent!.atom.handSize).toBe(4);
    expect('lordBonus' in dealEvent!.atom).toBe(false);
  }, 30000);

  // ─── 正面:主公先选(串行)────────────────────────────────────

  it('正面:主公先选将 → 然后非主公选将', async () => {
    const config: GameConfig = {
      characters: CHARACTERS,
      gameId: 'test',
      playerCount: 2,
      seed: 99,
      handSize: 4,
    };
    await bootstrap(state, config);
    await waitForStable(state);

    // 第一个 pending 应该是主公的选将询问
    const lordIdx = state.players.findIndex((p) => p.identity === '主公');
    expect(lordIdx).toBeGreaterThanOrEqual(0);

    const lordSlot = state.pendingSlots.get(lordIdx);
    expect(lordSlot).toBeDefined();
    const lordAtom = lordSlot!.atom as { type?: string; candidates?: Array<{ name: string }> };
    expect(lordAtom.type).toBe('选将询问');
    expect(lordAtom.candidates!.length).toBeGreaterThan(0);

    // 主公选第一个候选人
    const lordChoice = lordAtom.candidates![0].name;
    await dispatchAndWait(state, {
      skillId: '系统规则',
      actionType: '选将',
      ownerId: lordIdx,
      params: { character: lordChoice },
      baseSeq: state.seq,
    });
    await waitForStable(state);

    // 主公已选将
    expect(state.players[lordIdx].character).toBe(lordChoice);

    // 完成剩余选将
    await resolveAllSelections(state);
    await waitForDealComplete(state);

    // 所有玩家都已选将
    for (const player of state.players) {
      expect(player.character).toBeTruthy();
    }
  }, 30000);

  // ─── 负面:playerCount < 2 → validate 拒绝 ───────────────────

  it('负面:playerCount < 2 → validate 拒绝,state 不变', async () => {
    const config: GameConfig = {
      characters: CHARACTERS,
      gameId: 'test',
      playerCount: 1,
      seed: 42,
    };
    await bootstrap(state, config);
    await waitForStable(state);

    // validate 拒绝:无身份分配、无选将
    expect(state.players.every((p) => !p.identity)).toBe(true);
    expect(state.players.every((p) => !p.character || p.character === '')).toBe(true);
    // 无发牌
    expect(state.players.every((p) => p.hand.length === 0)).toBe(true);
  });

  // ─── 正面:分配武将后体力值与武将卡牌一致 ─────────────────────

  it('正面:分配武将后体力值=武将卡牌 maxHealth(2人局主公不+1)', async () => {
    const config: GameConfig = {
      characters: CHARACTERS,
      gameId: 'test',
      playerCount: 2,
      seed: 42,
      handSize: 4,
    };
    await bootstrap(state, config);
    await waitForStable(state);
    await resolveAllSelections(state);
    await waitForDealComplete(state);

    // 2 人局(人数≤4):主公不加成,体力=武将卡牌 maxHealth。
    // 注:某些觉醒技(如刘禅·若愚、邓艾·凿险)在主公开局启动第一回合时会修改体力上限。
    // 测试仅在未觉醒时验证原始 maxHealth;觉醒后上限变化由各自技能负责。
    for (const player of state.players) {
      const charDef = allCharacters.find((c) => c.name === player.character);
      expect(charDef).toBeDefined();
      const awakened =
        player.vars['若愚/awakened'] === true ||
        player.vars['界若愚/awakened'] === true ||
        player.vars['凿险/awakened'] === true ||
        player.vars['界凿险/awakened'] === true;
      if (awakened) continue; // 觉醒后上限被技能修改,不在本测试范围
      const expectedMax = charDef!.maxHealth;
      expect(player.maxHealth).toBe(expectedMax);
      // 初始体力 = 体力上限(满血开局)
      expect(player.health).toBe(expectedMax);
    }
  }, 30000);

  // ─── 正面:人数>4(5人局)主公体力 +1 ────────────────────────

  it('正面:5人局分配武将后,主公体力上限=武将maxHealth+1,非主公不加', async () => {
    // 5 人局需要重建 5 人 state(beforeEach 默认 2 人)
    state = createGameState({
      players: [0, 1, 2, 3, 4].map((i) => makePlayer({ index: i, name: `P${i}` })),
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 0, phase: '准备', vars: {} },
    });
    const config: GameConfig = {
      characters: CHARACTERS,
      gameId: 'test-lord-bonus',
      playerCount: 5,
      seed: 7,
      handSize: 4,
    };
    await bootstrap(state, config);
    await waitForStable(state);
    await resolveAllSelections(state);
    await waitForDealComplete(state);

    expect(state.players.length).toBe(5);
    for (const player of state.players) {
      const charDef = allCharacters.find((c) => c.name === player.character);
      expect(charDef).toBeDefined();
      // 某些觉醒技(界若愚/界凿险等)在主公开局启动第一回合时会修改体力上限。
      // 测试仅在未觉醒时验证原始 maxHealth;觉醒后上限变化由各自技能负责。
      const awakened =
        player.vars['若愚/awakened'] === true ||
        player.vars['界若愚/awakened'] === true ||
        player.vars['凿险/awakened'] === true ||
        player.vars['界凿险/awakened'] === true;
      if (awakened) continue;
      const isLord = player.identity === '主公';
      // 人数>4:主公 +1,非主公不加
      const expectedMax = isLord ? charDef!.maxHealth + 1 : charDef!.maxHealth;
      expect(player.maxHealth).toBe(expectedMax);
      expect(player.health).toBe(expectedMax);
      // 确保只有1名主公
      if (isLord) expect(state.players.filter((p) => p.identity === '主公').length).toBe(1);
    }
  }, 30000);
});
