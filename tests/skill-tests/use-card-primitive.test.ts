// tests/skill-tests/use-card-primitive.test.ts
//
// 归并说明(AGENTS.md):本文件测试 useCard 共享原语(card-effect/use-card.ts)的
// quotaPolicy / mandatedTargets / skipValidate 契约，而非某一个武将技能，故独立成文件。
// 候选归并目标 tests/engine/slash-quota.test.ts(同样测出杀次数底层);但 useCard 是
// card-effect 层原语、slash-quota 是更底层模块，层级不同，暂独立。后续若有 card-effect
// 层集成测试目录可并入。
//
// 直接调 useCard(state, source, cardId, targets, opts)，绕过 dispatch/use action，
// 验证原语本身的行为。杀流程的「询问闪」pending 用 fireTimeoutAndWait 推进(P2 不出闪)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable, fireTimeoutAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { useCard } from '../../src/engine/card-effect/use-card';
import { slashUsed } from '../../src/engine/slash-quota';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  alive?: boolean;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['杀'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function buildState(hand: string[]): GameState {
  const cards: Record<string, Card> = {};
  for (const id of hand) cards[id] = makeCard(id, '杀');
  const players = [
    makePlayer({ index: 0, name: 'P1', hand, skills: ['杀'] }),
    makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
  ];
  return createGameState({
    players,
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

// 推进一次 杀 流程到结束:useCard 启动 → 等到「询问闪」pending → P2 超时不出闪 → 收尾。
async function runSlashToCompletion(
  state: GameState,
  source: number,
  cardId: string,
  target: number,
  opts: Parameters<typeof useCard>[4],
): Promise<string | null> {
  const p = useCard(state, source, cardId, [target], opts);
  await waitForStable(state); // 「询问闪」pending 就绪
  await fireTimeoutAndWait(state); // P2 不出闪 → 杀生效
  return p;
}

describe('useCard 原语', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── quotaPolicy='charge'：计出杀次数 + 受次数上限约束 ───
  it('charge: 出杀成功并累加出杀次数；第二次 charge 出杀被次数上限拒绝', async () => {
    const state = buildState(['s1', 's2']);
    await harness.setup(state);

    // 第一张：charge 出杀成功，onSettle 触发 incSlashUsed
    const r1 = await runSlashToCompletion(state, 0, 's1', 1, { quotaPolicy: 'charge' });
    expect(r1).toBeNull();
    expect(slashUsed(state)).toBe(1);

    // 第二张：charge → validate(play 模式) → checkUsageLimit → 已达上限(基础 1) → 拒绝
    const r2 = await useCard(state, 0, 's2', [1], { quotaPolicy: 'charge' });
    expect(typeof r2).toBe('string');
    expect(slashUsed(state)).toBe(1); // 被拒，计数不变
  });

  // ─── quotaPolicy='none'：不计次数(onSettle 跳过) + 不受上限挡(forced/skipValidate) ───
  it('none: onSettle 跳过 → slashUsed 不累加；逼杀(skipValidate)不受次数上限限制', async () => {
    const state = buildState(['s1', 's2', 's3']);
    await harness.setup(state);

    // ① none 在全新状态下出杀：成功且不计次数(onSettle 跳过)
    const r1 = await runSlashToCompletion(state, 0, 's1', 1, { quotaPolicy: 'none' });
    expect(r1).toBeNull();
    expect(slashUsed(state)).toBe(0); // onSettle 未调用 → 不计数

    // ② 逼杀语义：先用 charge 用满次数(s2)，再用 none+skipValidate 出杀(s3)。
    //    skipValidate 跳过整段 validate(含 杀.canUse 的 canSlash 检查)→ 不被上限挡；
    //    且 onSettle 跳过 → 不再计数(slashUsed 仍为 1)。
    await runSlashToCompletion(state, 0, 's2', 1, { quotaPolicy: 'charge' });
    expect(slashUsed(state)).toBe(1);
    const r2 = await runSlashToCompletion(state, 0, 's3', 1, {
      quotaPolicy: 'none',
      skipValidate: true,
    });
    expect(r2).toBeNull();
    expect(slashUsed(state)).toBe(1); // 逼杀不计次数，未被上限挡
  });

  // ─── mandatedTargets：targets 缺少必含目标时返回错误字符串 ───
  it('mandatedTargets: targets 缺少必含目标时返回错误字符串(不进入流程)', async () => {
    const state = buildState(['s1']);
    await harness.setup(state);
    // skipValidate 隔离 mandatedTargets 逻辑;targets=[1] 不含 mandated 2
    const err = await useCard(state, 0, 's1', [1], {
      quotaPolicy: 'none',
      skipValidate: true,
      mandatedTargets: [2],
    });
    expect(err).toBe('必须包含目标 2');
  });
});
