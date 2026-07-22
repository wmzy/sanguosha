// 打出牌：统一的卡牌打出入口技能。
//
// 对齐文档 play.md 打出事件的结算流程：
//   1. 声明打出时（时机1，转化技 before-hook 可替换）
//   2. 置入处理区（移动牌 atom：手牌→处理区）
//   3. 打出牌时（时机2，雷击/涯角/银月枪 after-hook）
//
// 打出（play）与使用（use）的区别：
//   打出没有目标选择、没有效果结算——仅声明一张牌并置入处理区供调用方检查。
//   闪对万箭齐发是"打出"；杀对南蛮入侵/决斗是"打出"。
//
// 注意：打出牌不需要 pushFrame/popFrame——因为打出不涉及结算循环。
// 打出牌的调用方（如询问闪/询问杀 atom 的 pending slot resolver）会创建自己的帧。
// runPlayFlow 只负责声明+置入处理区+触发打出时机。
//
// 与使用牌（use-card）并存：使用牌走 runUseFlow 编排完整目标结算，打出牌仅声明+置入。

import type { FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '打出牌',
    description: '统一的卡牌打出入口',
  };
}

/**
 * runPlayFlow：编排打出事件的结算流程（文档 play.md）。
 *
 * 三步原子：
 *   1. 声明打出时（转化技 before-hook 可替换牌）
 *   2. 置入处理区（移动牌：手牌→处理区）
 *   3. 打出牌时（雷击/涯角/银月枪 after-hook）
 *
 * 不含帧管理：打出不涉及结算循环，调用方负责自己的帧。
 *
 * @param state   游戏状态
 * @param player  打出者
 * @param cardId  实体牌 id（须在手牌中）
 */
export async function runPlayFlow(
  state: GameState,
  player: number,
  cardId: string,
): Promise<void> {
  // 时机1：声明打出时（转化技 before-hook 可替换）
  await applyAtom(state, { type: '声明打出时', player, cardId });

  // 置入处理区
  await applyAtom(state, {
    type: '移动牌',
    cardId,
    from: { zone: '手牌', player },
    to: { zone: '处理区' },
  });

  // 时机2：打出牌时（雷击/涯角/银月枪 after-hook）
  await applyAtom(state, { type: '打出牌时', player, cardId });
}

/** 注册 respond action：validate 检查 pending slot 与手牌，execute 调 runPlayFlow。 */
export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  return registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self?.hand.includes(cardId)) return '牌不在手牌中';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      await runPlayFlow(state, ownerId, cardId);
    },
  );
}

/** 打出牌的 UI 由前端按 pending prompt 渲染。本阶段为空。 */
export function onMount(_skill: Skill, _api: FrontendAPI): void {}

export default { createSkill, onInit, onMount } satisfies SkillModule;
