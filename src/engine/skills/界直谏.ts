// 界直谏(界张昭张纮·吴·主动技·OL 界限突破版):
//   出牌阶段,你可以将一张装备牌置入一名其他角色的装备区(可替换原装备),然后摸一张牌。
//
// OL 界限突破差异(相对标 直谏 src/engine/skills/直谏.ts):
//   1. **可替换原装备**:目标对应栏位已有装备时,先弃置原装备再装新装备(替换语义)。
//      标版"不得替换"(栏位必须为空)的限制在界版取消。
//   2. 无"使用装备牌时摸牌"被动(那是移动版 msgs 的界直谏,不是 OL 版)。
//   3. 主动效果摸牌(1 张)与标版一致。
//
// 关键点:
//   - 主动 use:把装备牌移动牌到目标手牌,再装备到目标(不能复用 装备通用.use,它绑定 ownerId)。
//   - 替换原装备流程与 装备通用 一致:移除旧装备技能 → 卸下 → 移动牌(旧装备入弃牌堆)→ 装备新 → 添加新技能。
//     替换会触发目标"失去装备"相关技能(如枭姬),这是预期行为。
//   - 无次数限制。
//   - 装备到目标的 装备 atom player=目标,不会触发任何"自己使用装备"的被动(本技能也无此被动)。
import type { EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { skillLoaders } from './index';

const SKILL_NAME = '界直谏';

/** 装备牌 subtype → 装备栏位(与 装备 atom 的 inferSlot 一致) */
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
    description: '出牌阶段:将一张装备牌置入一名其他角色的装备区(可替换原装备),然后摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>) => {
      // 通用合法条件
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      const self = st.players[ownerId];
      if (!self?.alive) return '你已死亡';

      // 参数:cardId + target(targets[0] 或 target)
      if (typeof params.cardId !== 'string') return '需要选择一张装备牌';
      if (!self.hand.includes(params.cardId)) return '牌不在手牌中';
      const card = st.cardMap[params.cardId];
      if (card?.type !== '装备牌') return '只能使用装备牌';
      const slot = slotOf(card);
      if (!slot) return '无效的装备牌';

      const target =
        Array.isArray(params.targets) && typeof params.targets[0] === 'number'
          ? params.targets[0]
          : typeof params.target === 'number'
            ? params.target
            : undefined;
      if (target === undefined) return '需要指定一名目标';
      if (target === ownerId) return '不能对自己使用界直谏';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不合法';

      // OL 版:可替换原装备,故不检查目标栏位是否为空。
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const target =
        Array.isArray(params.targets) && typeof params.targets[0] === 'number'
          ? params.targets[0]
          : (params.target as number);
      const card = st.cardMap[cardId];
      const slot = slotOf(card)!;

      await pushFrame(st, SKILL_NAME, ownerId, { ...params });
      // 1. 把装备牌交到目标手中(装备 atom 要求 cardId 在目标手牌中)
      await applyAtom(st, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '手牌', player: target },
      });
      // 2. 若目标对应栏位已有装备 → 替换:移除旧装备技能 → 卸下 → 旧装备入弃牌堆
      //    (与 装备通用 替换语义一致;会触发目标"失去装备"类技能如枭姬,属预期)
      const currentEquip = st.players[target].equipment[slot];
      if (currentEquip) {
        const oldCard = st.cardMap[currentEquip];
        if (oldCard?.name && skillLoaders[oldCard.name]) {
          await applyAtom(st, { type: '移除技能', player: target, skillId: oldCard.name });
        }
        await applyAtom(st, { type: '卸下', player: target, slot });
        await applyAtom(st, {
          type: '移动牌',
          cardId: currentEquip,
          from: { zone: '手牌', player: target },
          to: { zone: '弃牌堆' },
        });
      }
      // 3. 装备到目标(从目标手牌移入目标装备区)
      await applyAtom(st, { type: '装备', player: target, cardId });
      // 4. 若装备自带技能(以 card.name 作 skillId),动态挂载(与 装备通用 一致)
      if (card?.name && skillLoaders[card.name]) {
        await applyAtom(st, { type: '添加技能', player: target, skillId: card.name });
      }
      // 5. 摸一张牌
      await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
      await popFrame(st);
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: SKILL_NAME,
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '界直谏:将一张装备牌置入一名其他角色的装备区(可替换原装备)',
      cardFilter: { filter: (c) => c.type === '装备牌', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, target) => {
          const me = view.viewer;
          if (target === me) return false;
          return view.players[target]?.alive === true;
        },
      },
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
