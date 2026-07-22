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
 *   检测有效性 → 生效前 → 生效时 → 生效后[resolve] → 使用结算结束时
 *
 * - 检测有效性 返回 false（before-hook cancel）时跳过后续时机。
 * - 生效后 时机 atom 之后调用 CardEffect.resolve——即牌的实际效果。
 *   杀: 造成伤害; 桃: 回复体力; 锦囊: 各自效果。
 */
async function runSettlementPhase(
  state: GameState,
  effect: CardEffect,
  source: number,
  target: number,
  cardId: string,
  targetIndex: number,
): Promise<void> {
  // (1) 使用结算开始时：检测有效性（仁王器/享乐 before-hook 可 cancel → 跳过）
  const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
  if (!valid) return;

  // (2) 生效前：可以对此牌进行响应
  const cardName = state.cardMap[cardId]?.name;

  if (cardName === '杀') {
    // 杀的生效前：先发出杀的「生效前」时机 atom（供其他技能 hook），再处理闪响应
    await applyAtom(state, { type: '生效前', source, target, cardId });
    // 闪响应：循环询问使用闪（无双/肉林可要求多次），发出闪的「生效前」atom
    const cancelled = await handleSlashDodge(state, source, target, cardId);
    if (cancelled) return; // 被闪抵消
  } else {
    // 非杀牌：正常发出「生效前」atom（before-hook 可 cancel → 跳过）
    const notCancelled = await applyAtom(state, { type: '生效前', source, target, cardId });
    if (!notCancelled) return;
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
 * 杀的「生效前」闪响应处理（使用牌技能的核心逻辑,不在系统规则中）。
 *
 * 循环流程（支持无双/肉林要求多次闪）：
 *   1. 询问目标是否使用闪（询问闪 pending）
 *   2. 检查处理区有无闪牌（respond action 移入 / 八卦阵虚拟闪）
 *   3. 无闪 → 杀继续生效（return false）
 *   4. 有闪 → 发出闪的「生效前」atom（无双/肉林 before-hook 可 cancel 第一次闪）
 *   5. 闪被 cancel（无双/肉林拦截）→ drain闪 → 回到步骤1（再次询问）
 *   6. 闪通过 → 被抵消 atom（武器技介入）→ 重检 → drain / 逆转
 *
 * @returns true=杀被抵消（跳过生效后），false=杀继续生效
 */
async function handleSlashDodge(
  state: GameState,
  source: number,
  target: number,
  cardId: string,
): Promise<boolean> {
  while (state.players[target]?.alive) {
    // 询问是否使用闪
    await applyAtom(state, { type: '询问闪', target, source });

    // 检查处理区：有没有闪牌（目标出闪 / 八卦阵虚拟闪）
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length === 0) {
      // 没使用闪，杀继续生效
      return false;
    }

    // 使用了闪：发出闪的「生效前」atom
    // 无双/肉林在此 before-hook 中拦截第一次闪（cancel）
    const dodgeId = dodgeIds[0];
    const dodgePassed = await applyAtom(state, {
      type: '生效前',
      source: target, // 闪的使用者
      target: target, // 闪没有额外目标
      cardId: dodgeId,
    });

    if (!dodgePassed) {
      // 闪被无双/肉林 cancel → drain 闪 → 再次询问（无双要求第二张闪）
      for (const id of dodgeIds) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: id,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
      continue; // 回到循环顶部，再次询问
    }

    // 闪正常生效，抵消了杀
    // 被抵消 atom：触发武器技（贯石斧强命 / 青龙追杀）
    await applyAtom(state, { type: '被抵消', source, target, cardId });

    // 武器技后重检处理区（贯石斧可能弃牌移走闪）
    const remaining = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (remaining.length > 0) {
      // 仍被抵消：drain 所有闪
      for (const dodgeCardId of remaining) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: dodgeCardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
      return true; // 被抵消
    }
    // 武器技逆转（贯石斧强命）：处理区无闪 → 杀命中
    return false;
  }
  return false;
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
