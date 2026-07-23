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
//   - 虚拟杀同标版:无实体卡,走 指定目标→成为目标→检测有效性→询问闪→伤害/抵消,
//     不消耗手牌、不计入 杀/quota、无距离限制。
//   - 翻面实现(同据守/放逐):加 '/翻面' 后缀标签,下一回合 阶段开始(准备) before-hook
//     消费标签、设 skipAll 标志并 cancel 阶段;阶段结束(准备) before-hook 亲自推进回合。
import type {
  FrontendAPI,
  GameState,
  GameView,
  HookResult,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';
import { skipPhase } from '../skip-phase';
import { runUseFlow } from '../card-effect/use-card';

// 请求类型(requestType)——保持 神速/ 前缀(界版键名约定)
const OPT1_RT = '神速/opt1'; // 选项1 confirm
const OPT2_RT = '神速/opt2'; // 选项2 confirm
const OPT3_RT = '神速/opt3'; // 选项3 confirm
const TARGET_RT = '神速/target'; // 虚拟杀目标
const EQUIP_RT = '神速/equip'; // 选项2 选弃装备

// 标签
const SKIP_MO_TAG = '神速/跳过摸牌';
const SKIP_PLAY_TAG = '神速/跳过出牌';
const SKIP_DISCARD_TAG = '神速/跳过弃牌';
const FLIP_TAG = '神速/翻面'; // 翻面标签(下一回合被消费,跳过整回合)
const SKIP_FLAG = '神速/skipAll'; // 翻面生效时跳过整回合的标志(localVars)

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

/** 创建一张虚拟杀卡(无实体,仅用于结算流程的 cardId 引用) */
function makeVirtualKillCard(source: number, target: number, seq: number): string {
  return `界神速:杀:${source}:${target}:${seq}`;
}

/**
 * 执行一次"视为出杀"的完整结算(指定目标→成为目标→检测有效性→询问闪→伤害/抵消)。
 * 不消耗手牌、不计入出杀次数;无距离限制。同标版 virtualKill。
 */
async function virtualKill(state: GameState, source: number, target: number): Promise<void> {
  if (!state.players[target]?.alive) return;
  const cardId = makeVirtualKillCard(source, target, state.seq);
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };

  await runUseFlow(state, source, cardId, [target], '杀', { virtual: true });
  delete state.cardMap[cardId];
}

/** 取玩家装备区的所有 cardId */
function equipCardIds(state: GameState, player: number): string[] {
  const p = state.players[player];
  if (!p) return [];
  return Object.values(p.equipment).filter((id): id is string => !!id);
}

