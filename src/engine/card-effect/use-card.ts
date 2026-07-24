// 使用牌：统一的卡牌使用入口技能。
//
// 对齐文档 use.md 使用事件的结算流程：
//   使用结算前（声明阶段，逐时机跨所有目标）：
//     选择目标时 → 置入处理区 → 使用时
//     → 逐目标：指定目标
//     → 逐目标：成为目标
//     → 逐目标：指定目标后
//     → 逐目标：成为目标后
//   使用结算中（逐目标完整结算）：
//     逐目标：检测有效性 → 生效前[handleSlashDodge for 杀] → 生效时 → 生效后[resolve] → 使用结算结束时
//   使用结算后：
//     移出处理区 → onSettle
//
// 本技能注册 use action，validate 查 CardEffect 注册表做合法性检测，
// execute 调 runUseFlow 编排完整流程。
//
// 与现有卡牌技能并存：现有杀/决斗等仍各自注册 action。
// 迁移后，卡牌只需 registerCardEffect，不再注册 action。

import type { FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { applyAtom, frameCards, popFrame, pushFrame, topFrame } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';
import { 询问抵消 } from '../无懈可击';
import { validateCardUse, computeAutoTargets } from './validate';
import { getCardEffect, getAllCardEffects, requireCardEffect } from './registry';
import type { CardEffect, CancellableBy, ResolveCtx } from './registry';
import { isCancelled, setCancelled } from './registry';

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
  skipWuxie = false,
): Promise<void> {
  // (1) 使用结算开始时：检测有效性（仁器/享乐 before-hook 可 cancel → 跳过）
  const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
  if (!valid) return;

  // 无效效果目标（如桃园结义对满血角色）：不询问抵消，不结算
  if (effect.hasEffect && !effect.hasEffect(state, target)) return;

  // 重置栈顶帧的抵消状态（多目标锦囊每个目标独立结算）
  const settleFrame = topFrame(state);
  if (settleFrame) settleFrame.cancelled = false;

  // (2) 生效前：发出时机 atom（before/after hook 可介入）
  await applyAtom(state, { type: '生效前', source, target, cardId });

  // 统一询问抵消（闪/无懈可击）。
  // cancelledBy 声明始终生效（杀={闪}, 延时锦囊={无懈}）；
  // 未声明时锦囊牌自动推导为 { 无懈可击, broadcast }，但虚拟使用（virtual）跳过（无实体牌）。
  {
    const card = state.cardMap[cardId];
    const autoCancellable: CancellableBy | undefined =
      !skipWuxie && card?.type === '锦囊牌'
        ? { cardName: '无懈可击', broadcast: true }
        : undefined;
    const cancellable = effect.cancelledBy ?? autoCancellable;
    if (cancellable) {
      await 询问抵消(state, cancellable, source, target);
    }
  }

  // 检查栈顶帧是否被抵消
  if (isCancelled(state, cardId, target)) {
    // 被抵消 atom：触发武器技（贯石斧强命 / 青龙追杀）
    await applyAtom(state, { type: '被抵消', source, target, cardId });
    // 武器技可能逆转（贯石斧弃牌强命 → 清除帧 cancelled）→ 重新检查
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

/** runUseFlow 的选项。 */
export interface RunUseFlowOpts {
  /** 虚拟使用（视为使用，无实体牌）：
   *  跳过"手牌→处理区"和"处理区→弃牌堆"的牌移动，
   *  跳过 onSettle（杀次数累加等不适用于虚拟牌）。
   *  其余时机 atom（选择目标时/使用时/指定目标/成为目标/...）全部正常触发，
   *  保证事件一致。调用方负责创建/清理虚拟卡 cardMap 条目。 */
  virtual?: boolean;
  /** 跳过抵消询问（如界看破转化的无懈不可被响应）。 */
  skipCancelQuery?: boolean;
}

/**
 * runUseFlow：编排使用事件的完整结算流程（文档 use.md）。
 *
 * 整个流程包裹在 pushFrame / popFrame 中（popFrame 在 finally 块调用，异常安全）。
 * 目标列表从帧 params.resolvedTargets 读取（流离等技能可能修改），fallback 到传入 targets。
 *
 * @param state     游戏状态
 * @param source    使用者
 * @param cardId    实体牌 id（须在手牌中）；虚拟使用时为虚拟卡 id（须已写入 cardMap）
 * @param targets   目标列表
 * @param cardName  牌名（查 CardEffect 注册表）
 * @param opts      可选：virtual=true 虚拟使用模式
 */
export async function runUseFlow(
  state: GameState,
  source: number,
  cardId: string,
  targets: number[],
  cardName: string,
  opts?: RunUseFlowOpts,
): Promise<void> {
  const effect = requireCardEffect(cardName);

  // ── 使用结算前（声明阶段）──
  // skippedTargets：声明阶段「成为目标」被 cancel（空城/帷幕）的目标集合。
  // 浅拷贝保留数组引用，后续循环 push/includes 即可读写。结算阶段据此跳过被取消的目标。
  const skippedTargets: number[] = [];
  const frame = await pushFrame(state, cardName, source, {
    cardId,
    targets: [...targets], // 保持与旧 pushFrame({ ...params }) 的兼容性（界谦逊等读 frame.params.targets）
    resolvedTargets: [...targets],
    skippedTargets,
  });

  try {
    // 时机1：选择目标时（转化技 before-hook 可替换牌）
    await applyAtom(state, { type: '选择目标时', source, cardId, targets });

    // effect kind（闪/无懈）：目标是当前生效中的效果，无玩家目标。
    // 跳过目标声明循环，但保留牌移动（手牌→处理区→弃牌堆）和完整 settlement phase。
    // resolve 中设下层帧 cancelled=true。skipWuxie=opts.virtual（虚拟使用不询问抵消）。
    if (effect.target.kind === 'effect') {
      if (!opts?.virtual) {
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '手牌', player: source },
          to: { zone: '处理区' },
        });
      }
      await applyAtom(state, { type: '使用时', source, cardId });
      await runSettlementPhase(state, effect, source, source, cardId, 0, opts?.virtual || opts?.skipCancelQuery);
      if (!opts?.virtual && frameCards(state).includes(cardId)) {
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
      return;
    }

    if (effect.delayed) {
      // 延迟类锦囊：展示后置入目标判定区（处理区→判定区→弃牌堆）
      // 虚拟使用无实体牌，跳过牌移动
      if (!opts?.virtual) {
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '手牌', player: source },
          to: { zone: '处理区' },
        });
      }
      for (const target of targets) {
        const trickCard = state.cardMap[cardId];
        await applyAtom(state, {
          type: '添加延时锦囊',
          player: target,
          trick: { name: cardName, source, card: trickCard },
        });
      }
      if (!opts?.virtual) {
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    } else if (!opts?.virtual) {
      // 基本/普通锦囊/装备：置入处理区（手牌 → 处理区）
      // 虚拟使用无实体牌，跳过
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

    // 声明阶段：逐目标 成为目标（空城/帷幕 before-hook 可 cancel → false = 标记跳过该目标）
    //   cancel 的目标记录到 frame.params.skippedTargets，后续 指定目标后/成为目标后/结算 循环统一跳过。
    //   逐时机跨所有目标：所有目标的「成为目标」先全部完成，再进入下一时机。
    for (let i = 0; i < targets.length; i++) {
      const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
      const target = resolved[i];
      if (!state.players[target]?.alive) continue;
      const becameTarget = await applyAtom(state, {
        type: '成为目标',
        source,
        target,
        cardId,
      });
      if (!becameTarget) {
        (frame.params.skippedTargets as number[]).push(target);
      }
    }

    // 声明阶段：逐目标 指定目标后（铁骑/烈弓/无双①/肉林① after-hook）
    for (let i = 0; i < targets.length; i++) {
      const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
      const target = resolved[i];
      if (!state.players[target]?.alive) continue;
      if ((frame.params.skippedTargets as number[]).includes(target)) continue;
      await applyAtom(state, { type: '指定目标后', source, target, cardId });
    }

    // 声明阶段：逐目标 成为目标后（贞烈/啖酪/无双②/肉林② after-hook）
    for (let i = 0; i < targets.length; i++) {
      const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
      const target = resolved[i];
      if (!state.players[target]?.alive) continue;
      if ((frame.params.skippedTargets as number[]).includes(target)) continue;
      await applyAtom(state, { type: '成为目标后', source, target, cardId });
    }

    // ── 使用结算中：逐目标完整结算 ──
    //   延迟类锦囊不走结算循环（延迟到判定阶段 resumeDelayedSettlement 恢复），
    //   但上方声明阶段的 4 个时机已对延时锦囊执行（对齐 use.md 声明阶段）。
    //   被取消的目标（skippedTargets）跳过结算。
    for (let i = 0; i < targets.length; i++) {
      const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
      const target = resolved[i];
      if (!state.players[target]?.alive) continue;
      if (effect.delayed) continue;
      if ((frame.params.skippedTargets as number[]).includes(target)) continue;
      // 使用结算中：检测有效性 → 生效前 → 生效时 → 生效后 → 使用结算结束时
      await runSettlementPhase(state, effect, source, target, cardId, i, opts?.virtual);
    }

    // ── 使用结算后：移出处理区 ──
    // 虚拟使用无实体牌，跳过
    if (!opts?.virtual && frameCards(state).includes(cardId)) {
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }

    // 牌特有结算后回调（popFrame 前）——杀的出杀次数累加等
    // 延迟类锦囊：结算未完成（延迟到判定阶段），不执行 onSettle
    // 虚拟使用：不执行 onSettle（杀次数累加等不适用于虚拟牌）
    if (!effect.delayed && !opts?.virtual && effect.onSettle) {
      await effect.onSettle(state, source, cardId);
    }
  } finally {
    // 异常安全：保证牌不滞留处理区 + 帧弹出（虚拟牌不在处理区，includes 为 false 自动跳过）
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
 *   检测有效性 → 生效前 → 询问抵消（无懈）→ 生效时 → 生效后[resolve:判定+效果] → 使用结算结束时
 *
 * 被无懈抵消 → frame.cancelled=true → 跳过 resolve → 调用方移除延时锦囊。
 */
export async function resumeDelayedSettlement(
  state: GameState,
  source: number,
  target: number,
  cardName: string,
  cardId: string,
): Promise<boolean> {
  const effect = requireCardEffect(cardName);
  const frame = await pushFrame(state, cardName, source, {
    cardId,
    targets: [target],
    resolvedTargets: [target],
  });
  try {
    // skipWuxie=false：延时锦囊是锦囊牌，runSettlementPhase 自动推导 cancelledBy={无懈可击}
    await runSettlementPhase(state, effect, source, target, cardId, 0, false);
    return frame.cancelled;
  } finally {
    await popFrame(state);
  }
}

/** 注册延时锦囊（乐不思蜀/兵粮寸断/闪电）的全局判定阶段 before-hook + 跳过阶段 hook。
 *  在 create-engine bootstrap / registerSkillsFromState 中调用。
 *  全局注册(ownerId=-1)：判定阶段 hook 检查 atom.player 的判定区有无延时锦囊。 */
export function registerDelayedTrickHooks(state: GameState): void {
  // 判定阶段 before-hook：判定区有延时锦囊 → 逐个结算最后置入的，循环直到清空（对齐 game.md）
  registerBeforeHook(state, '延时锦囊', -1, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始' || atom.phase !== '判定') return;
    const player = atom.player;
    const self = ctx.state.players[player];
    if (!self) return;

    const DELAYED_TRICKS = ['乐不思蜀', '兵粮寸断', '闪电'];

    // 循环：逐个结算最后置入的延时锦囊，直到判定区无延时锦囊。
    //   规则：判定阶段检测判定区有延时锦囊 → 结算最后置入的 → 重复直到判定区清空。
    //   每次 resumeDelayedSettlement 内部 resolve 都会移除当前玩家的该延时锦囊
    //   （乐不思蜀/兵粮寸断 resolve 移除自身；闪电 resolve 移除当前玩家闪电后移给下家），
    //   故 while 循环每次回到顶部重新查找时数量递减，不会死循环。
    while (true) {
      // 牌堆耗尽则无法判定，直接结束
      if (ctx.state.zones.deck.length === 0) return;

      // 取最后置入的延时锦囊（规则：结算最后置入的）
      const trick = [...self.pendingTricks]
        .reverse()
        .find((t) => DELAYED_TRICKS.includes(t.name));
      if (!trick) break;

      const cancelled = await resumeDelayedSettlement(
        ctx.state,
        trick.source,
        player,
        trick.name,
        trick.card.id,
      );
      if (cancelled) {
        const effect = getCardEffect(trick.name);
        if (effect?.onCancelled) {
          // 牌特有抵消善后（如闪电传递下家，不弃置）；自行负责延时锦囊移除
          await effect.onCancelled(ctx.state, player, trick.card.id);
        } else {
          // 默认：移除延时锦囊（弃置）——乐不思蜀/兵粮寸断
          await applyAtom(ctx.state, {
            type: '移除延时锦囊',
            player,
            trickName: trick.name,
          });
        }
      }
    }
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
          if (effect.target.kind === 'self') {
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
    // '生效前' 牌为纯回应牌（闪/无懈可击）：在效果生效前作为回应打出，无主动 use 入口。
    if (effect.timing === '生效前') continue;
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
