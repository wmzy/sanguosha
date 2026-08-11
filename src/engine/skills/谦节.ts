// 谦节(陆抗·吴·锁定技,风林火山 hero/414 官方逐字):
//   "锁定技,当你进入连环状态时,你防止之。你不能成为延时锦囊牌和其他角色拼点的目标。"
//
// 模式 D(锁定技 before-hook 拦截,与 谦逊/帷幕 同构):
//   ① 设横置 before-hook:target=自己 + chained=true → cancel(防止进入连环状态)
//   ② 添加延时锦囊 before-hook:player=自己 → cancel(免疫乐不思蜀/兵粮寸断/闪电)
//   ③ 请求回应 before-hook:target=自己 + requestType 以 '/拼点' 结尾 → cancel(不能成为拼点目标)
//   ④ 装备 before-hook:player=自己 + 目标槽已被决堰废除 → cancel(已废除的槽不能装装备)
//
// 谦节为永久锁定技(破势只移除决堰,不移除谦节),故④的装备废除钩子由谦节统一持有,
//   保证决堰被破势移除后已废除的槽仍然不可装备。
//
// 关于③拼点:取消"拼点选牌请求"(请求回应 requestType='X/拼点'),使陆抗不被询问。
//   发起方拼点技能(天义/驱虎/界巧说/界陷阵/烈刃)收到 targetCardId=undefined 后走
//   "目标未出牌"兜底分支——安全无副作用(不会卡死或复制卡牌),陆抗不参与拼点。
import type { HookResult, Skill, GameState } from '../types';
import { registerBeforeHook } from '../core/skill';
import { ABOLISH_PREFIX } from './决堰';
import type { SkillModule, EquipSlot } from '../types';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '谦节',
    description:
      '锁定技:当你进入连环状态时防止之;你不能成为延时锦囊牌和其他角色拼点的目标',
    isLocked: true,
  };
}

/** 从 card.subtype 推断装备槽位(镜像 装备.ts 的 inferSlot / 决堰.ts 的 inferEquipSlot) */
function inferEquipSlot(subtype: string | undefined): EquipSlot | null {
  switch (subtype) {
    case '武器':
    case '防具':
    case '进攻马':
    case '防御马':
    case '宝物':
      return subtype;
    default:
      return null;
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ① 防止进入连环状态
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '设横置',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      if (!atom.chained) return; // 仅阻止"进入"连环(chained=true);解除连环(chained=false)不拦
      return { kind: 'cancel' };
    },
  );

  // ② 免疫延时锦囊(乐不思蜀/兵粮寸断/闪电):拦截"添加延时锦囊"
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '添加延时锦囊',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      return { kind: 'cancel' };
    },
  );

  // ③ 不能成为拼点目标:拦截"拼点选牌请求"
  //    requestType 约定 '<技能>/拼点'(天义/驱虎/界巧说/界陷阵/烈刃),统一以 '/拼点' 结尾。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '请求回应',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      const rt = atom.requestType;
      if (typeof rt !== 'string' || !rt.endsWith('/拼点')) return;
      return { kind: 'cancel' };
    },
  );

  // ④ 已废除的装备槽不可装装备(由谦节统一持有,保证决堰被移除后仍生效)
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '装备',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      const card = ctx.state.cardMap[atom.cardId];
      if (!card) return;
      const slot = inferEquipSlot(card.subtype);
      if (!slot) return;
      if (ctx.state.players[ownerId]?.vars[ABOLISH_PREFIX + slot]) {
        return { kind: 'cancel' };
      }
    },
  );

  return () => {};
}

export default { createSkill, onInit } satisfies SkillModule;
