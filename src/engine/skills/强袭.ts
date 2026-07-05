// 强袭(典韦·主动技):出牌阶段,你可以自减 1 点体力或弃一张武器牌,
// 对攻击范围内的一名角色造成 1 点伤害。每回合限一次。
//
// 模式 B(主动技):registerAction 'use'。
//   参数:{ cost: 'hp' | 'discard', target: number, cardId?: string }
//   - cost 'hp':自减 1 点体力(失去体力,非伤害——不触发防具/反馈)。
//   - cost 'discard':弃一张武器牌(手牌或装备区武器)。
//   - 对 target 造成 1 点伤害(来源为典韦,强制伤害,不可被闪抵消)。
//
// 距离规则(FAQ):弃装备区武器发动时,武器移除后出杀范围回到 1,
//   故此时 target 须在距离 1 以内;弃手牌武器或自减体力则用当前攻击范围。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, hasBlockingPending } from '../skill';
import { inAttackRange, effectiveDistance } from '../distance';
import { defaultPlayActive } from '../action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '强袭',
    description: '出牌阶段:自减 1 体力或弃一张武器牌,对攻击范围内一名角色造成 1 点伤害',
  };
}

/** 是否为武器牌 */
function isWeaponCard(card: { type?: string; subtype?: string } | undefined): boolean {
  return !!card && card.type === '装备牌' && card.subtype === '武器';
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
      const self = st.players[ownerId];
      if (!self?.alive) return '已死亡';
      if (self.vars['强袭/usedThisTurn']) return '本回合已使用过强袭';

      const cost = params.cost;
      if (cost !== 'hp' && cost !== 'discard') return 'cost 必须为 hp 或 discard';
      const target = params.target;
      if (typeof target !== 'number') return '需要指定目标';
      if (target === ownerId) return '不能以自己为目标';
      if (!st.players[target]?.alive) return '目标不合法';

      // 攻击范围校验:弃装备区武器时,武器移除后范围回到 1(FAQ)。
      const equippedWeaponId = self.equipment['武器'];
      const discardingEquipped =
        cost === 'discard' &&
        typeof params.cardId === 'string' &&
        equippedWeaponId === params.cardId;
      const inRange = discardingEquipped
        ? effectiveDistance(st, ownerId, target) <= 1
        : inAttackRange(st, ownerId, target);
      if (!inRange) return '目标不在攻击范围内';

      if (cost === 'discard') {
        const cardId = params.cardId;
        if (typeof cardId !== 'string') return '弃武器需要 cardId';
        const card = st.cardMap[cardId];
        if (!isWeaponCard(card)) return '不是武器牌';
        const inHand = self.hand.includes(cardId);
        const inEquip = equippedWeaponId === cardId;
        if (!inHand && !inEquip) return '武器不在手牌或装备区';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;
      const cost = params.cost as 'hp' | 'discard';

      // 同步设限一次标记(防 dispatch 重入,见制衡.ts 注释),并投影到 view。
      st.players[from].vars['强袭/usedThisTurn'] = true;
      await applyAtom(st, {
        type: '回合用量',
        player: from,
        key: '强袭/usedThisTurn',
        value: true,
      });

      await pushFrame(st, '强袭', from, { ...params });

      // 代价
      if (cost === 'hp') {
        await applyAtom(st, { type: '失去体力', target: from, amount: 1 });
      } else {
        const cardId = params.cardId as string;
        // 装备区武器先卸下(清距离 vars + 回手),再弃置;手牌武器直接弃置。
        if (st.players[from].equipment['武器'] === cardId) {
          await applyAtom(st, { type: '卸下', player: from, slot: '武器' });
        }
        await applyAtom(st, { type: '弃置', player: from, cardIds: [cardId] });
      }

      // 造成 1 点伤害(来源为典韦)
      await applyAtom(st, { type: '造成伤害', target, amount: 1, source: from });
      await popFrame(st);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '强袭',
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '强袭:选择攻击范围内一名角色(自减 1 体力或弃武器造成 1 伤害)',
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, target) => {
          const me = view.currentPlayerIndex;
          if (target === me) return false;
          // 前端 UI 提示:当前攻击范围内(实际代价由后端 validate 校验)
          const p = view.players.find((pl) => pl.index === me);
          if (!p) return false;
          return view.players.some(
            (pl) => pl.index === target && pl.alive !== false,
          );
        },
      },
    },
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) &&
      !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.['强袭/usedThisTurn'],
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