/** 询问选择一个虚拟杀目标(其他存活角色) */
async function askKillTarget(
  state: GameState,
  ownerId: number,
  label: string,
): Promise<number | undefined> {
  delete state.localVars[TARGET_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: `${label}:选择一名其他角色(视为出杀,无距离限制)`,
      min: 1,
      max: 1,
      filter: (_view: GameView, t: number) =>
        t !== ownerId && state.players[t]?.alive === true,
    },
    timeout: 15,
  });
  const t = state.localVars[TARGET_KEY] as number | undefined;
  delete state.localVars[TARGET_KEY];
  return t;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理所有 神速 相关的 confirm/target/equip 询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType ?? '';
      if (!ALL_RTS.includes(rt)) return '当前不是界神速询问';
      return null;
    },
    async (s, params) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt =
        (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType ?? '';
      if (rt === OPT1_RT || rt === OPT2_RT || rt === OPT3_RT) {
        s.localVars[CONFIRMED_KEY] = params.choice === true;
      } else if (rt === TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') s.localVars[TARGET_KEY] = t;
      } else if (rt === EQUIP_RT) {
        const cardIds = params.cardIds as string[] | undefined;
        const single = params.cardId as string | undefined;
        const id =
          (Array.isArray(cardIds) && cardIds.length > 0 ? cardIds[0] : undefined) ??
          (typeof single === 'string' ? single : undefined);
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
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '判定') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (self.vars[USED_KEY]) return;

      // 无其他存活角色 → 神速无意义
      const hasOtherAlive = ctx.state.players.some((p, i) => i !== ownerId && p.alive);
      if (!hasOtherAlive) return;

      // ── 逐项询问 ──────────────────────────────────
      // 选项1:跳过判定+摸牌
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT1_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动界神速①?(跳过判定+摸牌,视为出杀)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      const opt1 = ctx.state.localVars[CONFIRMED_KEY] === true;

      // 选项2:弃装备+跳过出牌(仅有装备时询问)
      let opt2 = false;
      const equipCount = equipCardIds(ctx.state, ownerId).length;
      if (equipCount > 0) {
        delete ctx.state.localVars[CONFIRMED_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: OPT2_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title: '是否发动界神速②?(弃置一张装备牌,跳过出牌,视为出杀)',
            confirmLabel: '发动',
            cancelLabel: '不发动',
          },
          defaultChoice: false,
          timeout: 10,
        });
        opt2 = ctx.state.localVars[CONFIRMED_KEY] === true;
      }

      // 选项3:翻面+跳过弃牌
      let opt3 = false;
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT3_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动界神速③?(翻面,跳过弃牌,视为出杀)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      opt3 = ctx.state.localVars[CONFIRMED_KEY] === true;

      // 三项全否 → 未发动神速
      if (!opt1 && !opt2 && !opt3) {
        return; // 判定阶段正常进行
      }

      // 标记已发动(本回合不再触发)
      self.vars[USED_KEY] = true;

      await pushFrame(ctx.state, '界神速', ownerId, { opt1, opt2, opt3 });
      try {
        // ── 逐项结算:付代价 → 虚拟杀(顺序①→②→③) ──

        // 选项1:加跳过摸牌标签 → 虚拟杀
        if (opt1 && self.alive) {
          await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_MO_TAG });
          const target = await askKillTarget(ctx.state, ownerId, '界神速①');
          if (typeof target === 'number' && ctx.state.players[target]?.alive) {
            await virtualKill(ctx.state, ownerId, target);
          }
        }

        // 选项2:弃装备 + 加跳过出牌标签 → 虚拟杀
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
          if (equipCardIdRaw && equipCardIds(ctx.state, ownerId).includes(equipCardIdRaw)) {
            await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_PLAY_TAG });
            await applyAtom(ctx.state, {
              type: '弃置',
              player: ownerId,
              cardIds: [equipCardIdRaw],
            });
            const target = await askKillTarget(ctx.state, ownerId, '界神速②');
            if (typeof target === 'number' && ctx.state.players[target]?.alive) {
              await virtualKill(ctx.state, ownerId, target);
            }
          }
          // 无效选择 → 选项2未生效(不弃牌、不跳过出牌、不虚拟杀)
        }

        // 选项3:加跳过弃牌标签 + 翻面(加翻面标签) → 虚拟杀
        if (opt3 && self.alive) {
          await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_DISCARD_TAG });
          await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: FLIP_TAG });
          const target = await askKillTarget(ctx.state, ownerId, '界神速③');
          if (typeof target === 'number' && ctx.state.players[target]?.alive) {
            await virtualKill(ctx.state, ownerId, target);
          }
        }
      } finally {
        await popFrame(ctx.state);
      }

      // ── 选项1生效:当场跳过判定阶段 ──
      if (opt1) {
        return skipPhase(ctx.state, atom);
      }
      // 选项1未选:判定阶段正常进行(神速②③的效果已通过标签作用于后续阶段)
    },
  );

  // ── 跳过摸牌阶段:有标签 → skip(同兵粮寸断) ──────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '摸牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(SKIP_MO_TAG)) return;
      return skipPhase(ctx.state, atom, SKIP_MO_TAG);
    },
  );

  // ── 跳过出牌阶段:有标签 → skip(同乐不思蜀) ──────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '出牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(SKIP_PLAY_TAG)) return;
      return skipPhase(ctx.state, atom, SKIP_PLAY_TAG);
    },
  );

  // ── 跳过弃牌阶段:有标签 → skip ────────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '弃牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(SKIP_DISCARD_TAG)) return;
      return skipPhase(ctx.state, atom, SKIP_DISCARD_TAG);
    },
  );

  // ── 翻面:下一回合跳过(机制同据守/放逐) ────────────────────
  // 检测翻面标签 → 移除标签 + 设 skipAll 标志 + cancel(不进入准备阶段)
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      const self = ctx.state.players[ownerId];

      // 入口:准备阶段开始 + 翻面标签 → 启动跳过
      if (atom.phase === '准备' && self?.tags.includes(FLIP_TAG)) {
        await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: FLIP_TAG });
        ctx.state.localVars[SKIP_FLAG] = ownerId;
        return { kind: 'cancel' };
      }

      // skipAll 标志存在时,取消所有其他阶段(防止 phase-end after-hook 推进产生副作用)
      if (ctx.state.localVars[SKIP_FLAG] === ownerId) {
        return { kind: 'cancel' };
      }
    },
  );

  // ── 翻面:阶段结束(准备) before-hook,主动推进回合 ────────
  // skipAll 标志存在时:清除标志 + 亲自执行 end-turn 序列把回合交给下家。
  // (与据守一致:cancel 阶段结束原子以防 phase-end after-hook 推进产生幻影阶段链)
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段结束',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段结束') return;
      if (atom.player !== ownerId) return;
      if (ctx.state.localVars[SKIP_FLAG] !== ownerId) return;

      // 清除 skipAll 标志(后续不再 skip)
      delete ctx.state.localVars[SKIP_FLAG];

      // 亲自执行 end-turn 序列:清过期标记 → 下一玩家 → 回合结束
      await applyAtom(ctx.state, { type: '清过期标记', player: ownerId });
      await applyAtom(ctx.state, { type: '下一玩家' });
      await applyAtom(ctx.state, { type: '回合结束', player: ownerId });

      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界神速',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动界神速?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
