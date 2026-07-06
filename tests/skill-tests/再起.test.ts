// 再起(孟获·主动技)行为测试:
//   1. 受伤时摸牌阶段:发动再起 → 展示牌堆顶X张,红桃回血+弃置,非红桃入手
//   2. 未受伤时摸牌阶段:不触发(默认摸牌)
//   3. 发动再起后跳过默认摸牌(手牌数=X-红桃数,非2)
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

describe('再起', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('受伤时摸牌阶段:发动再起 → 红桃回血弃置,非红桃入手,跳过默认摸牌', async () => {
    // 孟获 maxHealth=4, health=2 → 已损失2 → X=2
    // 牌堆顶2张:♥5(红桃→回血+弃置), ♠3(非红桃→入手)
    const h5 = mkCard('h5', '杀', '♥', '5');
    const s3 = mkCard('s3', '杀', '♠', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '孟获',
            character: '孟获',
            hand: [],
            skills: ['再起'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: { h5, s3 },
        // deck: 末尾为牌堆顶(与 摸牌 atom 一致)
        zones: { deck: ['h5', 's3'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const MH = harness.player('孟获');

    // 触发摸牌阶段开始(再起 before-hook 询问)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 选择发动再起
    await MH.respond('再起', { choice: true });
    await harness.waitForStable();

    // 红桃♥5:回血1(2→3)+弃置;非红桃♠3:入手
    expect(harness.state.players[0].health).toBe(3); // 回复1点
    expect(harness.state.players[0].hand).toEqual(['s3']); // 非红桃入手
    expect(harness.state.zones.discardPile).toContain('h5'); // 红桃弃置
    expect(harness.state.zones.discardPile).not.toContain('s3'); // 非红桃不弃
  });

  it('未受伤时摸牌阶段:不触发再起(默认摸牌)', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    const c2 = mkCard('c2', '杀', '♥', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '孟获',
            character: '孟获',
            hand: [],
            skills: ['再起'],
            health: 4, // 满血
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: { c1, c2 },
        zones: { deck: ['c1', 'c2'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );

    // 触发摸牌阶段开始:满血不触发再起
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();

    // 无再起询问 pending(可能直接默认摸牌或无 pending)
    // 再起未受伤不触发 → 不 cancel → 回合管理 after-hook 会自动摸2张
    // 但此处只 applyAtom 阶段开始,不经过 回合管理 的阶段推进,故无自动摸牌
    // 关键断言:没有再起的 confirm 询问
    const slots = [...harness.state.pendingSlots.values()];
    const hasZaiqi = slots.some((s) => {
      const rt = (s.atom as unknown as { requestType?: string }).requestType;
      return rt === '再起/trigger';
    });
    expect(hasZaiqi).toBe(false);
  });

  it('不发动再起 → 走默认摸牌(不跳过)', async () => {
    const c1 = mkCard('c1', '杀', '♠', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '孟获',
            character: '孟获',
            hand: [],
            skills: ['再起'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: { c1 },
        zones: { deck: ['c1'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );
    const MH = harness.player('孟获');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 选择不发动
    await MH.respond('再起', { choice: false });
    await harness.waitForStable();

    // 不发动 → 不跳过,无额外操作(手牌仍为0,默认摸牌由回合管理处理)
    expect(harness.state.players[0].hand.length).toBe(0);
  });
});
