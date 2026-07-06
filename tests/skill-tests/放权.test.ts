// 放权(刘禅·主动技)行为测试:
//   1. 出牌阶段发动放权 → 跳过出牌阶段(直接进入弃牌阶段)
//   2. 回合结束时弃一张手牌
//   3. 不发动放权 → 出牌阶段正常进行
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

describe('放权', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('出牌阶段发动放权 → 跳过出牌阶段,回合结束时弃一张手牌', async () => {
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
            skills: ['放权'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
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
    LC.expectPending('请求回应');

    // 选择发动放权
    await LC.respond('放权', { choice: true });
    await harness.waitForStable();

    // 出牌阶段被跳过:phase 应推进到弃牌(阶段结束 已 apply)
    // turn.vars['放权/active'] 应为 true(等回合结束时消费)
    expect(harness.state.localVars['放权/active']).toBe(true);

    // 模拟回合结束:触发放权弃牌
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    LC.expectPending('请求回应');

    // 弃一张手牌(选 c1)
    await LC.respond('放权', { cardId: 'c1' });
    await harness.waitForStable();

    // c1 被弃置
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[0].hand).toContain('c2');
    expect(harness.state.zones.discardPile).toContain('c1');
    // 放权标记已消费
    expect(harness.state.localVars['放权/active']).toBeFalsy();
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
            skills: ['放权'],
            health: 3,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
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
    LC.expectPending('请求回应');

    // 选择不发动
    await LC.respond('放权', { choice: false });
    await harness.waitForStable();

    // 未设放权标记
    expect(harness.state.localVars['放权/active']).toBeFalsy();
    // 手牌未变
    expect(harness.state.players[0].hand).toEqual(['c1']);
  });
});
