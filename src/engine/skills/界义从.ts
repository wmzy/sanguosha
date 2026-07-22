// 界义从(界公孙瓒·锁定技,OL 界限突破官方逐字):
//   锁定技,你计算与其他角色的距离-1;若你的体力值不大于2,
//   其他角色计算与你的距离+1。
//
// 与标版(src/engine/skills/义从.ts)对比:标版未实现;界版与标版官方描述完全一致。
// 任务要求:每个技能创建 界<技能名>.ts 文件,故独立创建。
//
// 实现机制(与马术/马匹技能·防御马一致,通过 player.vars 距离修正):
//   - 常驻:vars['距离/进攻修正'] = 1(你与其他角色距离-1,任何时候生效)
//   - 条件:vars['距离/防御修正'] = 1(其他角色与你距离+1,仅体力≤2 时生效)
//
// 关键点(防御修正的体力条件 + view 同步):
//   防御修正随体力变化,需在体力变更后重新同步。挂 after hook 监听三类体力变更 atom:
//     造成伤害 / 回复体力 / 失去体力
//   只要 target 是自己,就重新计算防御修正(体力≤2 → 设 1;否则清除)。
//   进攻修正不受体力影响,onInit 设置一次即可。
//
// view 同步机制(关键):
//   进攻/防御修正属于"动态变化的距离修正"。view 侧 distanceVars 通过特定 atom 的
//   toViewEvents 同步——本技能通过 加标记/去标记 携带 distanceVars 字段同步防御修正。
//   加标记 = 激活(添加 义从/低血 mark + distanceVars.defenseMod=1)
//   去标记 = 关闭(移除 mark + distanceVars.defenseMod=undefined)
//   mark `义从/低血` 同时充当 UI 可见的"低血防御激活"指示。
//
// 已知限制(沿用引擎既有约定,与马术+进攻马、屯田+进攻马 同构):
//   vars['距离/防御修正'] 是单一 number 槽位,不累加。若同时拥有 义从 + 防御马,
//   两者写入同一 key,后写覆盖前写。这是 engine 距离修正的既有约定,本技能不单独解决。
import type { Skill, GameState } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

const ATTACK_KEY = '距离/进攻修正';
const DEFENSE_KEY = '距离/防御修正';
/** 体力阈值:≤此值时启动防御修正 */
const LOW_HEALTH_THRESHOLD = 2;
/** UI 可见的"义从低血防御"标记;同时用作 view 同步的 bookend */
const LOW_HEALTH_MARK_ID = '义从/低血';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '义从',
    description: '锁定技:你计算与其他角色的距离-1;若你的体力值不大于2,其他角色计算与你的距离+1',
    isLocked: true,
  };
}

/** 根据当前体力,在 state 上同步防御修正 vars + mark + view。
 *  必须在 after hook 中调用(走 atom 管线以同步 view)。 */
async function syncDefenseMod(state: GameState, ownerId: number): Promise<void> {
  const me = state.players[ownerId];
  if (!me) return;
  const shouldActive =
    me.alive && me.health > 0 && me.health <= LOW_HEALTH_THRESHOLD;
  const has = me.marks.some((m) => m.id === LOW_HEALTH_MARK_ID);

  if (shouldActive && !has) {
    // 激活:设 vars + 加 mark + view 同步
    me.vars[DEFENSE_KEY] = 1;
    await applyAtom(state, {
      type: '加标记',
      player: ownerId,
      mark: { id: LOW_HEALTH_MARK_ID, scope: ownerId, payload: {} },
      distanceVars: { defenseMod: 1 },
    });
  } else if (!shouldActive && has) {
    // 关闭:删 vars + 去 mark + view 同步
    delete me.vars[DEFENSE_KEY];
    await applyAtom(state, {
      type: '去标记',
      player: ownerId,
      markId: LOW_HEALTH_MARK_ID,
      distanceVars: { defenseMod: undefined },
    });
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // 进攻修正:常驻 +1(你与其他角色距离-1)
  state.players[ownerId].vars[ATTACK_KEY] = 1;
  // 防御修正:基于初始体力同步(开局可能已是低血;初始 view 由 buildView 权威投影,
  //   无需走 atom view 同步)
  const me = state.players[ownerId];
  if (me.alive && me.health > 0 && me.health <= LOW_HEALTH_THRESHOLD) {
    me.vars[DEFENSE_KEY] = 1;
    // 初始 mark 直接 mutate(registerSkillsFromState 在首帧 buildView 前完成)
    me.marks.push({ id: LOW_HEALTH_MARK_ID, scope: ownerId, payload: {} });
  }

  // 体力变化 after hook:重新同步防御修正(走 atom 同步 view)
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target === ownerId) await syncDefenseMod(ctx.state, ownerId);
  });
  registerAfterHook(state, skill.id, ownerId, '回复体力', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target === ownerId) await syncDefenseMod(ctx.state, ownerId);
  });
  registerAfterHook(state, skill.id, ownerId, '失去体力', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target === ownerId) await syncDefenseMod(ctx.state, ownerId);
  });

  // 卸载时清除两个修正 + mark(直接 mutate,无 view 同步——技能已卸载,view 重建)
  return () => {
    delete state.players[ownerId]?.vars[ATTACK_KEY];
    delete state.players[ownerId]?.vars[DEFENSE_KEY];
    const me = state.players[ownerId];
    if (me) {
      me.marks = me.marks.filter((m) => m.id !== LOW_HEALTH_MARK_ID);
    }
  };
}

export function onMount(_skill: Skill, _api: unknown): void {
  // 锁定技:无主动 action
  return;
}

const _skillModule: import('../types').SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
