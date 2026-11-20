// src/engine/skills/界神速.ts
// 界神速(界夏侯渊·主动技):你可以选择至多三项:
//   1. 跳过判定阶段和摸牌阶段;
//   2. 跳过出牌阶段并弃置一张装备牌;
//   3. 跳过弃牌阶段并翻面。
//   你每选择一项,你视为使用一张无距离限制的【杀】。
//
// 实现:
//   - 在判定阶段 before-hook 统一询问各选项,集中结算。
//   - 选项1:加 跳过摸牌 标签 + 虚拟杀 + 当场跳过判定阶段(skipPhase)。
//   - 选项2:弃装备 + 加 跳过出牌 标签 + 虚拟杀。
//   - 选项3:加 跳过弃牌 标签 + 加 翻面 标签 + 虚拟杀。
//   - usedThisTurn 后缀由 回合结束 atom 自动清理。
//   - 虚拟杀同标版:无实体卡,走 runUseFlow(virtual) + chargeOnSettle→ 指定目标→成为目标→检测有效性→
//     询问闪→伤害/抵消,不消耗手牌、计入出杀次数(由 chargeOnSettle 的 onSettle 计数)、无距离限制。
//   - 翻面实现(同据守/放逐):加 '/翻面' 后缀标签,下一回合 阶段开始(准备) before-hook
//     消费标签、设 skipAll 标志并 cancel 阶段;阶段结束(准备) before-hook 亲自推进回合。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { registerAction, registerBeforeHook } from '../core/skill';
import { registerFlipSkipTurnHooks } from '../flows/face-down';
import { skipPhase } from '../rules/skip-phase';
import {
  currentRequestType,
  defineConfirmAction,
  firstCardId,
  firstTarget,
  requireRequestType,
} from '../util/skillRuntime';
import { equipmentCardIds } from '../util/player-query';
import {
  FLIP_TAG,
  SKIP_MO_TAG,
  SKIP_PLAY_TAG,
  registerShensuTagSkipHook,
  shensuPhaseEntry,
  askShensuConfirm,
  askShensuKillTarget,
  runShensuVirtualSlash,
} from './神速';

// 请求类型(requestType)——保持 神速/ 前缀(界版键名约定)
const OPT1_RT = '界神速/opt1'; // 选项1 confirm
const OPT2_RT = '界神速/opt2'; // 选项2 confirm
const OPT3_RT = '界神速/opt3'; // 选项3 confirm
const TARGET_RT = '界神速/target'; // 虚拟杀目标
const EQUIP_RT = '界神速/equip'; // 选项2 选弃装备

// 标签(与标版共用的 '神速/' 前缀标签从 ./神速 import;此为界版独有)
const SKIP_DISCARD_TAG = '神速/跳过弃牌';

// localVars 键
const CONFIRMED_KEY = '神速/confirmed';
const TARGET_KEY = '神速/target';
const EQUIP_KEY = '神速/equipCardId';

// per-turn 标记(后缀 /usedThisTurn 由 回合结束 atom 自动清理)
const USED_KEY = '神速/usedThisTurn';

