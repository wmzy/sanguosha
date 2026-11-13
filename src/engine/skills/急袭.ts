// 急袭(邓艾·转化技,由"凿险"觉醒获得):你可以将一张"田"当【顺手牵羊】使用。
//
// 模型(组合 action):preceding=[急袭.transform] + 主 action=顺手牵羊.use。
//   急袭.transform:选一张田 → 去标记(移除田) → 创建影子"顺手牵羊"入对手牌 → 更新距离修正
//   顺手牵羊.use:读手牌中的影子卡(name=顺手牵羊),正常流程执行
//
// 与武圣/倾国族的区别(经 skillRuntime 工厂的自定义维度表达):
//   - 武圣/倾国:手牌 → 影子卡(用「当作」atom)
//   - 急袭:田(mark)→ 影子卡(不能用「当作」,因为田不在手牌)——validate/execute 全量自定义:
//     去标记 atom 移除田 + 直接 mutate cardMap 创建影子卡 push 手牌。
//     影子卡 id = `${markId}#急袭`(后缀 = 技能 id,工厂统一构造)。
//
// 田的存储(mark.payload.cardId = 判定牌 id):
//   急袭消耗田后,影子卡的 shadowOf 指向判定牌 cardId。
//   影子卡入弃牌堆时,引擎用 shadowOf 还原为原卡(判定牌),进入弃牌堆。
//
// 关键点:
//   - 田减少 → 距离修正 vars 更新(每张田 -1 距离),经 去标记 atom 的 distanceVars 通道
//   - rollback 只删影子卡:田标记/手牌/距离 vars 均由 dispatch 快照整体还原(core/rollback.ts)
//   - 顺手牵羊的距离检查在 use.validate 中:此时田已消耗、距离修正已更新,
//     若距离变远导致 use validate 失败,rollback + 快照恢复一切(安全)
import type { Card, FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { defaultPlayActive } from '../rules/action-active';
import {
  registerTransformAction,
  mountTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';
import { DISTANCE_ATTACK_MOD_KEY } from '../rules/vars-keys';

const TIAN_PREFIX = '屯田/田:';

/** 数当前玩家的田数量 */
function tianCount(state: GameState, player: number): number {
  return state.players[player].marks.filter((m) => m.id.startsWith(TIAN_PREFIX)).length;
}

/** 重新计算并写入距离修正 vars(每张田 = -1 距离 = 进攻修正 +1) */
function syncDistanceMod(state: GameState, player: number): void {
  const count = tianCount(state, player);
  if (count > 0) {
    state.players[player].vars[DISTANCE_ATTACK_MOD_KEY] = count;
  } else {
    delete state.players[player].vars[DISTANCE_ATTACK_MOD_KEY];
  }
}

const OPTIONS: TransformActionOptions = {
  outputName: '顺手牵羊',
  // 选牌参数是田的 markId(非手牌 cardId)
  paramKey: 'markId',
  // validate 全量自定义:急袭逐条件独立拒绝文案
  validate: (st, ownerId, params): string | null => {
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
  // execute 全量自定义:田不在手牌,不走「当作」
  execute: async (st, ownerId, params, shadowId): Promise<void> => {
    const markId = params.markId as string;
    const self = st.players[ownerId];
    const mark = self.marks.find((m) => m.id === markId);
    if (!mark) return;

    const payload = mark.payload as { cardId?: string } | undefined;
    const tianCardId = payload?.cardId;
    const origCard = tianCardId ? st.cardMap[tianCardId] : undefined;

    // 1. 去标记:移除田(走 atom 管线,产生 ViewEvent)+ 同步距离修正 view
    //    田减少 → 进攻修正 -1;必须经 distanceVars 通道同步 view(与屯田加田、
    //    界义从去标记对称)。否则 view.distanceVars.attackMod 停在旧值,前端距离
    //    显示/目标过滤(viewCanAttack)与后端 effectiveDistance 不一致。
    const newCount = tianCount(st, ownerId) - 1;
    await applyAtom(st, {
      type: '去标记',
      player: ownerId,
      markId,
      distanceVars: { attackMod: newCount > 0 ? newCount : undefined },
    });

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
  // rollback(工厂默认)只删影子卡:田标记/手牌/距离 vars 由 dispatch 快照整体还原。
  mount: {
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
    noTransform: true,
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 有田才能发动
      const hasTian = (p.marks ?? []).some((m) => m.id.startsWith(TIAN_PREFIX));
      return hasTian;
    },
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '急袭',
    description: '将一张"田"当【顺手牵羊】使用',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  // ─── transform action:田 → 影子顺手牵羊(作为 preceding) ───
  registerTransformAction(state, skill.id, skill.ownerId, OPTIONS);
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  mountTransformAction(api, skill.id, OPTIONS);
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
