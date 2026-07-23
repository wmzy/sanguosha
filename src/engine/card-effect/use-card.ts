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
import { registerAction, registerBeforeHook } from '../skill';
import { 询问无懈可击 } from '../无懈可击';
import { validateCardUse, computeAutoTargets } from './validate';
import { getCardEffect, getAllCardEffects, requireCardEffect } from './registry';
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

    if (effect.delayed) {
      // 延迟类锦囊：展示后置入目标判定区（处理区→判定区→弃牌堆）
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: source },
        to: { zone: '处理区' },
      });
      for (const target of targets) {
        const trickCard = state.cardMap[cardId];
        await applyAtom(state, {
          type: '添加延时锦囊',
          player: target,
          trick: { name: cardName, source, card: trickCard },
        });
      }
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    } else {
      // 基本/普通锦囊/装备：置入处理区（手牌 → 处理区）
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: source },
        to: { zone: '处理区' },
      });
    }

    // 时机2：使用时（集智/强识 after-hook 摸牌）
    await applyAtom(state, { type: '使用时', source, cardId });

    // 声明阶段：逐目标 指定目标
    for (const target of targets) {
      await applyAtom(state, { type: '指定目标', source, target, cardId });
    }

    // ── 使用结算中：逐目标完整结算 ──
    // 无目标牌（无中生有/酒等 target.kind='none'/'self'）：以 source 为目标走结算阶段
    if (!effect.delayed && targets.length === 0) {
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

      // 延迟类锦囊：使用结算中延迟到判定阶段恢复（resumeDelayedSettlement）
      if (effect.delayed) continue;

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
    // 延迟类锦囊：结算未完成（延迟到判定阶段），不执行 onSettle
    if (!effect.delayed && effect.onSettle) {
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

/**
 * 恢复延迟类锦囊的使用结算中（判定阶段触发）。
 *
 * 延迟类锦囊的 runUseFlow 在使用结算前（成为目标后）暂停，
 * 牌已置入判定区。判定阶段恢复时调用此函数走完使用结算中：
 *   检测有效性 → 生效前 → 生效时 → 生效后[resolve:判定+效果] → 使用结算结束时
 *
 * 无懈可击抵消由调用方（技能判定阶段 before-hook）在调用前处理：
 *   被抵消 → 移除延时锦囊 → 不调用本函数。
 */
export async function resumeDelayedSettlement(
  state: GameState,
  source: number,
  target: number,
  cardName: string,
  cardId: string,
): Promise<void> {
  const effect = requireCardEffect(cardName);
  const frame = await pushFrame(state, cardName, source, {
    cardId,
    targets: [target],
    resolvedTargets: [target],
  });
  try {
    await runSettlementPhase(state, effect, source, target, cardId, 0);
  } finally {
    await popFrame(state);
  }
}

/** 注册延时锦囊（乐不思蜀/兵粮寸断/闪电）的全局判定阶段 before-hook + 跳过阶段 hook。
 *  在 create-engine bootstrap / registerSkillsFromState 中调用。
 *  全局注册(ownerId=-1)：判定阶段 hook 检查 atom.player 的判定区有无延时锦囊。 */
export function registerDelayedTrickHooks(state: GameState): void {
  // 判定阶段 before-hook：有延时锦囊 → 询问无懈 → resumeDelayedSettlement
  registerBeforeHook(state, '延时锦囊', -1, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始' || atom.phase !== '判定') return;
    const player = atom.player;
    const self = ctx.state.players[player];
    if (!self) return;
    if (ctx.state.zones.deck.length === 0) return;
    // 查找判定区第一个延时锦囊（乐不思蜀/兵粮寸断/闪电）
    const DELAYED_TRICKS = ['乐不思蜀', '兵粮寸断', '闪电'];
    const trick = self.pendingTricks.find((t) => DELAYED_TRICKS.includes(t.name));
    if (!trick) return;

    const cancelled = await 询问无懈可击(ctx.state, player);
    if (cancelled) {
      await applyAtom(ctx.state, {
        type: '移除延时锦囊',
        player,
        trickName: trick.name,
      });
      return;
    }
    await resumeDelayedSettlement(ctx.state, trick.source, player, trick.name, trick.card.id);
  });

  // 跳过阶段 before-hook：乐不思蜀跳过出牌、兵粮寸断跳过摸牌
  const SKIP_MAP: Record<string, string> = {
    乐不思蜀: '乐不思蜀/跳过出牌',
    兵粮寸断: '兵粮寸断/跳过摸牌',
  };
  registerBeforeHook(state, '延时锦囊', -1, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    const player = atom.player;
    const self = ctx.state.players[player];
    if (!self) return;
    for (const [trickName, tag] of Object.entries(SKIP_MAP)) {
      if (self.tags.includes(tag)) {
        const skipPhase = atom.phase === '出牌' || atom.phase === '摸牌';
        if (!skipPhase) continue;
        if (
          (trickName === '乐不思蜀' && atom.phase === '出牌') ||
          (trickName === '兵粮寸断' && atom.phase === '摸牌')
        ) {
          const { skipPhase: doSkip } = await import('../skip-phase');
          return doSkip(ctx.state, atom, tag);
        }
      }
    }
  });
}

