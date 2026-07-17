// 界结姻(界孙尚香·主动技·OL 界限突破版):
//   出牌阶段限一次,你可以选择一名男性角色,弃置一张手牌或将一张装备牌置入其装备区,
//   然后你与其中体力值较大的角色摸一张牌,体力值较小的角色回复1点体力。
//
// OL 界限突破差异(相对标 结姻 src/engine/skills/结姻.ts):
//   1. **目标放宽**:任意男性角色(不要求"已受伤")。孙尚香为女性,性别检查天然排除自身。
//   2. **代价二选一**:弃置一张手牌 或 将一张装备牌置入目标的装备区(可替换原装备)。
//   3. **效果双向比较**:你与目标中体力值较大者摸1张,较小者回复1点体力(双方都参与)。
//      标版仅"目标回复1点",界版改为按体力比较分配。
//   4. 仍为出牌阶段限一次。
//
// 裁定(体力相等,官方未明确):
//   - 体力相等时,既无"较大者"也无"较小者",按字面:双方均不摸牌、不回血(本技能仅消耗代价)。
//     保守且符合描述字面。在测试与发动日志中均如此处理。
//
// 关键点:
//   - 限一次/回合:用 player.vars['界结姻/usedThisTurn'] 标记,回合用量 atom 同步到 view。
//   - 代价 A(弃手牌):弃置任意一张手牌。
//   - 代价 B(置装备):手牌中一张装备牌置入目标对应栏位;目标已有同栏位装备则替换
//     (移除旧技能 → 卸下 → 旧装备入弃牌堆 → 装备新 → 添加新技能),替换会触发目标"失去装备"类技能。
//   - 效果比较在代价支付后进行(代价不改变体力,故与发动前等价)。
//   - 回复体力不能超过体力上限:回复体力 atom.apply 已 Math.min 限制,无需技能处理。
//
// 前端交互:选择一名男性目标 + 选择代价方式(弃手牌/置装备)+ 选择对应一张牌 → 提交。
//   兼容简单格式(测试/headless 直发):
//     { cost: '弃手牌', target, cardIds: [id] }   或 { cost: '弃手牌', target, cardId }
//     { cost: '置装备', target, cardId }           (cardId 为手牌中的装备牌)
import type { EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { getGender } from '../character-meta';
import { skillLoaders } from './index';

const SKILL_NAME = '界结姻';
type CostMode = '弃手牌' | '置装备';

/** 装备牌 subtype → 装备栏位 */
function slotOf(card: { subtype?: string } | undefined): EquipSlot | null {
  switch (card?.subtype) {
    case '武器':
      return '武器';
    case '防具':
      return '防具';
    case '进攻马':
      return '进攻马';
    case '防御马':
      return '防御马';
    case '宝物':
      return '宝物';
    default:
      return null;
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_NAME,
    description:
      '出牌阶段限一次:选一名男性角色,弃一张手牌或置一张装备牌入其装备区,体力大者摸1张,小者回1点',
  };
}

/** 校验某座次是否为合法界结姻目标:存活 + 男性。 */
function isValidTarget(state: GameState, target: number): boolean {
  const p = state.players[target];
  if (!p?.alive) return false;
  return getGender(p.character) === '男';
}

/** 从 params 规范化出 { cost, cardId, target }。 */
function resolveParams(
  params: Record<string, Json>,
): { cost: CostMode; cardId: string; target: number } | null {
  const target = params.target as number | undefined;
  if (typeof target !== 'number') return null;
  const cost = params.cost as CostMode | undefined;
  if (cost === '弃手牌') {
    const id =
      Array.isArray(params.cardIds) && params.cardIds.length > 0
        ? (params.cardIds[0] as string)
        : (params.cardId as string | undefined);
    if (typeof id !== 'string') return null;
    return { cost, cardId: id, target };
  }
  if (cost === '置装备') {
    const id = params.cardId as string | undefined;
    if (typeof id !== 'string') return null;
    return { cost, cardId: id, target };
  }
  return null;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      const self = state.players[ownerId];
      if (!self?.alive) return '角色不可用';
      if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (state.phase !== '出牌') return '不是出牌阶段';
      if (hasBlockingPending(state)) return '当前有未回应的询问';
      if (usedThisTurn(state, ownerId, SKILL_NAME)) return '本回合已使用过界结姻';
      // 两种代价都需要一张手牌
      if (self.hand.length < 1) return '手牌不足一张';

      const resolved = resolveParams(params);
      if (!resolved) return '需要选择代价(弃手牌或置装备)、一张牌和一名男性目标';
      const { cost, cardId, target } = resolved;
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      if (!isValidTarget(state, target)) return '目标必须是男性角色';
      if (cost === '置装备') {
        const card = state.cardMap[cardId];
        if (card?.type !== '装备牌') return '置装备代价必须是一张装备牌';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const resolved = resolveParams(params);
      if (!resolved) return; // validate 已保证非空,防御
      const { cost, cardId, target } = resolved;

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(state, ownerId, SKILL_NAME);
      await pushFrame(state, SKILL_NAME, ownerId, { cost, cardId, target });

      // ── 代价 ──
      if (cost === '弃手牌') {
        await applyAtom(state, { type: '弃置', player: ownerId, cardIds: [cardId] });
      } else {
        // 置装备:把装备牌交到目标手中,再装备到目标(可替换原装备)
        const card = state.cardMap[cardId];
        const slot = slotOf(card)!;
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '手牌', player: ownerId },
          to: { zone: '手牌', player: target },
        });
        const currentEquip = state.players[target].equipment[slot];
        if (currentEquip) {
          const oldCard = state.cardMap[currentEquip];
          if (oldCard?.name && skillLoaders[oldCard.name]) {
            await applyAtom(state, { type: '移除技能', player: target, skillId: oldCard.name });
          }
          await applyAtom(state, { type: '卸下', player: target, slot });
          await applyAtom(state, {
            type: '移动牌',
            cardId: currentEquip,
            from: { zone: '手牌', player: target },
            to: { zone: '弃牌堆' },
          });
        }
        await applyAtom(state, { type: '装备', player: target, cardId });
        if (card?.name && skillLoaders[card.name]) {
          await applyAtom(state, { type: '添加技能', player: target, skillId: card.name });
        }
      }

      // ── 效果:体力值比较(代价不改变体力,故与发动前等价)──
      const ownerHealth = state.players[ownerId].health;
      const targetHealth = state.players[target].health;
      if (ownerHealth > targetHealth) {
        // 自己摸1,目标回1
        await applyAtom(state, { type: '摸牌', player: ownerId, count: 1 });
        await applyAtom(state, { type: '回复体力', target, amount: 1, source: ownerId });
      } else if (ownerHealth < targetHealth) {
        // 目标摸1,自己回1
        await applyAtom(state, { type: '摸牌', player: target, count: 1 });
        await applyAtom(state, { type: '回复体力', target: ownerId, amount: 1, source: ownerId });
      }
      // 体力相等:字面无"较大/较小"者,双方均不结算额外效果(已注裁定)

      await popFrame(state);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: SKILL_NAME,
    style: 'primary',
    prompt: {
      type: 'selectTarget',
      title: '界结姻:选一名男性角色,弃一张手牌或置一张装备牌入其装备区(体力大者摸1,小者回1)',
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, target) => {
          const p = view.players[target];
          if (!p || p.alive === false) return false;
          return getGender(p.character) === '男';
        },
      },
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn(SKILL_NAME)(ctx),
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
