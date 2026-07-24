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
import type { GameState } from './types';
import { applyAtom } from './create-engine';

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
