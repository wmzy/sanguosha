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
import { getAllCardEffects } from './registry';
import { runUseFlow } from './use-card';

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

/** 注册 respond action：逐卡名注册（skillId=卡名），路由到 CardEffect.respond。
 *  有 respond 字段的卡牌（闪/桃/酒/无懈可击 等）按卡名注册 respond action。
 *  无 respond 字段的牌（如杀）不注册 respond——南蛮/决斗 的杀由 询问杀 atom
 *  的默认 resolver 处理。
 *
 *  effect kind（闪/无懈）：respond execute 走 runUseFlow（与普通牌一致）。
 *  牌移动（手牌→处理区→弃牌堆）由 runUseFlow 内部完成。
 *  resolve 中设下层帧（被抵消牌的帧）cancelled=true。
 *  其他 kind：按原样走 effect.respond.execute。 */
export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const unloads: Array<() => void> = [];

  for (const [cardName, effect] of getAllCardEffects()) {
    if (!effect.respond) continue;
    if (effect.target.kind === 'effect') {
      // effect kind（闪/无懈）：走 runUseFlow + 询问抵消标记 RESPONDED_KEY
      const u = registerAction(
        state,
        cardName,
        ownerId,
        'respond',
        (s: GameState, p: Record<string, Json>) => effect.respond!.validate(s, ownerId, p),
        async (s: GameState, p: Record<string, Json>) => {
          const cardId = p.cardId as string;
          // 无 cardId = 玩家选择不回应（pass），不触发 runUseFlow；
          // pending slot 由 dispatch resolve，询问抵消 循环检测 RESPONDED_KEY=false → 退出
          if (!cardId) return;
          // 标记本次询问已 respond（询问抵消 循环据此决定是否开新窗口）
          s.localVars['抵消/已回应'] = true;
          await runUseFlow(s, ownerId, cardId, [ownerId], cardName);
        },
      );
      if (u) unloads.push(u);
    } else {
      const u = registerAction(
        state,
        cardName,
        ownerId,
        'respond',
        (s: GameState, p: Record<string, Json>) => effect.respond!.validate(s, ownerId, p),
        (s: GameState, p: Record<string, Json>) => effect.respond!.execute(s, ownerId, p),
      );
      if (u) unloads.push(u);
    }
  }

  return () => unloads.forEach((u) => u());
}

/** 打出牌的 UI：按卡名注册 respond action 的 UI 配置（从 CardEffect.respond 驱动）。
 *  有 respond 字段的牌（闪/桃/酒/无懈可击 等）注册一个 respond action。
 *  skillIdOverride=卡名（与 onInit 按卡名注册的 engine action 对齐）。 */
export function onMount(_skill: Skill, api: FrontendAPI): void {
  for (const [cardName, effect] of getAllCardEffects()) {
    if (!effect.respond) continue;
    api.defineAction(
      'respond',
      {
        label: effect.label,
        style: effect.style,
        prompt: effect.respondPrompt ?? effect.prompt,
      },
      cardName,
    );
  }
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
