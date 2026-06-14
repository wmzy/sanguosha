// src/engine/skills/借刀杀人.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   借刀杀人(普通锦囊):
//     - 使用条件:出牌阶段使用
//     - 目标限制:装备区有武器牌的 1 名其他角色(A)
//     - 效果/流程:
//       1) 你指定目标角色 A(需有武器)
//       2) 你指定 A 使用【杀】攻击其攻击范围内的另一名角色 B(你指定 B)
//       3) A 必须选择一项:
//          - 对 B 使用 1 张【杀】(**无视距离限制**)
//          - 不执行杀则**武器归你所有**
//     - 备注:可以被【无懈可击】抵消
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) →
//     请求回应(target 是否出杀, 15s) →
//     若未回应: 卸下(target 武器) + 获得(weaponId from target) →
//     移动牌(处理区→弃牌堆) → popFrame
//
// 关键时机:
//   - 目标必须装备了武器
//
// 已知问题/不完整实现:
//   1. **未限制目标必须装武器**:validate 不检查 target.equipment.武器,
//      理论上对无武器角色使用,目标不出杀时"获得武器" silent skip,效果空——
//      违反规则的"目标必须装备武器才能使用"限定。
//   2. **杀目标未传入"借刀杀人"的 killTarget 参数**:规则中借刀有两个目标——
//      被借者(本 target)和被杀者(killTarget),但本文件没传 killTarget,
//      `请求回应`prompt 只是 confirm 是否出杀,没让玩家选杀谁——
//      若目标真出杀,杀的目标是谁完全没定义!
//   3. **不验证 killTarget 在 target 攻击范围内**:借刀的核心约束之一,完全缺失。
//   4. **__借刀杀回应 标记反模式**:同其他文件 __ 私有字段反模式。
//   5. **目标"出杀"未联动 杀.ts**:即使 target 同意出杀,本文件没调用任何
//      "代为出杀"的逻辑(如指定目标 + 询问闪 + 造成伤害),实际是空 act,严重 bug。
//   6. **无懈可击未支持**。
//   7. validate 未检查 target!==from(允许借自己,违反规则)、cardId 在手牌中。
//   8. 卸下武器后,武器在 target.hand 中(根据 卸下 atom 实际行为),
//      然后"获得"应从 target 处取——但此时已不是装备,from 字段语义可能错。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '借刀杀人', description: '锦囊:获得目标武器,或令目标出杀' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'string') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as string;
      const frame = pushFrame(state, '借刀杀人', from, { ...params });
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // ─── Promise-based 续跑 ───
      // 请求回应挂起,等目标出杀或超时
      await applyAtom(state, {
        type: '请求回应',
        requestType: '借刀杀人/forceKill',
        target,
        prompt: { type: 'confirm', title: '借刀杀人:是否对指定角色出杀?', confirmLabel: '出杀', cancelLabel: '不出(失武器)' },
        defaultChoice: false,
        timeout: 15000,
      });
      // 回应到达后读结果
      const killed = frame.params.__借刀杀回应 as boolean | undefined;
      if (!killed) {
        // 不出杀:获得目标的武器
        const targetPlayer = state.players.find(p => p.name === target);
        const weaponId = targetPlayer?.equipment?.['武器'];
        if (weaponId) {
          await applyAtom(state, { type: '卸下', player: target, slot: '武器' });
          await applyAtom(state, { type: '获得', player: from, cardId: weaponId, from: target });
        }
      }
      // 移牌到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
