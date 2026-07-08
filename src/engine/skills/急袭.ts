// 急袭(邓艾·转化技,由"凿险"觉醒获得):你可以将一张"田"当【顺手牵羊】使用。
//
// 模型(组合 action):preceding=[急袭.transform] + 主 action=顺手牵羊.use。
//   急袭.transform:选一张田 → 去标记(移除田) → 创建影子"顺手牵羊"入对手牌 → 更新距离修正
//   顺手牵羊.use:读手牌中的影子卡(name=顺手牵羊),正常流程执行
//
// 与武圣/倾国的区别:
//   - 武圣/倾国:手牌 → 影子卡(用「当作」atom)
//   - 急袭:田(mark) → 影子卡(不能用「当作」,因为田不在手牌)
//     直接 mutate cardMap 创建影子卡 + push 手牌,通过「去标记」atom 移除田。
//
// 田的存储(mark.payload.cardId = 判定牌 id):
//   急袭消耗田后,影子卡的 shadowOf 指向判定牌 cardId。
//   影子卡入弃牌堆时,引擎用 shadowOf 还原为原卡(判定牌),进入弃牌堆。
//
// 关键点:
//   - 田减少 → 距离修正 vars 更新(每张田 -1 距离)
//   - rollback 恢复田标记 + 距离修正 + 删影子卡
//   - 顺手牵羊的距离检查在 use.validate 中:此时田已消耗、距离修正已更新,
//     若距离变远导致 use validate 失败,rollback 恢复一切(安全)
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction } from '../skill';

const TIAN_PREFIX = '屯田/田:';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '急袭',
    description: '将一张"田"当【顺手牵羊】使用',
  };
}

/** 数当前玩家的田数量 */
function tianCount(state: GameState, player: number): number {
  return state.players[player].marks.filter((m) => m.id.startsWith(TIAN_PREFIX)).length;
}

/** 重新计算并写入距离修正 vars(每张田 = -1 距离 = 进攻修正 +1) */
function syncDistanceMod(state: GameState, player: number): void {
  const count = tianCount(state, player);
  if (count > 0) {
    state.players[player].vars['距离/进攻修正'] = count;
  } else {
    delete state.players[player].vars['距离/进攻修正'];
  }
}

/** 影子卡 id:${田markId}#急袭 */
function shadowIdOf(markId: string): string {
  return `${markId}#急袭`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── transform action:田 → 影子顺手牵羊(作为 preceding) ───
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (st: GameState, params: Record<string, Json>): string | null => {
      // 自己回合 + 出牌阶段 + 无阻塞 pending
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';

      // 选定的田 markId
      const markId = params.markId as string;
      if (typeof markId !== 'string') return '需要选择一张田';

      // 该 mark 存在且是田
      const mark = self.marks.find((m) => m.id === markId);
      if (!mark?.id.startsWith(TIAN_PREFIX)) return '指定的田不存在';
      const payload = mark.payload as { cardId?: string } | undefined;
      if (!payload?.cardId) return '田缺少卡牌信息';

      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const markId = params.markId as string;
      const self = st.players[ownerId];
      const mark = self.marks.find((m) => m.id === markId);
      if (!mark) return;

      const payload = mark.payload as { cardId?: string } | undefined;
      const tianCardId = payload?.cardId;
      const origCard = tianCardId ? st.cardMap[tianCardId] : undefined;
      const shadowId = shadowIdOf(markId);

      // 1. 去标记:移除田(走 atom 管线,产生 ViewEvent)
      await applyAtom(st, { type: '去标记', player: ownerId, markId });

      // 2. 创建影子卡(直接 mutate:田不在手牌,不能用「当作」atom)
      const shadow: Card = {
        id: shadowId,
        name: '顺手牵羊',
        suit: origCard?.suit ?? '',
        color: origCard?.color ?? '无色',
        rank: origCard?.rank ?? 'A',
        type: '锦囊牌',
        trickSubtype: '普通锦囊',
        shadowOf: tianCardId,
      };
      st.cardMap[shadowId] = shadow;
      self.hand.push(shadowId);

      // 3. 更新距离修正(田减少)
      syncDistanceMod(st, ownerId);
    },
    // rollback:主 action validate 失败时,撤销转化
    (st: GameState, params: Record<string, Json>): void => {
      const markId = params.markId as string;
      const shadowId = shadowIdOf(markId);
      const self = st.players[ownerId];

      // 先从影子卡获取原始 cardId(删除前)
      const shadow = st.cardMap[shadowId];
      const tianCardId = shadow?.shadowOf;

      // 删影子卡 + 手牌还原
      delete st.cardMap[shadowId];
      self.hand = self.hand.filter((id) => id !== shadowId);

      // 恢复田标记(直接加回 marks,不走 atom)
      self.marks.push({
        id: markId,
        scope: ownerId,
        payload: { cardId: tianCardId ?? '' },
      });

      // 更新距离修正(田恢复)
      syncDistanceMod(st, ownerId);
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('transform', {
    label: '急袭',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '急袭:选择一张田当顺手牵羊使用',
      // 田的选择通过 marks 渲染(cardFilter 不直接适用,前端 UI 需特殊处理)
      cardFilter: { min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: () => true, // 后端 validate 已校验距离;前端用 activeWhen 控制
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 有田才能发动
      const hasTian = (p.marks ?? []).some((m) => m.id.startsWith(TIAN_PREFIX));
      return hasTian;
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
