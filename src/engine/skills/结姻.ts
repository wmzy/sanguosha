// 结姻(孙尚香·主动技):
//   出牌阶段限一次,你可以弃置两张手牌,然后令一名已受伤的男性角色回复1点体力。
//
// 规则要点(描述备注 + FAQ):
//   - 限一次/回合:用 player.vars['结姻/usedThisTurn'] 标记,回合用量 atom 同步到 view。
//   - 只能弃手牌(描述明确"两张手牌");装备区牌不可。
//   - 目标必须是「已受伤的男性角色」:受伤(health<maxHealth)+ 男性(gender==='男')+ 存活。
//     孙尚香本人为女性,自身不可能成为合法目标(性别检查天然排除)。
//   - 回复体力不能超过体力上限:回复体力 atom.apply 已 Math.min 限制,无需技能处理。
//
// 前端交互:select 2 张手牌 + 选 1 名已受伤男性目标 → distribute/allocate 提交 allocation。
//   兼容简单格式 cardIds + target(测试/headless 直发)。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { getGender } from '../character-meta';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '结姻',
    description: '出牌阶段限一次,弃两张手牌,令一名已受伤的男性角色回复1点体力',
  };
}

/** 校验某座次是否为合法结姻目标:存活 + 已受伤 + 男性。 */
function isValidTarget(state: GameState, target: number): boolean {
  const p = state.players[target];
  if (!p?.alive) return false;
  if (p.health >= p.maxHealth) return false; // 已受伤 = health < maxHealth
  return getGender(p.character) === '男';
}

/** 从 params 规范化出 { cardIds, target }。
 *  支持三种格式:
 *   1. distribute/allocate: params.allocation = [{target, cardIds}]
 *   2. 简单: params.cardIds = [...] + params.target = idx
 *   3. 单卡兼容(不适用于结姻,需 2 张): params.cardId + params.target */
function resolveParams(
  params: Record<string, Json>,
): { cardIds: string[]; target: number } | null {
  const allocation = params.allocation as Array<{ target: number; cardIds: string[] }> | undefined;
  if (Array.isArray(allocation) && allocation.length > 0) {
    // 合并所有条目的牌(结姻只取 1 个目标,但允许分配 UI 产生单条目)
    const cardIds = allocation.flatMap((a) => a.cardIds);
    const target = allocation[0].target;
    return { cardIds, target };
  }
  const cardIds = params.cardIds as string[] | undefined;
  const target = params.target as number | undefined;
  if (Array.isArray(cardIds) && typeof target === 'number') {
    return { cardIds, target };
  }
  return null;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      const self = state.players[ownerId];
      if (!self?.alive) return '角色不可用';
      // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending
      if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (state.phase !== '出牌') return '不是出牌阶段';
      if (hasBlockingPending(state)) return '当前有未回应的询问';
      // 限一次/回合
      if (self.vars['结姻/usedThisTurn']) return '本回合已使用过结姻';
      // 手牌不少于 2
      if (self.hand.length < 2) return '手牌不足两张';

      const resolved = resolveParams(params);
      if (!resolved) return '需要选择两张手牌和一名目标';
      const { cardIds, target } = resolved;
      // 恰好 2 张
      if (cardIds.length !== 2) return '必须弃置两张手牌';
      // 都在手中且不重复
      const set = new Set(cardIds);
      if (set.size !== 2) return '不能弃置相同的牌';
      if (!cardIds.every((id) => self.hand.includes(id))) return '牌不在手牌中';
      // 目标合法
      if (!isValidTarget(state, target)) return '目标必须是已受伤的男性角色';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const resolved = resolveParams(params);
      if (!resolved) return; // validate 已保证非空,防御
      const { cardIds, target } = resolved;
      // [时序修复] 限一次标记必须在第一个 await 之前设置,防 dispatch 重入(同制衡)
      state.players[ownerId].vars['结姻/usedThisTurn'] = true;
      await applyAtom(state, {
        type: '回合用量',
        player: ownerId,
        key: '结姻/usedThisTurn',
        value: true,
      });
      await pushFrame(state, '结姻', ownerId, { cardIds, target });
      // 1. 弃置两张手牌
      await applyAtom(state, { type: '弃置', player: ownerId, cardIds });
      // 2. 令目标回复 1 点体力(回复体力 atom 限制不超过上限)
      await applyAtom(state, { type: '回复体力', target, amount: 1, source: ownerId });
      await popFrame(state);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '结姻',
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'allocate',
      title: '结姻：弃两张手牌,令一名已受伤的男性角色回复1点体力',
      source: 'hand',
      minTotal: 2,
      maxTotal: 2,
      minPerTarget: 2,
      maxPerTarget: 2,
      allowSelf: false,
      targetFilter: (view, target) => {
        const p = view.players[target];
        if (!p || p.alive === false) return false;
        if ((p.health ?? 0) >= (p.maxHealth ?? 0)) return false;
        return getGender(p.character) === '男';
      },
    },
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) &&
      !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.['结姻/usedThisTurn'],
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
