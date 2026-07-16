// src/engine/skills/界神速.ts
// 界神速(界夏侯渊·主动技):你可以选择至多三项:
//   1. 跳过判定阶段和摸牌阶段;视为对一名其他角色使用一张无距离限制的【杀】。
//   2. 跳过出牌阶段并弃置一张装备牌;视为对一名其他角色使用一张无距离限制的【杀】。
//   3. 跳过弃牌阶段并失去1点体力;视为对一名其他角色使用一张无距离限制的【杀】。
//   每选择一项 → 一次虚拟杀。
//   界版新增:当你发动神速时,你可以移动场上一张装备牌。
//
// 与标版区别:
//   - 标版仅 2 选项,且各选项在对应阶段(判定/出牌)单独触发。
//   - 界版 3 选项,统一在判定阶段开始时询问发动 + 逐项确认 + 集中结算。
//   - 界版新增"移动场上装备"效果(可选,发动神速时一次)。
//
// 实现要点:
//   - 在判定阶段 before-hook 统一询问各选项,集中结算。
//   - 选项1:加 跳过摸牌 标签 + 虚拟杀 + 跳过判定阶段(skipPhase)。
//   - 选项2:弃装备 + 加 跳过出牌 标签 + 虚拟杀。
//   - 选项3:失去1点体力 + 加 跳过弃牌 标签 + 虚拟杀。
//   - 界版新增:发动后询问是否移动场上装备(卸下→移动牌→装备 序列)。
//   - usedThisTurn 后缀由 回合结束 atom 自动清理。
//   - 虚拟杀同标版:无实体卡,走 指定目标→成为目标→检测有效性→询问闪→伤害/抵消,
//     不消耗手牌、不计入 杀/quota、无距离限制。
import type {
  AtomBeforeContext,
  EquipSlot,
  FrontendAPI,
  GameState,
  GameView,
  HookResult,
  Skill,
} from '../types';
import { applyAtom, frameCards, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';
import { skipPhase } from '../skip-phase';
import { skillLoaders } from './index';

// 请求类型(requestType)——保持 神速/ 前缀(界版键名约定)
const OPT1_RT = '神速/opt1'; // 选项1 confirm
const OPT2_RT = '神速/opt2'; // 选项2 confirm
const OPT3_RT = '神速/opt3'; // 选项3 confirm
const TARGET_RT = '神速/target'; // 虚拟杀目标
const EQUIP_RT = '神速/equip'; // 选项2 选弃装备
const MOVE_CONFIRM_RT = '神速/move-confirm'; // 界:移动装备 confirm
const MOVE_SRC_PLAYER_RT = '神速/move-src-player';
const MOVE_SRC_CARD_RT = '神速/move-src-card';
const MOVE_DEST_PLAYER_RT = '神速/move-dest-player';

// 标签
const SKIP_MO_TAG = '神速/跳过摸牌';
const SKIP_PLAY_TAG = '神速/跳过出牌';
const SKIP_DISCARD_TAG = '神速/跳过弃牌';

// localVars 键
const CONFIRMED_KEY = '神速/confirmed';
const TARGET_KEY = '神速/target';
const EQUIP_KEY = '神速/equipCardId';
const MOVE_SRC_PLAYER_KEY = '神速/moveSrcPlayer';
const MOVE_SRC_CARD_KEY = '神速/moveSrcCardId';
const MOVE_DEST_PLAYER_KEY = '神速/moveDestPlayer';

// per-turn 标记(后缀 /usedThisTurn 由 回合结束 atom 自动清理)
const USED_KEY = '神速/usedThisTurn';

const ALL_RTS = [
  OPT1_RT,
  OPT2_RT,
  OPT3_RT,
  TARGET_RT,
  EQUIP_RT,
  MOVE_CONFIRM_RT,
  MOVE_SRC_PLAYER_RT,
  MOVE_SRC_CARD_RT,
  MOVE_DEST_PLAYER_RT,
];

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界神速',
    description:
      '选择至多三项:①跳过判定+摸牌;②弃装备+跳过出牌;③失1血+跳过弃牌。每项视为出杀。发动时可移动场上装备',
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

  await pushFrame(state, '界神速', source, { virtualKillCardId: cardId });
  try {
    await applyAtom(state, { type: '指定目标', source, target, cardId });
    await applyAtom(state, { type: '成为目标', source, target, cardId });
    const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
    if (!valid) return;
    await applyAtom(state, { type: '询问闪', target, source });
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length > 0) {
      await applyAtom(state, { type: '被抵消', source, target, cardId });
      for (const dId of dodgeIds) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: dId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    } else {
      await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId });
    }
  } finally {
    await popFrame(state);
  }
}

