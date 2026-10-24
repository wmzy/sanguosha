// tests/engine/turnUsage-reconnect.test.ts
// 契约:回合内 view 投影键(双雄/界双雄 的颜色、审时/成略/拒战 的转换态、界当先 的
// 额外出牌阶段标记)经「回合用量」atom 写入后,重连/初始视图(buildView)必须重建
// 该键 —— 否则重连后 双雄/界双雄 转化按钮消失、界当先 额外阶段无法主动结束、
// 审时/成略/拒战 的「阴」态门控丢失(前端 activeWhen 读不到 turnUsage)。
//
// 机制:「回合用量」atom 的 apply 把镜像值写进 turn.vars['__view/<player>/<key>']；buildView按玩家归属重建。
import { describe, it, expect } from 'vitest';
import { buildView } from '../../src/engine/index';
import { applyAtom } from '../../src/engine/core/apply';
import { createGameState } from '../../src/engine/types';
import { markOncePerTurn, usedThisTurn } from '../../src/engine/rules/once-per-turn';
import { incSlashUsed, slashUsed } from '../../src/engine/rules/slash-quota';
import { getAtomDef } from '../../src/engine/core/atom';
import { registerBeforeHook } from '../../src/engine/core/skill';
import type { GameState, Json, PlayerState } from '../../src/engine/types';
import {
  SHUANGXIONG_COLOR_VIEW_KEY,
  JIESHUANGXIONG_COLOR_VIEW_KEY,
  SHENSHI_STATE_VIEW_KEY,
  CHENGLUE_STATE_VIEW_KEY,
  DANGXIAN_EXTRA_PHASE_VIEW_KEY,
  JUZHAN_STATE_VIEW_KEY,
  viewMirrorKey,
} from '../../src/engine/rules/vars-keys';
import '../../src/engine/atoms';

function mkPlayer(index: number, name: string): PlayerState {
  return {
    index,
    name,
    character: name,
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

function mkState(): GameState {
  return createGameState({
    players: [mkPlayer(0, 'P0'), mkPlayer(1, 'P1')],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('回合用量统一写入', () => {
  it('限一次标记在首个 await 前阻止重入,并立即可重建', async () => {
    const state = mkState();
    const incremental = buildView(state, 0);
    let release!: () => void;
    registerBeforeHook(state, '延迟用量', 0, '回合用量', async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { kind: 'pass' };
    });

    const pending = markOncePerTurn(state, 1, '制霸');
    expect(usedThisTurn(state, 1, '制霸')).toBe(true);
    expect(usedThisTurn(state, 0, '制霸')).toBe(false);
    expect(buildView(state, 0).players[1].turnUsage?.['制霸/usedThisTurn']).toBe(true);
    release();
    await pending;
    for (const event of state.atomHistory) {
      if (event.kind !== 'atom') continue;
      const viewEvent = event.viewEvents?.othersView;
      if (viewEvent) getAtomDef(event.atom.type).applyView?.(incremental, viewEvent);
    }
    expect(incremental.players.map((p) => p.turnUsage)).toEqual(buildView(state, 0).players.map((p) => p.turnUsage));

    await applyAtom(state, { type: '回合结束', player: 0 });
    expect(usedThisTurn(state, 1, '制霸')).toBe(false);
    expect(buildView(state, 0).players[1].turnUsage).toEqual({});
  });

  it('出杀计数只有一个入口,不串到当前回合玩家且回合结束清空', async () => {
    const state = mkState();
    const first = incSlashUsed(state, 1);
    expect(slashUsed(state, 1)).toBe(1);
    expect(slashUsed(state, 0)).toBe(0);
    expect(buildView(state, 0).players[1].turnUsage?.['杀/usedCount']).toBe(1);
    await first;
    await incSlashUsed(state, 1);
    await incSlashUsed(state, 0);
    expect(slashUsed(state, 1)).toBe(2);
    expect(slashUsed(state, 0)).toBe(1);
    expect(buildView(state, 0).players.map((p) => p.turnUsage?.['杀/usedCount'])).toEqual([1, 2]);

    await applyAtom(state, { type: '回合结束', player: 0 });
    expect(slashUsed(state, 1)).toBe(0);
    expect(slashUsed(state, 0)).toBe(0);
    expect(buildView(state, 0).players.map((p) => p.turnUsage)).toEqual([{}, {}]);
  });
});

describe('回合内 view 键重连重建(双雄/界双雄/审时/成略/界当先)', () => {
  const cases: ReadonlyArray<{ key: string; value: Json; desc: string }> = [
    { key: SHUANGXIONG_COLOR_VIEW_KEY, value: '红', desc: '双雄拼点判定牌颜色' },
    { key: JIESHUANGXIONG_COLOR_VIEW_KEY, value: '黑', desc: '界双雄弃置牌颜色' },
    { key: SHENSHI_STATE_VIEW_KEY, value: '阴', desc: '审时转换态' },
    { key: CHENGLUE_STATE_VIEW_KEY, value: '阴', desc: '成略转换态' },
    { key: DANGXIAN_EXTRA_PHASE_VIEW_KEY, value: true, desc: '界当先额外出牌阶段' },
    { key: JUZHAN_STATE_VIEW_KEY, value: '阴', desc: '拒战转换态' },
  ];

  for (const { key, value, desc } of cases) {
    it(`${desc}:回合用量写入 ${key} → buildView 重建 turnUsage(重连路径)`, async () => {
      const state = mkState();
      await applyAtom(state, { type: '回合用量', player: 0, key, value });

      // 镜像已落 turn.vars(缺失 = 键未注册进 TURN_SCOPED_VIEW_KEYS,重连必丢)
      expect(state.turn.vars[viewMirrorKey(0, key)]).toBe(value);

      // 当前回合玩家:重连/初始视图重建该键(前端 activeWhen 据此恢复按钮/门控)
      const view = buildView(state, 0);
      expect(view.players[0].turnUsage?.[key]).toBe(value);

      // 归属规则:__view 镜像只投影给当前回合玩家,非当前回合玩家不携带
      expect(view.players[1].turnUsage?.[key]).toBeUndefined();
    });
  }
});
