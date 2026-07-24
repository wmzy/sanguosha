// tests/skill-tests/statechange-timing.test.ts
// 模块 E:状态变更时机 atom 验证(对齐 docs/flow-redesign.md 模块 E)。
//
// 验证点:
//   1. 翻面后:flipFaceDown 发 faceDown=true,flipFaceUp 发 faceDown=false
//   2. 横置后:setChain(chained=true/false) 在 设横置 后发出
//   3. 横置后:SetChain 设横置 被 before-hook cancel 时不发出(返回 false)
//   4. 解围方向修正:翻成背面(flipFaceDown)时触发,翻回正面(flipFaceUp)时不触发
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Atom, Card, GameState, PlayerState } from '../../src/engine/types';
import { registerBeforeHook } from '../../src/engine/skill';
import { flipFaceDown, flipFaceUp, setChain } from '../../src/engine/face-down';
import { SkillTestHarness, waitForStable, fireTimeoutAndWait } from '../engine-harness';
import { suitColor } from '../../src/shared/types';

// ─── 直测辅助:最小 2 人 state ───────────────────────────────

function makePlayer(opts: {
  index: number;
  name: string;
  health?: number;
  maxHealth?: number;
  hand?: string[];
  skills?: string[];
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
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
  };
}

function makeState(opts?: { p0Skills?: string[]; p0Hand?: string[] }): GameState {
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P0', skills: opts?.p0Skills ?? [], hand: opts?.p0Hand }),
      makePlayer({ index: 1, name: 'P1' }),
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

/** 取 state.atomHistory 中所有 atom 事件(跳过 notify)的 type 序列。 */
function atomTypes(state: GameState): string[] {
  return state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom.type);
}

/** 从 atomHistory 取第一个匹配 type 的 atom(断言为对应形状)。 */
function findAtom<T extends Atom>(state: GameState, type: string): T {
  const hit = state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom)
    .find((a) => a.type === type);
  if (!hit) throw new Error(`未找到 atom: ${type}`);
  return hit as T;
}

// ─── 1. 翻面后 atom ──────────────────────────────────────────

describe('模块 E:翻面后 atom', () => {
  it('flipFaceDown → 加标签 + 翻面后(faceDown=true)', async () => {
    const state = makeState();
    await flipFaceDown(state, 0, '测试');
    const types = atomTypes(state);
    expect(types).toContain('加标签');
    expect(types).toContain('翻面后');
    const flip = findAtom<Extract<Atom, { type: '翻面后' }>>(state, '翻面后');
    expect(flip.faceDown).toBe(true);
    expect(flip.player).toBe(0);
    // 翻面后 在 加标签 之后
    expect(types.indexOf('加标签')).toBeLessThan(types.indexOf('翻面后'));
  });

  it('flipFaceUp → 去标签 + 翻面后(faceDown=false)', async () => {
    const state = makeState();
    // 先翻成背面,再翻回正面,确认两次 翻面后 的 faceDown 取值
    await flipFaceDown(state, 0, '测试');
    state.atomHistory.length = 0;
    await flipFaceUp(state, 0, '测试');
    const types = atomTypes(state);
    expect(types).toContain('去标签');
    expect(types).toContain('翻面后');
    const flip = findAtom<Extract<Atom, { type: '翻面后' }>>(state, '翻面后');
    expect(flip.faceDown).toBe(false);
  });
});

// ─── 2/3. 横置后 atom ────────────────────────────────────────

