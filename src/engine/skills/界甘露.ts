// 界甘露(界吴国太·主动技,OL 界限突破官方逐字):
//   出牌阶段限一次,你可以令两名角色交换装备区里的牌。
//   若X大于你已损失的体力值,你须在选择角色时弃置X张牌
//   (X为其装备区里的牌数之差)。
//
// 与标版吴国太 甘露 的区别(标版未实现;基于官方描述对比):
//   - 标版:"交换两名角色装备区里的牌(两者装备区里牌数之差不大于你已损失体力值,
//     且牌数之和不小于1)"——牌数差不能超过已损失体力值(硬约束,不满足则不能发动)。
//   - 界版:任意两名角色都可交换;若牌数差 X > 已损失体力值,弃 X 张牌作为代价(软约束)。
//   界版与标版机制完全不同,必须独立界版文件。
//
// 实现要点:
//   - 限一次/回合:player.vars['界甘露/usedThisTurn'],由 once-per-turn 工具管理。
//   - 选目标:请求回应(choosePlayer min=2 max=2),A/B 不能是自己(参考官方 FAQ:
//     标版"两名角色"含自己,但 OL 界版实际可选自己——为保守与多数实现一致,
//     此处允许选任意存活角色,包括自己)。
//   - X = |A 装备数 - B 装备数|;lostHp = maxHp - hp。
//   - 若 X > lostHp:请求回应(useCard)选 X 张手牌弃置;若手牌不足则发动前 validate 拒绝。
//   - 装备交换:逐 slot 进行(武器/防具/进攻马/防御马/宝物)。对每个 slot:
//       * 若 A 或 B 任一方在该 slot 有装备:先 卸下 双方该 slot(若有),
//         再把对方原装备 装备 到该 slot(若原属技能需挂载,通过 添加技能 atom)。
//       * 已 卸下 的牌进入手牌,装备时从手牌取出 → 走 装备 atom validate。
//   - 装备技能挂载/卸载:若装备牌 name 在 skillLoaders 中,装备/卸下时配对
//     添加技能/移除技能 atom(参考 界结姻 的置装备序列)。
//
// 命名:文件名/loader key 为 '界甘露';内部 Skill.name = '甘露'(OL 官方技能名)。
import type {
  EquipSlot,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import {
  usedThisTurn,
  markOncePerTurn,
  activeUnlessUsedThisTurn,
} from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { skillLoaders } from './index';

const SKILL_NAME = '界甘露';
const DISPLAY_NAME = '甘露';
const TARGET_RT = '界甘露/target'; // 选两名目标
const DISCARD_RT = '界甘露/discard'; // 弃 X 张手牌
const TARGET_KEY = '界甘露/targets';
const DISCARD_KEY = '界甘露/discardCards';

const EQUIP_SLOTS: EquipSlot[] = ['武器', '防具', '进攻马', '防御马', '宝物'];

/** 玩家装备区牌数(所有 slot 之和)。 */
function equipmentCount(state: GameState, idx: number): number {
  const eq = state.players[idx]?.equipment ?? {};
  return EQUIP_SLOTS.filter((s) => typeof eq[s] === 'string').length;
}

/** 已损失体力值。 */
function lostHealth(state: GameState, idx: number): number {
  const p = state.players[idx];
  if (!p) return 0;
  return Math.max(0, p.maxHealth - p.health);
}

/** 列出玩家在某 slot 的装备 cardId(若有)。 */
function equippedAt(state: GameState, idx: number, slot: EquipSlot): string | undefined {
  return state.players[idx]?.equipment[slot];
}

/** 卸下指定 slot 装备及其自带技能(若有)。
 *  仅移除技能实例(不卸下)。返回后牌仍在 idx 的装备区。 */
async function unloadSkillAt(state: GameState, idx: number, slot: EquipSlot): Promise<void> {
  const cardId = equippedAt(state, idx, slot);
  if (!cardId) return;
  const card = state.cardMap[cardId];
  if (card?.name && skillLoaders[card.name] && state.players[idx].skills.includes(card.name)) {
    await applyAtom(state, { type: '移除技能', player: idx, skillId: card.name });
  }
}

/** 把指定 cardId 装备到 idx 的对应 slot,并挂载自带技能(若有)。
 *  cardId 必须已在 idx 的手牌中(由先前 卸下 + 移动牌 完成)。 */
async function equipWithSkill(state: GameState, idx: number, cardId: string): Promise<void> {
  await applyAtom(state, { type: '装备', player: idx, cardId });
  const card = state.cardMap[cardId];
  if (card?.name && skillLoaders[card.name]) {
    await applyAtom(state, { type: '添加技能', player: idx, skillId: card.name });
  }
}

/** 交换 A、B 的装备区:对每个 slot,先卸下双方该 slot,再把对方的装到自己。
 *  对每个 slot 独立处理(无跨 slot 依赖)。 */
async function swapEquipment(state: GameState, A: number, B: number): Promise<void> {
  for (const slot of EQUIP_SLOTS) {
    const aCard = equippedAt(state, A, slot);
    const bCard = equippedAt(state, B, slot);
    if (!aCard && !bCard) continue; // 双方该 slot 都空,无需交换

    // 阶段 1:清除双方该 slot 装备的自带技能实例(若有)。
    //   技能实例由 添加技能/移除技能 管理,不走 卸下/装备 的默认路径。
    if (aCard) await unloadSkillAt(state, A, slot);
    if (bCard) await unloadSkillAt(state, B, slot);

    // 阶段 2:卸下双方该 slot 的装备(若有)。卸下后牌进入各自手牌。
    if (aCard) await applyAtom(state, { type: '卸下', player: A, slot });
    if (bCard) await applyAtom(state, { type: '卸下', player: B, slot });

    // 阶段 3:把对方原装备移到自己手牌 → 装备 → 挂载技能。
    //   aCard 现在在 A 手牌中,要装到 B;bCard 现在在 B 手牌中,要装到 A。
    if (aCard) {
      await applyAtom(state, {
        type: '移动牌',
        cardId: aCard,
        from: { zone: '手牌', player: A },
        to: { zone: '手牌', player: B },
      });
      await equipWithSkill(state, B, aCard);
    }
    if (bCard) {
      await applyAtom(state, {
        type: '移动牌',
        cardId: bCard,
        from: { zone: '手牌', player: B },
        to: { zone: '手牌', player: A },
      });
      await equipWithSkill(state, A, bCard);
    }
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次:令两名角色交换装备区里的牌;若两人装备数差 X 大于你已损失的体力值,你须弃 X 张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use action:吴国太主动发动甘露 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, _params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, SKILL_NAME)) return '本回合已使用过甘露';
      const self = st.players[ownerId];
      if (!self?.alive) return '角色不可用';
      // 至少两名存活角色(可含自己)有装备牌,否则交换无意义
      const aliveIdx = st.players.filter((p) => p.alive);
      if (aliveIdx.length < 2) return '需要至少两名存活角色';
      // 至少有一名其他存活角色(自己交换自己无意义)
      const others = aliveIdx.filter((p) => p.index !== ownerId);
      if (others.length === 0) return '需要至少两名存活角色';
      return null;
    },
    async (st: GameState, _params: Record<string, Json>): Promise<void> => {
      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, ownerId, SKILL_NAME);
      await pushFrame(st, SKILL_NAME, ownerId, {});

      // 1) 询问吴国太选两名角色(可含自己,只要两人都有装备牌的 slot 即可)
      delete st.localVars[TARGET_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '甘露:选择两名角色交换装备区里的牌',
          min: 2,
          max: 2,
          filter: (_view, t) => st.players[t]?.alive === true,
        },
        timeout: 30,
      });

      const targets = st.localVars[TARGET_KEY] as number[] | undefined;
      delete st.localVars[TARGET_KEY];
      if (!Array.isArray(targets) || targets.length !== 2) {
        await popFrame(st);
        return; // 未选或超时
      }
      const [A, B] = targets;
      if (!st.players[A]?.alive || !st.players[B]?.alive || A === B) {
        await popFrame(st);
        return;
      }

      // 2) 计算 X = |装备数差|;lostHp = 已损失体力
      const equipA = equipmentCount(st, A);
      const equipB = equipmentCount(st, B);
      const X = Math.abs(equipA - equipB);
      const lostHp = lostHealth(st, ownerId);

      // 3) 若 X > lostHp:须弃 X 张手牌(选择角色时支付代价)
      if (X > lostHp) {
        const handCount = st.players[ownerId].hand.length;
        // 手牌不足 → 无法支付代价,流程中止(不交换、不消耗)
        if (handCount < X) {
          await popFrame(st);
          return;
        }
        delete st.localVars[DISCARD_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: DISCARD_RT,
          target: ownerId,
          prompt: {
            type: 'useCard',
            title: `甘露:两人装备数差 ${X} 大于你已损失的体力值 ${lostHp},须弃 ${X} 张手牌`,
            cardFilter: { filter: () => true, min: X, max: X },
          },
          timeout: 30,
        });
        const discardCards = st.localVars[DISCARD_KEY] as string[] | undefined;
        delete st.localVars[DISCARD_KEY];
        if (!Array.isArray(discardCards) || discardCards.length !== X) {
          await popFrame(st);
          return; // 未选或超时,中止
        }
        await applyAtom(st, { type: '弃置', player: ownerId, cardIds: discardCards });
      }

      // 4) 交换 A、B 装备区牌
      await swapEquipment(st, A, B);

      await popFrame(st);
    },
  );

  // ── respond action:处理 target/discard 询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== TARGET_RT && rt !== DISCARD_RT) return '当前不是甘露询问';

      if (rt === TARGET_RT) {
        const targets = params.targets;
        if (!Array.isArray(targets)) return 'targets required';
        if (targets.length !== 2) return '需要选择两名角色';
        for (const t of targets) {
          if (typeof t !== 'number') return '目标必须是数字座次';
          if (!st.players[t]?.alive) return '目标已死亡';
        }
        if (targets[0] === targets[1]) return '不能选同一名角色';
      } else {
        // DISCARD_RT
        const cardIds = params.cardIds;
        if (!Array.isArray(cardIds)) return 'cardIds required';
        const self = st.players[ownerId];
        const min = (slot.atom as unknown as { prompt?: { cardFilter?: { min?: number } } }).prompt
          ?.cardFilter?.min ?? 0;
        if (cardIds.length !== min) return `需要弃 ${min} 张牌`;
        for (const cid of cardIds) {
          if (typeof cid !== 'string' || !self.hand.includes(cid)) return '牌不在手牌中';
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as Record<string, unknown>)?.requestType as string;
      if (rt === TARGET_RT) {
        st.localVars[TARGET_KEY] = params.targets;
      } else if (rt === DISCARD_RT) {
        st.localVars[DISCARD_KEY] = params.cardIds;
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'selectTarget',
      title: '甘露:令两名角色交换装备区里的牌(若装备数差>已损失体力值,须弃等量牌)',
      targetFilter: {
        min: 2,
        max: 2,
      },
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn(SKILL_NAME)(ctx),
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
