// 飞军(王平·蜀·主动技,风林火山 hero/401 逐字):
//   出牌阶段限一次,你可以弃置一张牌,然后选择一项:
//   1.令一名手牌数大于你的角色交给你一张牌;
//   2.令一名装备区里牌数大于你的角色弃置一张装备区里的牌。
//
// 流程(主动技):
//   1. use action:出牌阶段弃置一张手牌(代价) + 限一次/回合
//   2. execute 内分步询问(均为 请求回应):
//      a. 选择效果(chooseOption):仅在有两个有效选项时询问;单一选项自动选定
//      b. 选择目标(choosePlayer):按选项过滤候选(手牌数/装备数 > owner)
//      c. 兵略触发:owner 有兵略且首次对该目标发动 → 摸两张(由飞军.ts 调用)
//      d. 效果执行:
//         - 选项1:目标从手牌选一张交给 owner(pickProcessingCard → 给予)
//         - 选项2:目标从装备区选一张弃置(pickProcessingCard → 弃置)
//
// 关键点:
//   - 每回合限一次:飞军/usedThisTurn(once-per-turn 工具)
//   - 选项有效性:弃代价牌后判定(弃牌使 owner 手牌减少 → 选项1候选只增不减)
//   - 目标比较:严格大于(排除自己——自己的牌数不可能 > 自己)
//   - 超时兜底:option 取首个有效;target 取首个候选;给牌/弃装备取目标第一张
//   - 兵略协调:飞军 execute 内检查 owner.skills.includes('兵略'),首次对目标摸两张,
//     目标记录在 owner.vars['兵略/已飞军目标'](整局,跨回合)。兵略.ts 仅提供元数据。
import type {
  Card,
  EquipSlot,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { registerAction, hasBlockingPending } from '../core/skill';
import type { SkillModule } from '../types';

// 请求类型(requestType 前缀 = skillId,见 T1)
const OPTION_RT = '飞军/option'; // owner:选择效果
const TARGET_RT = '飞军/target'; // owner:选择目标
const GIVE_RT = '飞军/giveCard'; // 目标(选项1):交出一张手牌
const DISCARD_EQUIP_RT = '飞军/discardEquip'; // 目标(选项2):弃置一张装备

// localVars keys
const OPTION_KEY = '飞军/option';
const TARGET_KEY = '飞军/target';
const GIVE_KEY = '飞军/giveCardId';
const DISCARD_EQUIP_KEY = '飞军/discardEquipCardId';

// player.vars:兵略已触发的目标列表(整局,跨回合)。由飞军.ts 写入并触发兵略效果。
const BINGLUE_TARGETS_KEY = '兵略/已飞军目标';

/** 计算玩家装备区牌数 */
function equipCount(equipment: Partial<Record<EquipSlot, string>>): number {
  return Object.values(equipment).filter((id) => !!id).length;
}

/** 将手牌 cardId 列表转为 pickProcessingCard 的 cards 字段 */
function handToCards(
  state: GameState,
  hand: string[],
): Array<{ cardId: string; cardName: string; suit: Card['suit']; rank: string }> {
  return hand
    .map((id) => {
      const c = state.cardMap[id];
      if (!c) return null;
      return { cardId: id, cardName: c.name, suit: c.suit, rank: c.rank };
    })
    .filter(
      (c): c is { cardId: string; cardName: string; suit: Card['suit']; rank: string } =>
        c !== null,
    );
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '飞军',
    description:
      '出牌阶段限一次,弃置一张牌,令一名手牌数大于你的角色交给你一张牌,或令一名装备区里牌数大于你的角色弃置一张装备',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use action:出牌阶段弃牌(代价)+ 后续分步询问 ──────────────
  const useUnload = registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, '飞军')) return '本回合已使用过飞军';
      const self = st.players[ownerId];
      if (!self?.alive) return '你已死亡';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return '请选择要弃置的牌';
      if (!self.hand.includes(cardId)) return '弃置的牌必须在手牌中';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const costCardId = params.cardId as string;

      // 限一次标记(防 dispatch 重入,必须在第一个 await 前)
      await markOncePerTurn(st, ownerId, '飞军');
      await pushFrame(st, '飞军', ownerId, { ...params });

      // ── 弃置代价牌 ──
      await applyAtom(st, {
        type: '弃置',
        player: ownerId,
        cardIds: [costCardId],
        voluntary: true,
      });

      const self = st.players[ownerId];
      if (!self?.alive) {
        await popFrame(st);
        return;
      }
      const ownerHandCount = self.hand.length;
      const ownerEquipCount = equipCount(self.equipment);

      // ── 选择效果:判定有效选项(弃牌后判定) ──
      const hasHandOption = st.players.some(
        (p) => p.index !== ownerId && p.alive && p.hand.length > ownerHandCount,
      );
      const hasEquipOption = st.players.some(
        (p) => p.index !== ownerId && p.alive && equipCount(p.equipment) > ownerEquipCount,
      );

      if (!hasHandOption && !hasEquipOption) {
        // 无有效选项:代价已付,效果落空
        await popFrame(st);
        return;
      }

      let option: string;
      if (hasHandOption && hasEquipOption) {
        // 两个选项均有效:询问 owner 选择
        delete st.localVars[OPTION_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: OPTION_RT,
          target: ownerId,
          prompt: {
            type: 'chooseOption',
            title: '飞军:选择一项',
            options: [
              { value: 'hand', label: '令一名手牌数大于你的角色交给你一张牌' },
              { value: 'equip', label: '令一名装备区里牌数大于你的角色弃置一张装备' },
            ],
          },
          timeout: 30,
        });
        option = (st.localVars[OPTION_KEY] as string | undefined) ?? 'hand'; // 超时兜底
        delete st.localVars[OPTION_KEY];
      } else {
        // 仅一个有效选项:自动选定
        option = hasHandOption ? 'hand' : 'equip';
      }

      // ── 选择目标:按选项过滤候选 ──
      const candidates: number[] = [];
      for (const p of st.players) {
        if (p.index === ownerId || !p.alive) continue;
        if (option === 'hand') {
          if (p.hand.length > ownerHandCount) candidates.push(p.index);
        } else {
          if (equipCount(p.equipment) > ownerEquipCount) candidates.push(p.index);
        }
      }

      if (candidates.length === 0) {
        await popFrame(st);
        return;
      }

      let target: number;
      if (candidates.length === 1) {
        target = candidates[0];
      } else {
        delete st.localVars[TARGET_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: TARGET_RT,
          target: ownerId,
          prompt: {
            type: 'choosePlayer',
            title:
              option === 'hand'
                ? '飞军:选择一名手牌数大于你的角色(交给你一张牌)'
                : '飞军:选择一名装备数大于你的角色(弃置一张装备)',
            min: 1,
            max: 1,
            candidates,
          },
          timeout: 30,
        });
        target = (st.localVars[TARGET_KEY] as number | undefined) ?? candidates[0]; // 超时兜底
        delete st.localVars[TARGET_KEY];
      }

      // ── 兵略触发:首次对该目标发动飞军 → 摸两张 ──
      // 兵略是锁定技,效果在飞军 execute 内触发(检查 owner 是否拥有兵略技能)
      if (st.players[ownerId]?.skills.includes('兵略')) {
        const binglueTargets =
          (st.players[ownerId].vars[BINGLUE_TARGETS_KEY] as number[] | undefined) ?? [];
        if (!binglueTargets.includes(target)) {
          st.players[ownerId].vars[BINGLUE_TARGETS_KEY] = [...binglueTargets, target];
          await applyAtom(st, { type: '摸牌', player: ownerId, count: 2 });
        }
      }

      // ── 效果执行 ──
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) {
        await popFrame(st);
        return;
      }

      if (option === 'hand') {
        // 选项1:目标从手牌选一张交给 owner
        if (targetPlayer.hand.length === 0) {
          await popFrame(st);
          return;
        }

        delete st.localVars[GIVE_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: GIVE_RT,
          target,
          prompt: {
            type: 'pickProcessingCard',
            title: `飞军:选择一张手牌交给 ${st.players[ownerId]?.name ?? '对方'}`,
            cards: handToCards(st, targetPlayer.hand),
          },
          timeout: 30,
        });

        let giveCardId = st.localVars[GIVE_KEY] as string | undefined;
        const targetHand = st.players[target]?.hand ?? [];
        if (!giveCardId || !targetHand.includes(giveCardId)) {
          giveCardId = targetHand[0]; // 超时兜底:交第一张
        }
        delete st.localVars[GIVE_KEY];

        if (giveCardId && targetHand.includes(giveCardId)) {
          await applyAtom(st, { type: '给予', cardId: giveCardId, from: target, to: ownerId });
        }
      } else {
        // 选项2:目标从装备区选一张弃置
        const equipIds = Object.values(targetPlayer.equipment).filter((id) => !!id);
        if (equipIds.length === 0) {
          await popFrame(st);
          return;
        }

        delete st.localVars[DISCARD_EQUIP_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: DISCARD_EQUIP_RT,
          target,
          prompt: {
            type: 'pickProcessingCard',
            title: '飞军:选择一张装备牌弃置',
            cards: handToCards(st, equipIds),
          },
          timeout: 30,
        });

        let discardCardId = st.localVars[DISCARD_EQUIP_KEY] as string | undefined;
        const currentEquips = Object.values(st.players[target]?.equipment ?? {}).filter(
          (id) => !!id,
        );
        if (!discardCardId || !currentEquips.includes(discardCardId)) {
          discardCardId = currentEquips[0]; // 超时兜底:弃第一张装备
        }
        delete st.localVars[DISCARD_EQUIP_KEY];

        if (discardCardId && currentEquips.includes(discardCardId)) {
          await applyAtom(st, {
            type: '弃置',
            player: target,
            cardIds: [discardCardId],
            voluntary: true,
          });
        }
      }

      await popFrame(st);
    },
  );
  unloaders.push(useUnload);

  // ── respond action:每个座次注册,处理所有飞军请求类型 ──
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as { type: string; requestType?: string };
        if (atom.type !== '请求回应') return '当前不需要回应';
        const rt = atom.requestType;
        if (rt === OPTION_RT) {
          if (params.option !== 'hand' && params.option !== 'equip') return '请选择一项';
          return null;
        }
        if (rt === TARGET_RT) {
          const t =
            (params.targets as number[] | undefined)?.[0] ??
            (typeof params.target === 'number' ? params.target : undefined);
          if (typeof t !== 'number') return '请选择目标';
          return null;
        }
        if (rt === GIVE_RT) {
          const cardId = params.cardId as string | undefined;
          if (!cardId) return '请选择一张手牌';
          if (!st.players[seatId].hand.includes(cardId)) return '牌不在手牌中';
          return null;
        }
        if (rt === DISCARD_EQUIP_RT) {
          const cardId = params.cardId as string | undefined;
          if (!cardId) return '请选择一张装备';
          if (!Object.values(st.players[seatId].equipment).includes(cardId))
            return '牌不在装备区';
          return null;
        }
        return '当前不是飞军询问';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(seatId);
        const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
        if (rt === OPTION_RT) {
          st.localVars[OPTION_KEY] = params.option;
        } else if (rt === TARGET_RT) {
          const t =
            (params.targets as number[] | undefined)?.[0] ??
            (typeof params.target === 'number' ? params.target : undefined);
          if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
        } else if (rt === GIVE_RT) {
          st.localVars[GIVE_KEY] = params.cardId;
        } else if (rt === DISCARD_EQUIP_RT) {
          st.localVars[DISCARD_EQUIP_KEY] = params.cardId;
        }
      },
    );
    unloaders.push(u);
  }

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '飞军',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '飞军:弃置一张牌,令手牌数或装备数多于你的角色交牌或弃装备',
      cardFilter: { min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      if (!activeUnlessUsedThisTurn('飞军')(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      if ((p.hand?.length ?? 0) === 0) return false; // 需要代价牌
      const ownerHand = p.handCount;
      const ownerEquip = Object.values(p.equipment ?? {}).filter((id) => !!id).length;
      const hasOption1 = ctx.view.players.some(
        (other) =>
          other.index !== skill.ownerId && other.alive && (other.handCount ?? 0) > ownerHand,
      );
      const hasOption2 = ctx.view.players.some((other) => {
        if (other.index === skill.ownerId || !other.alive) return false;
        return Object.values(other.equipment ?? {}).filter((id) => !!id).length > ownerEquip;
      });
      return hasOption1 || hasOption2;
    },
  });

  api.defineAction('respond', {
    label: '飞军',
    style: 'primary',
    prompt: {
      type: 'chooseOption',
      title: '飞军',
      options: [],
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