/** 取玩家装备区的所有 cardId */
function equipCardIds(state: GameState, player: number): string[] {
  const p = state.players[player];
  if (!p) return [];
  return Object.values(p.equipment).filter((id): id is string => !!id);
}

/** 查 cardId 所在的装备槽 */
function slotOfEquip(state: GameState, player: number, cardId: string): EquipSlot | null {
  const p = state.players[player];
  if (!p) return null;
  for (const [slot, id] of Object.entries(p.equipment)) {
    if (id === cardId) return slot as EquipSlot;
  }
  return null;
}

/**
 * 把 srcPlayer 的装备牌 srcCardId 移动到 destPlayer 的对应空装备槽。
 * 使用 卸下→移动牌→装备→添加技能 序列(与 直谏 给他人装备的模式一致)。
 */
async function moveEquipmentCard(
  state: GameState,
  srcPlayer: number,
  srcCardId: string,
  destPlayer: number,
): Promise<boolean> {
  if (srcPlayer === destPlayer) return false;
  const srcP = state.players[srcPlayer];
  const destP = state.players[destPlayer];
  if (!srcP || !destP) return false;
  const srcSlot = slotOfEquip(state, srcPlayer, srcCardId);
  if (!srcSlot) return false;
  // 目标对应槽位必须为空(不得替换)
  if (destP.equipment[srcSlot]) return false;
  const card = state.cardMap[srcCardId];
  if (!card) return false;

  await pushFrame(state, '界神速/move', srcPlayer, { srcCardId, destPlayer });
  try {
    // 1. 卸下(装备→源玩家手牌)
    await applyAtom(state, { type: '卸下', player: srcPlayer, slot: srcSlot });
    // 2. 移动牌(源手牌→目标手牌)
    await applyAtom(state, {
      type: '移动牌',
      cardId: srcCardId,
      from: { zone: '手牌', player: srcPlayer },
      to: { zone: '手牌', player: destPlayer },
    });
    // 3. 装备(目标手牌→目标装备区)
    await applyAtom(state, { type: '装备', player: destPlayer, cardId: srcCardId });
    // 4. 若装备自带技能(以 card.name 作 skillId),动态挂载
    if (card.name && skillLoaders[card.name]) {
      await applyAtom(state, { type: '添加技能', player: destPlayer, skillId: card.name });
    }
  } finally {
    await popFrame(state);
  }
  return true;
}