describe('模块 E:横置后 atom', () => {
  it('setChain(true) → 设横置 + 横置后(chained=true)', async () => {
    const state = makeState();
    const applied = await setChain(state, 0, true);
    expect(applied).toBe(true);
    const types = atomTypes(state);
    expect(types).toContain('设横置');
    expect(types).toContain('横置后');
    const chain = findAtom<Extract<Atom, { type: '横置后' }>>(state, '横置后');
    expect(chain.chained).toBe(true);
    // 横置后 在 设横置 之后
    expect(types.indexOf('设横置')).toBeLessThan(types.indexOf('横置后'));
  });

  it('setChain(false) → 设横置 + 横置后(chained=false)', async () => {
    const state = makeState();
    const applied = await setChain(state, 0, false);
    expect(applied).toBe(true);
    const chain = findAtom<Extract<Atom, { type: '横置后' }>>(state, '横置后');
    expect(chain.chained).toBe(false);
  });

  it('设横置 被 before-hook cancel → setChain 返回 false 且不发 横置后', async () => {
    const state = makeState();
    registerBeforeHook(state, 'mockCancel', 1, '设横置', async () => {
      return { kind: 'cancel' as const };
    });
    const applied = await setChain(state, 0, true);
    expect(applied).toBe(false);
    const types = atomTypes(state);
    // 设横置 被 cancel:不入 atomHistory,只发 notify(atomCancelled)
    expect(types).not.toContain('设横置');
    expect(types).not.toContain('横置后');
  });
});

// ─── 4. 解围方向修正(集成) ──────────────────────────────────

describe('模块 E:解围方向修正(翻成背面触发,翻回正面不触发)', () => {
  let harness: SkillTestHarness;

  function makeCard(
    id: string,
    name: string,
    suit: '♠' | '♥' | '♣' | '♦',
    rank = 'A',
    type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  ): Card {
    return { id, name, suit, color: suitColor(suit), rank, type };
  }

  /** 当前是否存在 解围/confirm 询问(= 解围效果②已触发) */
  function hasJieWeiConfirm(state: GameState): boolean {
    for (const slot of state.pendingSlots.values()) {
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type === '请求回应' && atom.requestType === '解围/confirm') return true;
    }
    return false;
  }

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('翻成背面(flipFaceDown)→ 解围效果②触发(出现 解围/confirm 询问)', async () => {
    const cardMap: Record<string, Card> = {
      hand0: makeCard('hand0', '杀', '♠', '7'),
      equip1: { id: 'equip1', name: '诸葛弩', suit: '♣', color: '黑', rank: 'A', type: '装备牌', subtype: '武器' },
    };
    const state: GameState = createGameState({
      players: [
        {
          ...makePlayer({ index: 0, name: 'P0', skills: ['解围'], hand: ['hand0'] }),
          character: '界曹仁',
        },
        makePlayer({ index: 1, name: 'P1' }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // P1 装备一件装备(满足"场上有可移动的牌")
    state.players[1].equipment = { 武器: 'equip1' };
    await harness.setup(state);

    // 解围效果②的 after-hook 会创建阻塞型 请求回应(解围/confirm),不能直接 await flipFaceDown
    // (会卡在 pending 等待回应)。采用 fire-and-forget:启动后等 pending 出现即断言,再超时收尾。
    const flipP = flipFaceDown(harness.state, 0, '测试');
    await waitForStable(harness.state); // pending 创建后返回

    // 解围效果②触发:出现 解围/confirm 询问
    expect(hasJieWeiConfirm(harness.state)).toBe(true);

    // 超时解围/confirm(defaultChoice=false)→ 解围提前返回 → flipFaceDown 结束
    await fireTimeoutAndWait(harness.state);
    await flipP;
  });

  it('翻回正面(flipFaceUp)→ 解围效果②不触发(无 解围/confirm 询问)', async () => {
    const cardMap: Record<string, Card> = {
      hand0: makeCard('hand0', '杀', '♠', '7'),
    };
    const state: GameState = createGameState({
      players: [
        {
          ...makePlayer({ index: 0, name: 'P0', skills: ['解围'], hand: ['hand0'] }),
          character: '界曹仁',
        },
        makePlayer({ index: 1, name: 'P1' }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接翻回正面(faceDown=false)→ 解围 hook 因 faceDown!==true 提前返回
    await flipFaceUp(harness.state, 0, '测试');
    await harness.waitForStable();

    expect(hasJieWeiConfirm(harness.state)).toBe(false);
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
