// 使用牌：统一的卡牌使用入口技能。
//
// 对齐文档 use.md 使用事件的结算流程：
//   使用结算前（声明阶段，对所有目标逐时机处理）：
//     选择目标时 → 置入处理区 → 使用时
//     → 逐目标：指定目标
//   使用结算中（逐目标完整结算）：
//     逐目标：成为目标 → 指定目标后 → 成为目标后
//       → 检测有效性 → 生效前[handleSlashDodge for 杀] → 生效时 → 生效后[resolve] → 使用结算结束时
//   使用结算后：
//     移出处理区 → onSettle
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
import type { CardEffect, ResolveCtx } from './registry';
import { isCancelled } from './registry';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '使用牌',
    description: '统一的卡牌使用入口',
  };
}

/**
 * 使用结算中：逐目标执行 5 个时机 atom（use.md 使用结算中）。
 *
 *   检测有效性 → 生效前 → 检查标记 → 生效时 → 生效后[resolve] → 使用结算结束时
 *
 * 完全通用，不区分牌类型。闪/无藉的抵消通过「已抵消」标记实现：
 *   响应牌在「生效前」时机的 after-hook 中设置标记（见闪/无藉 skill）。
 *   此处只检查标记 → 已抵消则发出被抵消 atom（武器技介入）→ 跳过 resolve。
 */
async function runSettlementPhase(
  state: GameState,
  effect: CardEffect,
  source: number,
  target: number,
  cardId: string,
  targetIndex: number,
): Promise<void> {
  // (1) 使用结算开始时：检测有效性（仁器/享乐 before-hook 可 cancel → 跳过）
  const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
  if (!valid) return;

  // (2) 生效前：发出时机 atom（闪/无藉的 after-hook 在此处理响应并设置标记）
  await applyAtom(state, { type: '生效前', source, target, cardId });

  // 检查是否被抵消（闪/无藉的 respond 已在 after-hook 中设置标记）
  if (isCancelled(state, cardId, target)) {
    // 被抵消 atom：触发武器技（贯石斧强命 / 青龙追杀）
    await applyAtom(state, { type: '被抵消', source, target, cardId });
    // 武器技可能逆转（贯石斧弃牌强命 → 清除标记）→ 重新检查
    if (isCancelled(state, cardId, target)) return; // 仍被抵消，跳过 resolve
  }

  // (3) 生效时：若此牌未被抵消，确定将会生效（谦逊等）
  await applyAtom(state, { type: '生效时', source, target, cardId });

  // (4) 生效后：执行此牌的效果
  await applyAtom(state, { type: '生效后', source, target, cardId });
  await effect.resolve({ state, source, target, cardId, targetIndex });

  // (5) 使用结算结束时
  await applyAtom(state, { type: '使用结算结束时', source, target, cardId });
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
    targets: [...targets], // 保持与旧 pushFrame({ ...params }) 的兼容性（界谦逊等读 frame.params.targets）
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
    // 无目标牌（无中生有/酒等 target.kind='none'/'self'）：以 source 为目标走结算阶段
    if (targets.length === 0) {
      await runSettlementPhase(state, effect, source, source, cardId, 0);
    }

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

      // 使用结算中：检测有效性 → 生效前 → 生效时 → 生效后 → 使用结算结束时
      await runSettlementPhase(state, effect, source, target, cardId, i);
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
