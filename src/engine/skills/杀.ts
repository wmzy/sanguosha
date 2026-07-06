// 杀(基本牌):
//   use:出牌阶段对攻击范围内一名角色使用,目标须出闪抵消,否则受 1 点伤害。
//   respond:决斗/南蛮入侵等场景,目标"出杀抵消"——杀牌移到处理区供调用方结算。
//
// 多目标结算顺序(三阶段):
//   1. 声明:逐个 指定目标(触发"指定目标时"hook)
//   2. 结算:逐个 成为目标(触发"成为目标后"hook,如流离转移)
//      → 询问闪(防具如仁王盾/八卦阵在此 cancel 或放虚拟闪)
//      → 检查处理区有闪则 miss,无闪则造成伤害
//   3. 收尾:杀牌移出处理区→弃牌堆
//
// 流离/转移类技能:在 成为目标 after hook 修改帧 params.currentTarget,
// 杀在下轮结算时读帧上的 currentTarget 而非原始 targets[i]。
import type { FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, validateUseCard } from '../skill';
import { inAttackRange } from '../distance';
import { viewCanAttack } from '../viewDistance';
import { canSlash, incSlashUsed, slashUsed } from '../slash-quota';
import { defaultPlayActive, viewCanSlash } from '../action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '杀', description: '出牌阶段对攻击范围内一名角色使用' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // ── use:主动出杀 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      return (
        validateUseCard(state, ownerId, params, { cardName: '杀', requireTarget: true }) ??
        (Array.isArray(params.targets) &&
        (params.targets as number[]).every(
          (t) => state.players[t]?.alive === true && inAttackRange(state, ownerId, t),
        )
          ? null
          : '目标不合法') ??
        (canSlash(state, ownerId) ? null : '出杀次数已达上限')
      );
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const targets = params.targets as number[];
      const damageType = state.cardMap[cardId]?.damageType;
      const frame = await pushFrame(state, '杀', from, {
        ...params,
        resolvedTargets: [...targets],
      });

      try {
        // 杀牌进处理区
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '手牌', player: from },
          to: { zone: '处理区' },
        });

        // 第一阶段:逐个指定所有目标(触发"指定目标时"hook)
        for (const target of targets) {
          await applyAtom(state, { type: '指定目标', source: from, target, cardId });
        }

        // 第二阶段:逐个结算(成为目标 → 检测有效性 → 询问闪 → 被抵消 → 检查处理区 → 伤害)
        // resolvedTargets 从帧上读取:流离等技能可能修改帧上的 resolvedTargets
        for (let i = 0; i < targets.length; i++) {
          // 从帧上读当前目标(可能被流离等技能修改)
          const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
          const target = resolved[i];

          // 成为目标:触发"成为目标后"hook(如流离转移),可被 cancel(空城等)
          const becameTarget = await applyAtom(state, {
            type: '成为目标',
            source: from,
            target,
            cardId,
          });
          if (!becameTarget) continue; // 空城等:目标不合法,跳过该目标结算

          // 使用结算开始时:检测有效性(仁王盾黑杀无效在此 cancel)。
          // cancel=false 表示目标无效,跳过该目标(不询问闪、不伤害、不触发被抵消)。
          const valid = await applyAtom(state, {
            type: '检测有效性',
            source: from,
            target,
            cardId,
          });
          if (!valid) continue;

          // 生效前:询问闪(等待目标回应;八卦阵判红放虚拟闪后 cancel)
          await applyAtom(state, { type: '询问闪', target, source: from });

          // 检查处理区:有没有闪牌(目标出闪 / 八卦阵虚拟闪)
          const dodgeIds = frameCards(state).filter((id) => {
            const c = state.cardMap[id];
            return c?.name === '闪';
          });
          if (dodgeIds.length > 0) {
            // 被抵消:触发武器技(贯石斧强命移闪 / 青龙追杀)。
            // 武器技在 after hook 可能改变处理区状态,故 apply 后重新检查。
            await applyAtom(state, { type: '被抵消', source: from, target, cardId });
            const remaining = frameCards(state).filter((id) => {
              const c = state.cardMap[id];
              return c?.name === '闪';
            });
            if (remaining.length > 0) {
              // 仍被抵消:drain 所有闪
              for (const dodgeCardId of remaining) {
                await applyAtom(state, {
                  type: '移动牌',
                  cardId: dodgeCardId,
                  from: { zone: '处理区' },
                  to: { zone: '弃牌堆' },
                });
              }
            } else {
              // 武器技逆转(贯石斧强命 / 青龙追杀命中):处理区无闪 → 造成伤害
              await applyAtom(state, { type: '造成伤害', target, amount: 1, source: from, cardId, damageType });
            }
          } else {
            // 没闪:造成伤害(触发藤甲/白银狮子/遗计/反馈等,濒死由引擎核心处理)
            await applyAtom(state, { type: '造成伤害', target, amount: 1, source: from, cardId, damageType });
          }
        }

        // 第三阶段:收尾——杀牌移出处理区→弃牌堆
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        // 异常安全:保证帧弹出 + 杀牌不滞留处理区(即使上面 await 抛错)。
        // 不吞错——如果清理用的 移动牌 也抛,说明状态已损坏,应让异常传播暴露问题。
        const stillInProc = frameCards(state).includes(cardId);
        if (stillInProc) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
        await popFrame(state);
        // 记录一次出杀(已用次数 +1;上限由 slashMax 计算,连弩的 ∞ 由标签体现)
        incSlashUsed(state);
        // 同步出杀计数到 view:processedView 不增量维护 turn.vars,需经 atom
        // event 让前端 turnUsage 实时更新(杀超上限时禁用)。紧跟 incSlashUsed
        // 投影最新计数。
        await applyAtom(state, {
          type: '回合用量',
          player: ownerId,
          key: '杀/usedCount',
          value: slashUsed(state),
        });
      }
    },
  );

  // ── respond:被询问出杀(决斗/南蛮入侵等)——杀牌进处理区供调用方结算 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      // pending 必须是 询问杀 或 请求回应(借刀杀人/激将)
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      const atomType = slot.atom.type;
      const reqType = (slot.atom as { requestType?: string }).requestType;
      const pendingMatches =
        atomType === '询问杀' ||
        (atomType === '请求回应' && (reqType === '杀/forceKill' || reqType === '杀/respondKill'));
      if (!pendingMatches) return '当前不是出杀的窗口';
      const cardId = params.cardId as string | undefined;
      if (cardId) {
        const self = state.players[ownerId];
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (card?.name !== '杀') return '只能打出杀';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return;
      // 杀牌进处理区,供调用方(决斗/南蛮入侵)检查处理区判断是否出了杀
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '处理区' },
      });
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '杀',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '出杀',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 3,
        // 攻击范围检查:filter 仅为前端 UI 提示(高亮/禁用),后端 validate 独立校验
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    activeWhen: (ctx) => defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx),
  });
  api.defineAction('respond', {
    label: '出杀',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '打出杀',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
    },
  });
}
