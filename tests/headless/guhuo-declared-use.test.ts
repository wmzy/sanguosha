// 声明型主动技(蛊惑/界蛊惑)的「声明」必须能被真实客户端表达。
//
// 引擎侧 use action 要求 `params.declaredName ∈ {杀,桃,酒}`,但浏览器与无头/AI 客户端
// 都没有构造该参数的路径(prompt 是 useCard 且无 cardFilter.filter → 卡牌点击路径
// extractCardFilter 返回 null 永不匹配;也无 transform → 技能按钮路径也不渲染)。
// 结果:整条主动使用路径在真实客户端不可达 —— 按钮点了没反应、AI 枚举不出,
// 只有技能测试手写 declaredName 能跑通。
//
// 修复约定(与 界渐营/界矫诏 的 `transform:<牌名>` 同款):把「声明」编码进 actionType
// —— `use:杀` / `use:桃` / `use:酒`,一个声明一个 action,前后端一一对应。
import { describe, it, expect, beforeEach } from 'vitest';
import { enumerateAvailableActions } from '../../src/client/headless/availableActions';
import {
  registerSkillActions,
  clearRegistry,
  getActionsForPlayer,
} from '../../src/client/skillActionRegistry';
import { buildView, dispatch, registerSkillsFromState } from '../../src/engine/index';
import { createGameState, suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import type { AvailableAction } from '../../src/client/headless/types';
import '../../src/engine/atoms';

function mkCard(id: string, name: string, suit: Card['suit'], rank: string): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills: string[];
  health?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    faction: '群',
    health: opts.health ?? 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills,
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 组装 state 并按真实客户端路径注册技能 + 枚举 seat 的可执行动作。 */
async function enumerateFor(opts: {
  skill: string;
  players: PlayerState[];
  cardMap: Record<string, Card>;
  seat: number;
}): Promise<{ state: GameState; actions: AvailableAction[] }> {
  const state = createGameState({
    players: opts.players,
    cardMap: opts.cardMap,
    currentPlayerIndex: opts.seat,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
  state.zones = { deck: [], discardPile: [], processing: [] };
  await registerSkillsFromState(state);
  clearRegistry();
  for (const p of state.players) await registerSkillActions(p.index, p.skills);
  const view = buildView(state, opts.seat);
  const actions = enumerateAvailableActions(view, opts.seat, getActionsForPlayer(opts.seat));
  return { state, actions };
}

const CARDS = {
  c1: mkCard('c1', '杀', '♠', '7'),
  c2: mkCard('c2', '闪', '♥', '3'),
};

describe('蛊惑/界蛊惑:声明编码进 actionType,客户端枚举出的 action 必须被引擎接受', () => {
  beforeEach(() => {
    clearRegistry();
  });

  for (const skill of ['蛊惑', '界蛊惑'] as const) {
    it(`${skill}:枚举出 use:杀(声明杀)→ 补目标后被接受`, async () => {
      const { state, actions } = await enumerateFor({
        skill,
        players: [
          mkPlayer({ index: 0, name: '于吉', hand: ['c1'], skills: [skill, '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: ['c2'], skills: [] }),
        ],
        cardMap: { ...CARDS },
        seat: 0,
      });
      const action = actions.find((a) => a.message.actionType === 'use:杀');
      expect(action, '客户端应枚举出「声明杀」的 action').toBeDefined();
      expect(action!.message.skillId).toBe(skill);
      expect(action!.validTargets).toContain(1);

      const result = await dispatch(state, {
        ...action!.message,
        params: { ...action!.message.params, targets: [1], target: 1 },
        ownerId: 0,
        baseSeq: state.seq,
      });
      expect(result.accepted, '客户端枚举的 use:杀 必须被引擎接受').toBe(true);
    });

    it(`${skill}:枚举出 use:桃(声明桃,自己受伤)→ 被接受`, async () => {
      const { state, actions } = await enumerateFor({
        skill,
        players: [
          mkPlayer({ index: 0, name: '于吉', hand: ['c1'], skills: [skill, '回合管理'], health: 2 }),
          mkPlayer({ index: 1, name: 'P1', hand: ['c2'], skills: [] }),
        ],
        cardMap: { ...CARDS },
        seat: 0,
      });
      const action = actions.find((a) => a.message.actionType === 'use:桃');
      expect(action, '客户端应枚举出「声明桃」的 action').toBeDefined();

      const result = await dispatch(state, {
        ...action!.message,
        params: { ...action!.message.params },
        ownerId: 0,
        baseSeq: state.seq,
      });
      expect(result.accepted, '客户端枚举的 use:桃 必须被引擎接受').toBe(true);
    });

    it(`${skill}:于吉满血+他人受伤 → use:桃 不被枚举`, async () => {
      const { actions } = await enumerateFor({
        skill,
        players: [
          // 于吉满血;桃的 prompt 是 selfTarget(目标锁自己),引擎 validate 拒满血目标
          // → 他人受伤不构成入口,枚举出即「客户端发得出、引擎必拒」
          mkPlayer({ index: 0, name: '于吉', hand: ['c1'], skills: [skill, '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: ['c2'], skills: [], health: 2 }),
        ],
        cardMap: { ...CARDS },
        seat: 0,
      });
      expect(
        actions.some((a) => a.message.actionType === 'use:桃'),
        '满血于吉不应枚举出「声明桃」入口',
      ).toBe(false);
      // 其他声明入口不受影响(杀有目标可选、酒无目标)
      expect(actions.some((a) => a.message.actionType === 'use:杀')).toBe(true);
      expect(actions.some((a) => a.message.actionType === 'use:酒')).toBe(true);
    });

    it(`${skill}:枚举出 use:酒(声明酒,无目标)→ 被接受`, async () => {
      const { state, actions } = await enumerateFor({
        skill,
        players: [
          mkPlayer({ index: 0, name: '于吉', hand: ['c1'], skills: [skill, '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: ['c2'], skills: [] }),
        ],
        cardMap: { ...CARDS },
        seat: 0,
      });
      const action = actions.find((a) => a.message.actionType === 'use:酒');
      expect(action, '客户端应枚举出「声明酒」的 action').toBeDefined();

      const result = await dispatch(state, {
        ...action!.message,
        params: { ...action!.message.params },
        ownerId: 0,
        baseSeq: state.seq,
      });
      expect(result.accepted, '客户端枚举的 use:酒 必须被引擎接受').toBe(true);
    });

    it(`${skill}:普通锦囊 use:无中生有 可枚举并被引擎接受`, async () => {
      const cardMap = {
        trick: { ...mkCard('trick', '闪', '♦', '3'), name: '闪' },
        deck1: mkCard('deck1', '杀', '♠', '2'),
        deck2: mkCard('deck2', '桃', '♥', '8'),
      };
      const { state, actions } = await enumerateFor({
        skill,
        players: [
          mkPlayer({ index: 0, name: skill === '蛊惑' ? '于吉' : '界于吉', hand: ['trick'], skills: [skill, '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
        ],
        cardMap,
        seat: 0,
      });
      state.zones.deck = ['deck1', 'deck2'];
      const action = actions.find((a) => a.message.actionType === 'use:无中生有');
      expect(action, '必须声明任意手牌为无中生有').toBeDefined();
      const result = await dispatch(state, {
        ...action!.message,
        params: { ...action!.message.params, cardId: 'trick' },
        ownerId: 0,
        baseSeq: state.seq,
      });
      expect(result.accepted).toBe(true);
    });

    it(`${skill}:声明包含基本牌和已实现普通锦囊(闪只能走 dodge 响应路径)`, async () => {
      const { state, actions } = await enumerateFor({
        skill,
        players: [
          // 于吉已受伤:声明【桃】的 activeWhen 要求自己受伤(否则不出按钮)
          mkPlayer({ index: 0, name: '于吉', hand: ['c1'], skills: [skill, '回合管理'], health: 2 }),
          mkPlayer({ index: 1, name: 'P1', hand: ['c2'], skills: [] }),
        ],
        cardMap: { ...CARDS },
        seat: 0,
      });
      const declared = [
        ...new Set(
          actions
            .filter((a) => a.message.skillId === skill)
            .map((a) => a.message.actionType)
            .filter((t) => t.startsWith('use:')),
        ),
      ].sort();
      expect(declared).toEqual([
        'use:万箭齐发', 'use:五谷丰登', 'use:决斗', 'use:南蛮入侵', 'use:无中生有',
        'use:杀', 'use:桃', 'use:桃园结义', 'use:酒', 'use:火攻', 'use:过河拆桥',
        'use:铁索连环', 'use:顺手牵羊',
      ].sort());
      // 引擎侧不存在 use:闪(闪无主动效果)
      const { findActionEntry } = await import('../../src/engine/core/skill');
      expect(findActionEntry(state, skill, 0, 'use:闪')).toBeUndefined();
    });
  }
});
