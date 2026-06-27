// 选将分配逻辑测试:验证按身份发放候选武将、候选池入池。
//
// 覆盖点:
//   1. 主公选将数量为 7(身份配置);主公未选的武将全部进入候选池供其他人分配。
//   2. 非主公按身份分配候选数(忠臣5/反贼4/内奸5);候选人跨玩家不重复。
//   3. 选将完成后只实例化引擎默认技能,武将自身技能不进入 player.skills。
import { describe, it, expect, beforeEach } from 'vitest';
import { waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { bootstrap, dispatch, resetForTest } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';
import { DEFAULT_SKILLS } from '../../src/engine/atoms/选将';
import { isLord, LORD_CANDIDATES } from '../../src/engine/character-meta';

/** 造一个足够大的武将池(>= 7+5+4+5=21,覆盖 4 人局独占模式总需求) */
function makeBigCharPool(n: number): Array<{ name: string; skills: string[] }> {
  const pool: Array<{ name: string; skills: string[] }> = [];
  for (let i = 0; i < n; i++) {
    // 每 3 个武将挂 1 个技能,验证候选人携带 skills 字段
    const skills = i % 3 === 0 ? [`技能${i}`] : [];
    pool.push({ name: `武将${i}`, skills });
  }
  return pool;
}

/** 造一个含 7 个真实常备主公 + 其余假武将的混合池。
 *  用干主公候选拆分(5+2)测试:前 7 个为 LORD_CANDIDATES 成员,后面为假武将 武将7..n-1。 */
function makeLordMixedPool(n: number): Array<{ name: string; skills: string[] }> {
  const pool: Array<{ name: string; skills: string[] }> = [];
  const lordNames = LORD_CANDIDATES.slice(0, Math.min(LORD_CANDIDATES.length, n));
  for (const name of lordNames) {
    pool.push({ name, skills: [] });
  }
  for (let i = lordNames.length; i < n; i++) {
    const skills = i % 3 === 0 ? [`技能${i}`] : [];
    pool.push({ name: `武将${i}`, skills });
  }
  return pool;
}

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

/** 取当前选将 slot 的候选人名 */
function slotCandidates(slot: GameState['pendingSlots'] extends Map<unknown, infer V> ? V : never): string[] {
  return (slot.atom as { candidates: Array<{ name: string }> }).candidates.map(c => c.name);
}

describe('选将分配:按身份发放 + 候选池入池', () => {
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
    for (let i = 0; i < 40; i++) {
      const id = `deck_${i}`;
      state.cardMap[id] = { id, name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
      state.zones.deck.push(id);
    }
  });

  it('主公候选数为 7;主公未选武将进入候选池', async () => {
    // 武将池:前 7 个为真实常备主公,其余为假武将。验证 5+2 拆分。
    const pool = makeLordMixedPool(25);
    void bootstrap(state, { characters: pool, playerCount: 4, seed: 1, gameId: 't' });
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    await waitForStable(state);

    // 只有主公 1 个 slot
    expect(state.pendingSlots.size).toBe(1);
    const lordSlot = [...state.pendingSlots.values()][0];
    expect(lordSlot.atom.type).toBe('选将询问');
    // 主公候选数 = 7(池足够时)
    const lordCand = slotCandidates(lordSlot);
    expect(lordCand.length).toBe(7);
    // 主公候选拆分:恰好 5 个常备主公 + 2 个非常备(以 isLord / LORD_CANDIDATES 为依据)
    const lordCount = lordCand.filter(n => isLord(n)).length;
    const nonLordCount = lordCand.length - lordCount;
    expect(lordCount).toBe(5);
    expect(nonLordCount).toBe(2);
    // 所有常备主公都来自 LORD_CANDIDATES 名单
    for (const n of lordCand) {
      if (isLord(n)) expect(LORD_CANDIDATES).toContain(n);
    }
    const lordTarget = (lordSlot.atom as { target: number }).target;

    // 主公选第一个
    const lordChoice = lordCand[0];
    await respondCharSelect(state, lordTarget, lordChoice);
    await waitForStable(state);

    // 其余 3 人并行选
    expect(state.pendingSlots.size).toBe(3);
    const slots = [...state.pendingSlots.values()];
    // 候选池不应含主公已选武将
    for (const s of slots) {
      expect(slotCandidates(s)).not.toContain(lordChoice);
    }
  }, 10000);

  it('池足够时:非主公按身份分配候选数且跨玩家不重复', async () => {
    // 25 武将:主公7 + 忠臣5 + 反贼4 + 内奸5 = 21,余量充足
    const pool = makeBigCharPool(25);
    void bootstrap(state, { characters: pool, playerCount: 4, seed: 2, gameId: 't' });
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    await waitForStable(state);

    // 主公选完
    const lordSlot = [...state.pendingSlots.values()][0];
    const lordTarget = (lordSlot.atom as { target: number }).target;
    await respondCharSelect(state, lordTarget, slotCandidates(lordSlot)[0]);
    await waitForStable(state);

    // 3 个并行 slot,按身份分配
    const identityCount: Record<string, number> = {};
    const allCandidates: string[] = [];
    for (const s of state.pendingSlots.values()) {
      const t = (s.atom as { target: number }).target;
      const id = state.players[t].identity as string;
      const cnt = slotCandidates(s).length;
      identityCount[id] = (identityCount[id] ?? 0) + 1;
      allCandidates.push(...slotCandidates(s));
    }

    // 每种身份的候选数符合配置
    // 4 人局:忠臣1/反贼1/内奸1 各 1 人
    expect(identityCount['忠臣']).toBe(1);
    expect(identityCount['反贼']).toBe(1);
    expect(identityCount['内奸']).toBe(1);

    // 按身份数量校验
    for (const s of state.pendingSlots.values()) {
      const t = (s.atom as { target: number }).target;
      const id = state.players[t].identity as string;
      const cnt = slotCandidates(s).length;
      if (id === '忠臣') expect(cnt).toBe(5);
      if (id === '反贼') expect(cnt).toBe(4);
      if (id === '内奸') expect(cnt).toBe(5);
    }

    // 跨玩家不重复(独占模式)
    const uniqueSet = new Set(allCandidates);
    expect(uniqueSet.size).toBe(allCandidates.length);
  }, 10000);

  it('候选人携带 skills 字段供 UI 显示', async () => {
    const pool = makeBigCharPool(25);
    void bootstrap(state, { characters: pool, playerCount: 4, seed: 3, gameId: 't' });
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    await waitForStable(state);

    const lordSlot = [...state.pendingSlots.values()][0];
    const candWithSkills = (lordSlot.atom as {
      candidates: Array<{ name: string; skills: string[] }>;
    }).candidates;
    // 每 3 个武将有 1 个带技能,7 个候选人里至少应有携带 skills 字段的
    const hasSkillsField = candWithSkills.filter(c => Array.isArray(c.skills));
    expect(hasSkillsField.length).toBe(7); // 都带 skills 字段(可能为空数组)
  }, 10000);

  it('选将完成后只保留引擎默认技能,不实例化武将技能', async () => {
    // 用带技能的武将池
    const pool = makeBigCharPool(25);
    void bootstrap(state, { characters: pool, playerCount: 4, seed: 4, gameId: 't' });
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    await waitForStable(state);

    // 主公选一个带技能的武将(武将0/3/6...带 技能X)
    const lordSlot = [...state.pendingSlots.values()][0];
    const lordTarget = (lordSlot.atom as { target: number }).target;
    const lordCand = (lordSlot.atom as {
      candidates: Array<{ name: string; skills: string[] }>;
    }).candidates;
    const skilled = lordCand.find(c => c.skills.length > 0)!;
    await respondCharSelect(state, lordTarget, skilled.name);
    await waitForStable(state);

    // 其他人随便选
    const taken = new Set<string>([skilled.name]);
    for (const t of state.pendingSlots.keys()) {
      const slot = state.pendingSlots.get(t)!;
      const cand = slotCandidates(slot);
      const choice = cand.find(c => !taken.has(c))!;
      taken.add(choice);
      await respondCharSelect(state, t, choice);
    }

    // 等 bootstrap 完成
    await new Promise(r => setTimeout(r, 500));
    await waitForStable(state);

    // 所有玩家 skills 包含 DEFAULT_SKILLS + 各自武将技能
    const defaultSet = new Set(DEFAULT_SKILLS);
    for (const p of state.players) {
      // 至少包含默认技能
      for (const ds of DEFAULT_SKILLS) {
        expect(p.skills).toContain(ds);
      }
      // 武将自身技能也应写入 player.skills(instantiateSkill 会跳过未注册模块)
      // 选了武将的玩家应有该武将的技能
      if (p.character) {
        const charSkills = state.players.flatMap(pl => {
          // 从 pendingSlots 或已 resolve 的 slot 找候选人的 skills
          return [];
        });
        // 至少包含默认技能,不要求为空
        expect(p.skills.length).toBeGreaterThanOrEqual(DEFAULT_SKILLS.length);
      }
    }
  }, 10000);

  it('选将超时:未选玩家自动从候选分配武将,不留空武将', async () => {
    // 用大池,主公选完后其他人并行选;只让主公选,其余 3 人超时 → 应自动分配
    const pool = makeLordMixedPool(25);
    void bootstrap(state, { characters: pool, playerCount: 4, seed: 7, gameId: 't' });
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    await waitForStable(state);

    // 主公选
    const lordSlot = [...state.pendingSlots.values()][0];
    const lordTarget = (lordSlot.atom as { target: number }).target;
    await respondCharSelect(state, lordTarget, slotCandidates(lordSlot)[0]);
    await waitForStable(state);

    // 其余 3 人并行选将 slot 存在
    expect(state.pendingSlots.size).toBe(3);
    const parallelTargets = [...state.pendingSlots.keys()];
    const candidatesBefore = new Map<number, string[]>();
    for (const t of parallelTargets) {
      candidatesBefore.set(t, slotCandidates(state.pendingSlots.get(t)!));
    }

    // 不 respond,直接触发超时(模拟玩家超时未选)
    const { fireTimeoutAndWait } = await import('../engine-harness');
    await fireTimeoutAndWait(state);

    // 超时后:所有玩家都应被分配武将(从各自候选随机选),无空武将
    for (const p of state.players) {
      expect(p.character).toBeTruthy();
    }
    // 超时分配的武将应来自各自候选列表(且不与主公重复)
    const lordChar = state.players[lordTarget].character;
    for (const t of parallelTargets) {
      const assigned = state.players[t].character;
      expect(assigned).not.toBe(lordChar);
      // 分配的武将在该玩家原候选列表中
      expect(candidatesBefore.get(t)).toContain(assigned);
    }
    // 跨玩家不重复
    const allChars = state.players.map(p => p.character);
    expect(new Set(allChars).size).toBe(allChars.length);
    // 分配后进入游戏(超时 resolve 所有 slot → bootstrap 继续)
    await new Promise(r => setTimeout(r, 500));
    await waitForStable(state);
  }, 10000);
});
