// 使用牌：统一的卡牌使用入口技能。
//
// 对齐文档 use.md 使用事件的结算流程：
//   使用结算前（声明阶段，对所有目标逐时机处理）：
//     选择目标时 → 置入处理区 → 使用时
//     → 逐目标：指定目标
//   使用结算中（逐目标完整结算）：
//     成为目标 → 指定目标后 → 成为目标后 → 检测有效性 → [cardEffect.resolve]
//   使用结算后：
//     移出处理区
//
// 本技能注册 use action，validate 查 CardEffect 注册表做合法性检测，
// execute 调 runUseFlow 编排完整流程。
//
// 与现有卡牌技能并存：现有杀/决斗等仍各自注册 action。
// 迁移后，卡牌只需 registerCardEffect，不再注册 action。

import type { FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { applyAtom, frameCards, popFrame, pushFrame } from '../create-engine';
import { registerAction } from '../skill';
import { validateCardUse } from './validate';
import { getCardEffect, requireCardEffect } from './registry';
import type { ResolveCtx } from './registry';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '使用牌',
    description: '统一的卡牌使用入口',
  };
}

/**
 * runUseFlow：编排使用事件的完整结算流程（文档 use.md）。
 *
 * 整个流程包裹在 pushFrame / popFrame 中（popFrame 在 finally 块调用，异常安全）。
 * 目标列表从帧 params.resolvedTargets 读取（流离等技能可能修改），fallback 到传入 targets。
 *
 * @param state     游戏状态
 * @param source    使用者
 * @param cardId    实体牌 id（须在手牌中）
 * @param targets   目标列表
 * @param cardName  牌名（查 CardEffect 注册表）
 */
export async function runUseFlow(
  state: GameState,
  source: number,
  cardId: string,
  targets: number[],
  cardName: string,
): Promise<void> {
  const effect = requireCardEffect(cardName);

  // ── 使用结算前（声明阶段）──
  const frame = await pushFrame(state, cardName, source, {
    cardId,
    resolvedTargets: [...targets],
  });

  try {
    // 时机1：选择目标时（转化技 before-hook 可替换牌）
    await applyAtom(state, { type: '选择目标时', source, cardId, targets });

    // 置入处理区（手牌 → 处理区）
    await applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: source },
      to: { zone: '处理区' },
    });

    // 时机2：使用时（集智/强识 after-hook 摸牌）
    await applyAtom(state, { type: '使用时', source, cardId });

    // 声明阶段：逐目标 指定目标
    for (const target of targets) {
      await applyAtom(state, { type: '指定目标', source, target, cardId });
    }

    // ── 使用结算中：逐目标完整结算 ──
    for (let i = 0; i < targets.length; i++) {
      // 从帧上读当前目标（流离等技能可能修改 resolvedTargets）
      const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
      const target = resolved[i];
      if (!state.players[target]?.alive) continue;

      // 时机4：成为目标（空城/帷幕 before-hook 可 cancel → false = 跳过此目标）
      const becameTarget = await applyAtom(state, {
        type: '成为目标',
        source,
        target,
        cardId,
      });
      if (!becameTarget) continue;

      // 时机5：指定目标后（铁骑/烈弓/无双①/肉林① after-hook）
      await applyAtom(state, { type: '指定目标后', source, target, cardId });

      // 时机6：成为目标后（贞烈/啖酪/无双②/肉林② after-hook）
      await applyAtom(state, { type: '成为目标后', source, target, cardId });

      // 使用结算开始时：检测有效性（仁王盾/享乐 before-hook 可 cancel → false = 跳过）
      const valid = await applyAtom(state, {
        type: '检测有效性',
        source,
        target,
        cardId,
      });
      if (!valid) continue;

      // 生效前响应 + 生效后效果（cardEffect.resolve）
      const ctx: ResolveCtx = { state, source, target, cardId, targetIndex: i };
      await effect.resolve(ctx);
    }

    // ── 使用结算后：移出处理区 ──
    if (frameCards(state).includes(cardId)) {
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }

    // 牌特有结算后回调（popFrame 前）——杀的出杀次数累加等
    if (effect.onSettle) {
      await effect.onSettle(state, source, cardId);
    }
  } finally {
    // 异常安全：保证牌不滞留处理区 + 帧弹出
    if (frameCards(state).includes(cardId)) {
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }
    await popFrame(state);
  }
}

/** 注册 use action：validate 查 CardEffect 注册表，execute 调 runUseFlow。 */
export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  return registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const card = state.cardMap[cardId];
      if (!card) return '牌不存在';
      if (!getCardEffect(card.name)) return `${card.name} 尚未支持使用牌入口`;
      return validateCardUse(state, ownerId, params, card.name);
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const card = state.cardMap[cardId];
      const targets = (params.targets as number[]) ?? [];
      await runUseFlow(state, ownerId, cardId, targets, card.name);
    },
  );
}

/** 使用牌的 UI 由前端 CardEffect 注册表（prompt/label/style/activeWhen）驱动。本阶段为空。 */
export function onMount(_skill: Skill, _api: FrontendAPI): void {
  // 使用牌的 UI 由 CardEffect 注册表驱动，前端迁移后通过 cardEffectRegistry 获取数据。
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
