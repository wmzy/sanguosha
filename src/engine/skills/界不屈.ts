// 界不屈(界周泰·锁定技,OL hero/210 官方逐字):
//   "当你处于濒死状态时,你将牌堆顶的一张牌置于你的武将牌上,称为'创',
//    若此牌点数与其他'创'均不同,你回复至1点体力,否则移去此牌。
//    若你的武将牌上有'创',你的手牌上限为'创'的数量。"
//
// 仅流程①(濒死置创+回复1体力),无回合结束弃创(旧实现的"流程②"是凭空捏造,已删除)。
//
// 与标 不屈 的差异(必读):
//   - 两版濒死置创+回复至1体力逐字相同(共享 registerBuquDyingHook,定义于 不屈.ts);
//     界版差异仅手牌上限规则。
//   - 标版:无手牌上限规则;界版:有创牌时手牌上限=创牌数量。
//   - 二者共用 置创牌 atom(重复时移去此牌——对两版本语义一致)。
//
// 分析(步骤1):
//   类型:锁定技 | 时机:陷入濒死 after-hook
//   流程①(濒死,target===ownerId):
//     1. 置创牌{player=自己} —— 牌堆顶翻一张:不重复则置于武将牌,重复则移去(进弃牌堆)
//     2. 读 localVars['不屈/重复']:
//        - 不重复 → 回复体力{target=自己, amount=max(0,1-health)} 回复至1体力
//                   + 设 localVars['不屈/存活']=ownerId(runDyingFlow 据此跳过求桃+击杀)
//        - 重复   → 不设存活标记,runDyingFlow 继续求桃流程;无人救则击杀
//
//   手牌上限规则(锁定,随技能实例常驻):
//     - player.vars['不屈/创牌'] 非空 → 手牌上限 = 创牌数量
//     - 创牌列表为空 → 不覆盖(走默认公式 health+bonus)
//
//   钩子:registerBuquDyingHook(state, skill.id, ownerId)——与标版共享,定义于 不屈.ts
//
//   契约清单(跨 atom 通信):
//     | localVars['不屈/存活']   | 写 | 系统规则.ts runDyingFlow(读) | ✅ 已实现 |
//     | localVars['不屈/重复']   | 读 | 置创牌 atom(写)              | ✅ 已实现 |
//     | player.vars['不屈/创牌'] | 读 | 置创牌 atom(写)              | ✅ 已实现 |
import type { GameState, Skill, SkillModule } from '../types';
import { registerHandLimitProvider } from '../rules/hand-limit';
import { registerBuquDyingHook, WOUND_KEY } from './不屈';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界不屈',
    description: '锁定技:濒死时翻牌堆顶作"创"牌置于武将牌上,点数与已有创均不同则回复至1体力,相同则移去此牌;武将牌上有"创"时手牌上限为"创"的数量',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 陷入濒死 after-hook:与标版逐字相同,共享 registerBuquDyingHook(定义于 不屈.ts) ──
  const unloadHook = registerBuquDyingHook(state, skill.id, ownerId);

  // ── 手牌上限覆盖提供者:有创牌时手牌上限=创牌数量 ──
  // 永久常驻:随技能实例注册/卸载(走 setSkillInstanceUnload 统一清理)。
  // 创牌列表为空时不覆盖,回退到默认公式(health+bonus)。
  const unloadProvider = registerHandLimitProvider(state, ownerId, (st, player) => {
    if (player !== ownerId) return undefined;
    const list = (st.players[player]?.vars[WOUND_KEY] as string[] | undefined) ?? [];
    return list.length > 0 ? list.length : undefined;
  });

  return () => {
    unloadHook();
    unloadProvider();
  };
}

export default { createSkill, onInit } satisfies SkillModule;
