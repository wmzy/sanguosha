// 强袭(典韦·主动技,标版官方逐字):
//   出牌阶段限两次,你可以失去1点体力或弃置一张武器牌,
//   对一名本回合内未以此法指定过的其他角色造成1点伤害。
//
// 模式 B(主动技):registerAction 'use'。
//   参数:{ cost: 'hp' | 'discard', target: number, cardId?: string }
//   - cost 'hp':失去 1 点体力(失去体力,非伤害——不触发防具/反馈)。
//   - cost 'discard':弃一张武器牌(手牌或装备区武器)。
//   - 对 target 造成 1 点伤害(来源为典韦,强制伤害,不可被闪抵消)。
//
// 实现要点:
//   - 计数限两次:player.vars['强袭/usedThisTurn'] 存数字(1/2),沿用 /usedThisTurn 后缀
//     由「回合结束」atom 自动清空。每次发动 +1,通过「回合用量」atom 同步 view.turnUsage。
//   - 目标去重:player.vars['强袭/targets/usedThisTurn'] 存已指定目标数组(本回合),
//     后缀 /usedThisTurn → 回合结束自动清空。每次发动后追加本次目标,通过「回合用量」
//     atom 同步 view.turnUsage 供前端 targetFilter 过滤已指定目标。
//   - 官方未提距离限制,故不再校验目标是否在攻击范围内。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { runDamageFlow } from '../damage-flow';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

const SKILL_ID = '强袭';
/** 数字计数(1/2);沿用 /usedThisTurn 后缀由「回合结束」atom 自动清空。 */
const COUNT_KEY = `${SKILL_ID}/usedThisTurn`;
/** 本回合已以此法指定过的目标数组;后缀 /usedThisTurn → 回合结束自动清空。 */
const TARGETS_KEY = `${SKILL_ID}/targets/usedThisTurn`;
const MAX_USES = 2;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description:
      '出牌阶段限两次:失去1点体力或弃一张武器牌,对一名本回合未以此法指定过的其他角色造成1点伤害',
  };
}

/** 是否为武器牌 */
function isWeaponCard(card: { type?: string; subtype?: string } | undefined): boolean {
  return !!card && card.type === '装备牌' && card.subtype === '武器';
}

/** 本回合已发动次数(0/1/2)。 */
function usesThisTurn(state: GameState, ownerId: number): number {
  const v = state.players[ownerId]?.vars[COUNT_KEY];
  return typeof v === 'number' ? v : 0;
}

/** 本回合已以此法指定过的目标列表。 */
function usedTargets(state: GameState, ownerId: number): number[] {
  const v = state.players[ownerId]?.vars[TARGETS_KEY];
  return Array.isArray(v) ? (v as number[]) : [];
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>) => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '不是出牌阶段';
      if (hasBlockingPending(st)) return '当前有未回应的询问';
      if (usesThisTurn(st, ownerId) >= MAX_USES) return '本阶段强袭已达上限(2次)';
      const self = st.players[ownerId];
      if (!self?.alive) return '已死亡';

      const cost = params.cost;
      if (cost !== 'hp' && cost !== 'discard') return 'cost 必须为 hp 或 discard';
      const target = params.target;
      if (typeof target !== 'number') return '需要指定目标';
      if (target === ownerId) return '不能以自己为目标';
      if (!st.players[target]?.alive) return '目标不合法';
      // 关键去重:本回合已以此法指定过的目标不可再指定
      if (usedTargets(st, ownerId).includes(target)) return '本回合已对此角色发动过强袭';

      if (cost === 'discard') {
        const cardId = params.cardId;
        if (typeof cardId !== 'string') return '弃武器需要 cardId';
        const card = st.cardMap[cardId];
        if (!isWeaponCard(card)) return '不是武器牌';
        const inHand = self.hand.includes(cardId);
        const equippedWeaponId = self.equipment['武器'];
        const inEquip = equippedWeaponId === cardId;
        if (!inHand && !inEquip) return '武器不在手牌或装备区';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;
      const cost = params.cost as 'hp' | 'discard';

      // 计数 +1(同步设 vars + 回合用量 atom 投影 view,防 dispatch 重入)。
      // 必须在第一个 await 之前设置,以防 dispatch 重入(见制衡.ts 注释)。
      const nextCount = usesThisTurn(st, from) + 1;
      st.players[from].vars[COUNT_KEY] = nextCount;
      await applyAtom(st, { type: '回合用量', player: from, key: COUNT_KEY, value: nextCount });

      // 目标去重:记录本次指定的目标(同步设 vars + 回合用量 atom 投影 view)
      const nextTargets = [...usedTargets(st, from), target];
      st.players[from].vars[TARGETS_KEY] = nextTargets;
      await applyAtom(st, {
        type: '回合用量',
        player: from,
        key: TARGETS_KEY,
        value: nextTargets as unknown as Json,
      });

      await pushFrame(st, SKILL_ID, from, { ...params });

      // 代价
      if (cost === 'hp') {
        // 标版官方:"失去1点体力"——非伤害事件,不触发防具/反馈
        await applyAtom(st, { type: '失去体力', target: from, amount: 1 });
      } else {
        const cardId = params.cardId as string;
        // 装备区武器先卸下(清距离 vars + 回手),再弃置;手牌武器直接弃置。
        if (st.players[from].equipment['武器'] === cardId) {
          await applyAtom(st, { type: '卸下', player: from, slot: '武器' });
        }
        await applyAtom(st, { type: '弃置', player: from, cardIds: [cardId] });
      }

      // 对 target 造成 1 点伤害(来源为典韦,强制伤害,不可被闪抵消)
      await runDamageFlow(st, from, target, 1);
      await popFrame(st);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: SKILL_ID,
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '强袭:选择一名本回合未以此法指定过的角色(失去1点体力或弃武器,对其造成1点伤害)',
      description: '本阶段限两次;每名角色每回合仅能被指定一次',
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, target) => {
          const me = view.currentPlayerIndex;
          if (target === me) return false;
          const tp = view.players.find((pl) => pl.index === target);
          if (!tp || tp.alive === false) return false;
          // 关键:过滤掉本回合已以此法指定过的目标(前端 UI 提示,后端 validate 独立校验)
          const used = view.players[me]?.turnUsage?.[TARGETS_KEY];
          const usedList = Array.isArray(used) ? (used as number[]) : [];
          if (usedList.includes(target)) return false;
          return true;
        },
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const used = ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[COUNT_KEY];
      return (typeof used === 'number' ? used : 0) < MAX_USES;
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
