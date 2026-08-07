// src/engine/face-down.ts
// 翻面 / 跳过整回合 / 横置 公共 helper（模块 N：翻面/额外回合公共化 + 模块 E：状态变更时机）。
//
// 抽取原本在 放逐/悲歌/界仁心/界伏枥/界据守 等技能中重复复刻的翻面逻辑：
//   - 翻面     = 加 `${source}/翻面` 标签（下一回合准备阶段开始时被消费 → 跳过整回合）
//   - 翻回正面 = 去该标签
//   - 跳过整回合 = 清过期标记 → 下一玩家 → 回合结束（与 回合管理.end 尾段一致）
//
// 状态变更时机（模块 E）：实质操作后补发标记型 atom，提供统一的 hook 注册点：
//   - flipFaceDown/flipFaceUp 在 加标签/去标签 后补发「翻面后」(faceDown=true/false)
//   - setChain 在 设横置 后补发「横置后」(设横置 被 before-hook cancel 时不补发)
//
// 连环状态（横置的语义层）：CHAIN_MARK/isChained 是横置状态的查询面，
//   registerChainConductionHook 是「连环状态 × 属性伤害」的传导行为——两者都与铁索连环牌
//   解耦：任何途径置入连环状态（铁索连环牌、武将技能调 setChain）都受传导管辖。
import type { GameState } from './types';
import { TARGET_SYSTEM } from './types';
import { applyAtom } from './index';
import { runDamageFlow } from './damage-flow';
import { registerAfterHook } from './skill';

/** 连环（横置）状态的 mark id。 */
export const CHAIN_MARK = 'chained';

/** 传导防重入标记：传导过程中为 true，避免传导伤害递归触发本 hook。 */
const CONDUCTING_VAR = '铁索连环/传导中';

/** 翻面（翻成背面朝上）：加 `${source}/翻面` 标签 + 发「翻面后」时机标记。
 *  source 为技能名前缀（如 '放逐'、'悲歌'），与各技能既有的标签常量前缀一致。 */
export async function flipFaceDown(
  state: GameState,
  player: number,
  source: string,
): Promise<void> {
  await applyAtom(state, { type: '加标签', player, tag: `${source}/翻面` });
  await applyAtom(state, { type: '翻面后', player, faceDown: true });
}

/** 翻回正面：去 `${source}/翻面` 标签 + 发「翻面后」时机标记。 */
export async function flipFaceUp(
  state: GameState,
  player: number,
  source: string,
): Promise<void> {
  await applyAtom(state, { type: '去标签', player, tag: `${source}/翻面` });
  await applyAtom(state, { type: '翻面后', player, faceDown: false });
}

/** 设置横置状态（模块 E 横置时机编排）：设横置 后补发「横置后」时机标记。
 *  返回 设横置 是否实际生效（被 before-hook cancel 时返回 false 且不补发 横置后）。 */
export async function setChain(
  state: GameState,
  player: number,
  chained: boolean,
): Promise<boolean> {
  const applied = await applyAtom(state, { type: '设横置', player, chained });
  if (!applied) return false;
  await applyAtom(state, { type: '横置后', player, chained });
  return true;
}

/** 检查 player 是否处于连环（横置）状态。 */
export function isChained(state: GameState, idx: number): boolean {
  return state.players[idx]?.marks.some((m) => m.id === CHAIN_MARK) ?? false;
}

/** 注册连环传导全局 after-hook：属性伤害结算结束后，从受伤害的连环角色起，
 *  将同等同属性伤害传导给其他所有连环角色，随后重置所有因此传导的连环状态。
 *
 *  这是「连环状态 × 属性伤害」的联动行为，与铁索连环牌解耦：置入连环状态的途径
 *  不限于铁索连环牌（武将技能可直接调 setChain）。原驻 skills/铁索连环.ts，
 *  现作为伤害结算基础设施由 index 的 bootstrap/registerSkillsFromState 注册。
 *  localVars[CONDUCTING_VAR] 防止传导伤害递归触发。 */
export function registerChainConductionHook(state: GameState): void {
  registerAfterHook(state, '铁索连环', TARGET_SYSTEM, '伤害结算结束后', async (ctx) => {
    const atom = ctx.atom;
    const dt = atom.damageType;
    if (dt !== '火焰' && dt !== '雷电') return;
    const target = atom.target;
    if (typeof target !== 'number') return;
    if (!isChained(ctx.state, target)) return;
    if (ctx.state.localVars[CONDUCTING_VAR]) return;

    ctx.state.localVars[CONDUCTING_VAR] = true;
    try {
      const amount = atom.amount ?? 1;
      const source = atom.source ?? TARGET_SYSTEM;
      // 传导给其他所有横置的存活角色(按座次)
      const others = ctx.state.players.filter(
        (p) => p.alive && p.index !== target && p.marks.some((m) => m.id === CHAIN_MARK),
      );
      for (const p of others) {
        if (!ctx.state.players[p.index]?.alive) continue; // 传导链中可能死亡
        await runDamageFlow(ctx.state, source, p.index, amount, undefined, dt);
      }
      // 重置所有处于连环状态的角色(含原始目标)
      const allChained = ctx.state.players.filter((p) =>
        p.marks.some((m) => m.id === CHAIN_MARK),
      );
      for (const p of allChained) {
        await setChain(ctx.state, p.index, false);
      }
    } finally {
      delete ctx.state.localVars[CONDUCTING_VAR];
    }
  });
}

/** 检查 player 武将牌是否处于翻面（背面朝上）状态：存在任意 `/翻面` 后缀标签。 */
export function isFaceDown(state: GameState, player: number): boolean {
  return state.players[player].tags.some((t) => t.endsWith('/翻面'));
}

/** 跳过整回合（翻面的系统效果）：清过期标记 → 下一玩家 → 回合结束。
 *  与 回合管理.end action 的尾段一致。调用方负责 cancel 触发它的 阶段结束 原子，
 *  以免 phase-end after-hook 推进产生幻影阶段链（沿用原内联实现的手法）。 */
export async function performSkipTurn(
  state: GameState,
  player: number,
): Promise<void> {
  await applyAtom(state, { type: '清过期标记', player });
  await applyAtom(state, { type: '下一玩家' });
  await applyAtom(state, { type: '回合结束', player });
}