const ALL_RTS = [OPT1_RT, OPT2_RT, OPT3_RT, TARGET_RT, EQUIP_RT];

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界神速',
    description:
      '选择至多三项:①跳过判定+摸牌;②弃装备+跳过出牌;③翻面+跳过弃牌。每项视为出杀',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // respond:处理所有 神速 相关的 confirm/target/equip 询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) =>
      requireRequestType(s, ownerId, ALL_RTS, {
        mismatchError: '当前不是界神速询问',
      }).error,
    async (s, params) => {
      const rt = currentRequestType(s, ownerId) ?? '';
      if (rt === OPT1_RT || rt === OPT2_RT || rt === OPT3_RT) {
        s.localVars[CONFIRMED_KEY] = params.choice === true;
      } else if (rt === TARGET_RT) {
        const t = firstTarget(params);
        if (typeof t === 'number') s.localVars[TARGET_KEY] = t;
      } else if (rt === EQUIP_RT) {
        // 兼容 distribute/select 的 cardIds 数组与单 cardId
        const id = firstCardId(params);
        if (id) s.localVars[EQUIP_KEY] = id;
      }
    },
  );

  // ── 主逻辑:判定阶段 before-hook,统一询问并结算 ──────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const entry = shensuPhaseEntry(ctx, ownerId, '判定', USED_KEY);
      if (!entry) return;
      const { atom, self } = entry;

      // ── 逐项询问 ──────────────────────────────────
      // 选项1:跳过判定+摸牌
      const opt1 = await askShensuConfirm(ctx.state, ownerId, OPT1_RT, '是否发动界神速①?(跳过判定+摸牌,视为出杀)');

      // 选项2:弃装备+跳过出牌(仅有装备时询问)
      let opt2 = false;
      const equipCount = equipmentCardIds(ctx.state.players[ownerId]).length;
      if (equipCount > 0) {
        opt2 = await askShensuConfirm(ctx.state, ownerId, OPT2_RT, '是否发动界神速②?(弃置一张装备牌,跳过出牌,视为出杀)');
      }

      // 选项3:翻面+跳过弃牌
      const opt3 = await askShensuConfirm(ctx.state, ownerId, OPT3_RT, '是否发动界神速③?(翻面,跳过弃牌,视为出杀)');

      // 三项全否 → 未发动神速
      if (!opt1 && !opt2 && !opt3) {
        return; // 判定阶段正常进行
      }

      // 标记已发动(本回合不再触发)
      self.vars[USED_KEY] = true;

      let opt1Settled = false;
      await pushFrame(ctx.state, '界神速', ownerId, { opt1, opt2, opt3 });
      try {
        // ── 逐项结算:付代价 → 虚拟杀(顺序①→②→③) ──

        // 选项1:选目标 → 加跳过摸牌标签 → 虚拟杀
        // (先确认目标再付代价,避免超时/无目标白付跳过代价;同标版先选目标后结算)
        if (opt1 && self.alive) {
          const target = await askShensuKillTarget(ctx.state, ownerId, TARGET_RT, '界神速①');
          if (typeof target === 'number' && ctx.state.players[target]?.alive) {
            await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_MO_TAG });
            await runShensuVirtualSlash(ctx.state, ownerId, target, '界神速');
            opt1Settled = true;
          }
        }

        // 选项2:选装备 → 选目标 → 弃装备 + 加跳过出牌标签 → 虚拟杀
        // (先确认目标再弃装备,避免超时/无目标白付弃牌代价)
        if (opt2 && self.alive) {
          delete ctx.state.localVars[EQUIP_KEY];
          await applyAtom(ctx.state, {
            type: '请求回应',
            requestType: EQUIP_RT,
            target: ownerId,
            prompt: {
              type: 'distribute',
              mode: 'select',
              title: '界神速②:选择一张装备牌弃置',
              source: 'handAndEquip',
              minTotal: 1,
              maxTotal: 1,
            },
            timeout: 15,
          });
          const equipCardIdRaw = ctx.state.localVars[EQUIP_KEY] as string | undefined;
          delete ctx.state.localVars[EQUIP_KEY];
          if (equipCardIdRaw && equipmentCardIds(ctx.state.players[ownerId]).includes(equipCardIdRaw)) {
            const target = await askShensuKillTarget(ctx.state, ownerId, TARGET_RT, '界神速②');
            if (typeof target === 'number' && ctx.state.players[target]?.alive) {
              await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_PLAY_TAG });
              await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [equipCardIdRaw], voluntary: true });
              await runShensuVirtualSlash(ctx.state, ownerId, target, '界神速');
            }
          }
          // 无效选择/无目标 → 选项2未生效(不弃牌、不跳过出牌、不虚拟杀)
        }

        // 选项3:选目标 → 加跳过弃牌标签 + 翻面(加翻面标签) → 虚拟杀
        // (先确认目标再付翻面代价,避免超时/无目标白付翻面代价)
        if (opt3 && self.alive) {
          const target = await askShensuKillTarget(ctx.state, ownerId, TARGET_RT, '界神速③');
          if (typeof target === 'number' && ctx.state.players[target]?.alive) {
            await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_DISCARD_TAG });
            await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: FLIP_TAG });
            await runShensuVirtualSlash(ctx.state, ownerId, target, '界神速');
          }
        }
      } finally {
        await popFrame(ctx.state);
      }

      // ── 选项1生效:当场跳过判定阶段 ──
      if (opt1Settled) {
        return skipPhase(ctx.state, atom);
      }
      // 选项1未选:判定阶段正常进行(神速②③的效果已通过标签作用于后续阶段)
    },
  );

  // ── 跳过摸牌阶段:有标签 → skip(同兵粮寸断) ──────────────────
  registerShensuTagSkipHook(state, skill.id, ownerId, '摸牌', SKIP_MO_TAG);

  // ── 跳过出牌阶段:有标签 → skip(同乐不思蜀) ──────────────────
  registerShensuTagSkipHook(state, skill.id, ownerId, '出牌', SKIP_PLAY_TAG);

  // ── 跳过弃牌阶段:有标签 → skip ────────────────────
  registerShensuTagSkipHook(state, skill.id, ownerId, '弃牌', SKIP_DISCARD_TAG);

  // ── 翻面:下一回合跳过整回合(共用 face-down 通用版 hook 对;键沿用标版 '神速/' 前缀,
  //    加/去标签均不补发「翻面后」,emitFaceUpEvent:false 保持事件序列)──
  registerFlipSkipTurnHooks(state, skill.id, ownerId, '神速', { emitFaceUpEvent: false });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  defineConfirmAction(api, 'respond', {
    label: '界神速',
    style: 'default',
    title: '是否发动界神速?',
    confirmLabel: '发动',
    cancelLabel: '不发动',
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