/** 询问选择一个虚拟杀目标(其他存活角色) */
async function askKillTarget(state: GameState, ownerId: number, label: string): Promise<number | undefined> {
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

  // respond:处理所有 神速 相关的 confirm/target/equip/move 询问
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
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType ?? '';
      if (rt === OPT1_RT || rt === OPT2_RT || rt === OPT3_RT || rt === MOVE_CONFIRM_RT) {
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
      } else if (rt === MOVE_SRC_PLAYER_RT || rt === MOVE_DEST_PLAYER_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') {
          s.localVars[rt === MOVE_SRC_PLAYER_RT ? MOVE_SRC_PLAYER_KEY : MOVE_DEST_PLAYER_KEY] = t;
        }
      } else if (rt === MOVE_SRC_CARD_RT) {
        const cardIds = params.cardIds as string[] | undefined;
        const single = params.cardId as string | undefined;
        const id =
          (Array.isArray(cardIds) && cardIds.length > 0 ? cardIds[0] : undefined) ??
          (typeof single === 'string' ? single : undefined);
        if (id) s.localVars[MOVE_SRC_CARD_KEY] = id;
      }
    },
  );

  // ── 主逻辑:判定阶段 before-hook,统一询问并结算 ──────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type: string; player: number; phase: string };
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

      // 选项3:失1血+跳过弃牌
      let opt3 = false;
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPT3_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动界神速③?(失去1点体力,跳过弃牌,视为出杀)',
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
        // ── 界版新增:移动场上装备(发动神速时一次) ──
        // 条件:场上存在至少一张装备牌
        const anyEquipOnField = ctx.state.players.some(
          (p) => p.alive && equipCardIds(ctx.state, p.index).length > 0,
        );
        if (anyEquipOnField) {
          delete ctx.state.localVars[CONFIRMED_KEY];
          await applyAtom(ctx.state, {
            type: '请求回应',
            requestType: MOVE_CONFIRM_RT,
            target: ownerId,
            prompt: {
              type: 'confirm',
              title: '界神速:是否移动场上一张装备牌?',
              confirmLabel: '移动',
              cancelLabel: '不移动',
            },
            defaultChoice: false,
            timeout: 10,
          });
          if (ctx.state.localVars[CONFIRMED_KEY] === true) {
            // 选源玩家
            delete ctx.state.localVars[MOVE_SRC_PLAYER_KEY];
            await applyAtom(ctx.state, {
              type: '请求回应',
              requestType: MOVE_SRC_PLAYER_RT,
              target: ownerId,
              prompt: {
                type: 'choosePlayer',
                title: '界神速:选择装备所在的玩家',
                min: 1,
                max: 1,
                filter: (_view: GameView, t: number) =>
                  ctx.state.players[t]?.alive === true &&
                  equipCardIds(ctx.state, t).length > 0,
              },
              timeout: 15,
            });
            const srcPlayer = ctx.state.localVars[MOVE_SRC_PLAYER_KEY] as
              | number
              | undefined;
            delete ctx.state.localVars[MOVE_SRC_PLAYER_KEY];

            if (typeof srcPlayer === 'number') {
              // 选源装备牌
              delete ctx.state.localVars[MOVE_SRC_CARD_KEY];
              await applyAtom(ctx.state, {
                type: '请求回应',
                requestType: MOVE_SRC_CARD_RT,
                target: ownerId,
                prompt: {
                  type: 'distribute',
                  mode: 'select',
                  title: `界神速:选择 P${srcPlayer} 的一张装备牌移动`,
                  source: 'handAndEquip',
                  minTotal: 1,
                  maxTotal: 1,
                },
                timeout: 15,
              });
              const srcCardId = ctx.state.localVars[MOVE_SRC_CARD_KEY] as
                | string
                | undefined;
              delete ctx.state.localVars[MOVE_SRC_CARD_KEY];

              if (typeof srcCardId === 'string') {
                const srcSlot = slotOfEquip(ctx.state, srcPlayer, srcCardId);
                if (srcSlot) {
                  // 选目标玩家(对应槽位为空,且非源玩家)
                  delete ctx.state.localVars[MOVE_DEST_PLAYER_KEY];
                  await applyAtom(ctx.state, {
                    type: '请求回应',
                    requestType: MOVE_DEST_PLAYER_RT,
                    target: ownerId,
                    prompt: {
                      type: 'choosePlayer',
                      title: `界神速:选择目标玩家(将装备移到其空${srcSlot}槽)`,
                      min: 1,
                      max: 1,
                      filter: (_view: GameView, t: number) =>
                        t !== srcPlayer &&
                        ctx.state.players[t]?.alive === true &&
                        !ctx.state.players[t]?.equipment[srcSlot],
                    },
                    timeout: 15,
                  });
                  const destPlayer = ctx.state.localVars[MOVE_DEST_PLAYER_KEY] as
                    | number
                    | undefined;
                  delete ctx.state.localVars[MOVE_DEST_PLAYER_KEY];

                  if (typeof destPlayer === 'number') {
                    await moveEquipmentCard(ctx.state, srcPlayer, srcCardId, destPlayer);
                  }
                }
              }
            }
          }
        }

        // ── 逐项结算:付代价 → 虚拟杀(顺序①→②→③) ──
        // 每项独立付代价+出杀;若玩家中途死亡(opt③失血),后续项不再执行。

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

        // 选项3:加跳过弃牌标签 + 失去1点体力 → 虚拟杀(若仍存活)
        if (opt3 && self.alive) {
          await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_DISCARD_TAG });
          await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
          // 失去体力可能导致濒死;若玩家仍存活才执行虚拟杀
          if (self.alive) {
            const target = await askKillTarget(ctx.state, ownerId, '界神速③');
            if (typeof target === 'number' && ctx.state.players[target]?.alive) {
              await virtualKill(ctx.state, ownerId, target);
            }
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
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type: string; player: number; phase: string };
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
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type: string; player: number; phase: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '出牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(SKIP_PLAY_TAG)) return;
      return skipPhase(ctx.state, atom, SKIP_PLAY_TAG);
    },
  );

  // ── 跳过弃牌阶段:有标签 → skip(界版新增) ───────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type: string; player: number; phase: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '弃牌') return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(SKIP_DISCARD_TAG)) return;
      return skipPhase(ctx.state, atom, SKIP_DISCARD_TAG);
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
