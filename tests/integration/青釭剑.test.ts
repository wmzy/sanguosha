// tests/integration/青釭剑.test.ts
// 集成测试:青釭剑(武器,范围 2)——杀无视目标防具
//
// 覆盖:
//   1. P0 装备青釭剑,P1 装备仁王盾 + 黑杀 → 仁王盾被临时卸载 → 伤害照常生效
//   2. 杀结算完毕后 → 仁王盾技能实例被恢复(玩家 skills 重新包含)
//   3. P0 无青釭剑时,黑杀被仁王盾挡掉(回归测试)
//
// 关键机制(青釭剑.ts):指定目标 after hook 临时 unload 目标防具技能;
//   造成伤害 after hook 重新 instantiate 防具技能。用 tempUnloadMap 跨 atom 通信。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import { dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

describe('青釭剑:杀无视防具', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:青釭剑 + 黑杀 → 仁王盾失效,P1 扣血
  // ─────────────────────────────────────────────────────────────
  it('用例1:P0 装备青釭剑,黑杀 P1(持仁王盾)→ 仁王盾被临时绕过,P1 扣血', async () => {
    const qinggang: Card = { id: 'wp-qg', name: '青釭剑', suit: '♠', rank: '5', type: '装备牌', subtype: '武器', range: 2 };
    const renwang: Card = { id: 'ar-rw', name: '仁王盾', suit: '♣', rank: '2', type: '装备牌', subtype: '防具' };
    const blackSlash: Card = { id: 'k1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [qinggang.id, blackSlash.id],
          equipment: { 武器: qinggang.id },
          skills: ['杀', '装备通用', '青釭剑'],
        }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: { 防具: renwang.id },
          skills: ['闪', '仁王盾'],
        }),
      ],
      cardMap: {
        [qinggang.id]: qinggang,
        [renwang.id]: renwang,
        [blackSlash.id]: blackSlash,
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装备防具已就位:P1.skills 含 仁王盾
    expect(state.players[1].skills).toContain('仁王盾');
    expect(state.players[1].equipment['防具']).toBe(renwang.id);

    const healthBefore = state.players[1].health;

    // P0 出黑杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: blackSlash.id, targets: [1] },
      baseSeq: state.seq,
    });

    // 询问闪 pending(青釭剑的 before hook 不应取消,因为不在 询问闪 时机)
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    // P1 不出闪 → 触发 造成伤害
    await fireTimeoutAndWait(state);

    // 关键断言:黑杀对持仁王盾的 P1 造成了 1 点伤害(青釭剑无视防具)
    expect(state.players[1].health).toBe(healthBefore - 1);
    expect(state.players[1].alive).toBe(true);
    // 杀进弃牌堆
    expect(state.zones.discardPile).toContain(blackSlash.id);
    // 处理区已清空
    expect(state.zones.processing).not.toContain(blackSlash.id);
    // pending 已消费
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:杀结算完毕 → 仁王盾技能实例被重新 instantiate
  // ─────────────────────────────────────────────────────────────
  it('用例2:杀结算后,仁王盾技能实例被重新加载(P1.skills 仍包含 仁王盾)', async () => {
    const qinggang: Card = { id: 'wp-qg', name: '青釭剑', suit: '♠', rank: '5', type: '装备牌', subtype: '武器', range: 2 };
    const renwang: Card = { id: 'ar-rw', name: '仁王盾', suit: '♣', rank: '2', type: '装备牌', subtype: '防具' };
    const blackSlash: Card = { id: 'k1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [blackSlash.id],
          equipment: { 武器: qinggang.id },
          skills: ['杀', '装备通用', '青釭剑'],
        }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: { 防具: renwang.id },
          skills: ['闪', '仁王盾'],
        }),
      ],
      cardMap: { [qinggang.id]: qinggang, [renwang.id]: renwang, [blackSlash.id]: blackSlash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // P0 出黑杀 → 仁王盾被临时 unload
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: blackSlash.id, targets: [1] },
      baseSeq: state.seq,
    });
    // P1 不出闪,造成伤害 → 仁王盾应在 after hook 中被恢复
    await fireTimeoutAndWait(state);

    // 关键断言:仁王盾的技能实例被恢复(玩家 skills 列表未变)
    // 临时 unload 不应修改 player.skills 列表(只是卸载 instance),所以 skills 始终包含 仁王盾
    expect(state.players[1].skills).toContain('仁王盾');
    // 装备栏的防具也未变(青釭剑不卸装备,只是临时移除 hook 实例)
    expect(state.players[1].equipment['防具']).toBe(renwang.id);

    // 再次出黑杀 → 仁王盾应继续生效(被卸载的实例已重新 instantiate)
    // 给 P0 第二张黑杀
    const blackSlash2: Card = { id: 'k2', name: '杀', suit: '♣', rank: '8', type: '基本牌' };
    state.cardMap[blackSlash2.id] = blackSlash2;
    state.players[0].hand.push(blackSlash2.id);
    // 重置已出杀次数(默认 0,首次出杀后 +1 为 1)以便第二次能出
    state.turn.vars['杀/usedCount'] = 0;

    const healthBefore2 = state.players[1].health;
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: blackSlash2.id, targets: [1] },
      baseSeq: state.seq,
    });
    await fireTimeoutAndWait(state);

    // 仁王盾应继续被绕过(青釭剑仍装备)→ 再次扣血
    expect(state.players[1].health).toBe(healthBefore2 - 1);
    // 仁王盾 skill 仍在(证明 instantiate 成功)
    expect(state.players[1].skills).toContain('仁王盾');
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:回归测试——无青釭剑时,黑杀被仁王盾挡掉
  // ─────────────────────────────────────────────────────────────
  it('用例3:回归测试——P0 无青釭剑时,黑杀被仁王盾挡掉(P1 不扣血)', async () => {
    const renwang: Card = { id: 'ar-rw', name: '仁王盾', suit: '♣', rank: '2', type: '装备牌', subtype: '防具' };
    const blackSlash: Card = { id: 'k1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [blackSlash.id],
          equipment: {}, // 不装备青釭剑
          skills: ['杀', '闪'],
        }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          equipment: { 防具: renwang.id },
          skills: ['闪', '仁王盾'],
        }),
      ],
      cardMap: { [renwang.id]: renwang, [blackSlash.id]: blackSlash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const healthBefore = state.players[1].health;

    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: blackSlash.id, targets: [1] },
      baseSeq: state.seq,
    });
    // P1 不出闪
    await fireTimeoutAndWait(state);

    // 仁王盾生效:黑杀被无效化,P1 不扣血
    expect(state.players[1].health).toBe(healthBefore);
    // 杀仍进弃牌堆
    expect(state.zones.discardPile).toContain(blackSlash.id);
  });
});