/** 注册 use action：逐卡名注册（skillId=卡名），validate 查 CardEffect 注册表，execute 调 runUseFlow。
 *  按卡名注册而非统一 '使用牌' skillId，是为了：
 *  1. 保持 triggerAction('杀','use',...) 等调用向后兼容
 *  2. 让 界火计/界乱击 等 registerAction('万箭齐发',...) 覆盖机制仍然生效
 *  3. 前端 transform.name='万箭齐发' → skillId='万箭齐发' 路由不变 */
export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const unloads: Array<() => void> = [];

  for (const [cardName, effect] of getAllCardEffects()) {
    const u = registerAction(
      state,
      cardName,
      ownerId,
      'use',
      (state: GameState, params: Record<string, Json>) => {
        const cardId = params.cardId as string | undefined;
        if (!cardId) return 'cardId required';
        const card = state.cardMap[cardId];
        if (!card) return '牌不存在';
        if (card.name !== cardName) return `不是${cardName}`;
        // 兼容 target(单数) → targets(数组)
        if (!Array.isArray(params.targets) && typeof params.target === 'number') {
          params.targets = [params.target];
        }
        return validateCardUse(state, ownerId, params, cardName);
      },
      async (state: GameState, params: Record<string, Json>) => {
        const cardId = params.cardId as string;
        // 兼容 target(单数) → targets(数组)
        if (!Array.isArray(params.targets) && typeof params.target === 'number') {
          params.targets = [params.target];
        }
        // preUse 钩子：双目标牌（借刀杀人）提取 killTarget 存入 localVars，返回真实 targets。
        let targets = effect.preUse
          ? effect.preUse(state, ownerId, params)
          : ((params.targets as number[]) ?? []);
        // 自动计算目标：self → [ownerId]；AOE(allOthers/allPlayers) → 全场
        if (targets.length === 0) {
          if (effect.target.kind === 'self' || effect.target.kind === 'none') {
            targets = [ownerId];
          } else {
            targets = computeAutoTargets(state, ownerId, cardName);
          }
        }
        await runUseFlow(state, ownerId, cardId, targets, cardName);
      },
    );
    if (u) unloads.push(u);
  }

  return () => unloads.forEach((u) => u());
}

/** 使用牌的 UI：按卡名注册 use action 的 UI 配置（从 CardEffect 注册表驱动）。
 *  每张 CardEffect 的 prompt/label/style/activeWhen 成为一个 use action 定义。
 *  skillIdOverride=卡名（与 onInit 按卡名注册的 engine action 对齐）。 */
export function onMount(_skill: Skill, api: FrontendAPI): void {
  for (const [cardName, effect] of getAllCardEffects()) {
    // 跳过纯 respond 牌（闪/无懈可击）：它们无 use 入口，不注册 use UI。
    // 闪 timing='杀生效前' 且无 canUse；无懈可击 resolve 为空且 timing='杀生效前'。
    if (effect.timing === '杀生效前' && !effect.canUse) continue;
    api.defineAction(
      'use',
      {
        label: effect.label,
        style: effect.style,
        prompt: effect.prompt,
        ...(effect.activeWhen ? { activeWhen: effect.activeWhen } : {}),
      },
      cardName,
    );
  }
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
