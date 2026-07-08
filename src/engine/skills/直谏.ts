// 直谏(张昭张纮·吴·主动技):出牌阶段,你可以将手牌中的一张装备牌置于一名其他角色的
// 装备区(不得替换原装备),然后摸一张牌。
//
// 实现(registerAction use):
//   1. validate:自己回合 + 出牌阶段 + 无阻塞 pending + 存活 + 手牌中有装备牌 +
//      目标为其他存活角色 + 目标对应装备栏位为空(不得替换)
//   2. execute:移动牌(自己手牌→目标手牌)→ 装备(目标)→ 添加技能(装备自带技能)→ 摸牌(1)
//
// 关键点:
//   - 装备 atom 的 validate 要求 cardId 在目标手牌中,故先把装备牌移动牌到目标手牌再装备。
//   - 装备到"他人"而非自己:不能复用 装备通用.use(它绑定 ownerId),这里手动复刻
//     装备通用的 装备+添加技能 序列(目标=target)。
//   - 不得替换原装备:validate 检查目标对应 slot 为空。
//   - 无次数限制。
import type { EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { skillLoaders } from './index';

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
    name: '直谏',
    description: '出牌阶段:将一张装备牌置于一名其他角色的空装备区,然后摸一张牌',
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
          ? (params.targets[0])
          : typeof params.target === 'number'
            ? (params.target)
            : undefined;
      if (target === undefined) return '需要指定一名目标';
      if (target === ownerId) return '不能对自己使用直谏';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不合法';

      // 不得替换原装备:目标对应栏位必须为空
      if (targetPlayer.equipment[slot]) return '目标该装备栏位已有装备,不得替换';

      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const target =
        Array.isArray(params.targets) && typeof params.targets[0] === 'number'
          ? (params.targets[0])
          : (params.target as number);
      const card = st.cardMap[cardId];

      await pushFrame(st, '直谏', ownerId, { ...params });
      // 1. 把装备牌交到目标手中(装备 atom 要求 cardId 在目标手牌中)
      await applyAtom(st, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '手牌', player: target },
      });
      // 2. 装备到目标(从目标手牌移入目标装备区)
      await applyAtom(st, { type: '装备', player: target, cardId });
      // 3. 若装备自带技能(以 card.name 作 skillId),动态挂载(与 装备通用 一致)
      if (card?.name && skillLoaders[card.name]) {
        await applyAtom(st, { type: '添加技能', player: target, skillId: card.name });
      }
      // 4. 摸一张牌
      await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
      await popFrame(st);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '直谏',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '直谏:将一张装备牌置于一名其他角色的空装备区',
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
