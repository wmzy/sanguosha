// 离间(貂蝉·群·主动技):出牌阶段限一次,你可以弃置一张牌,
// 然后令一名男性角色视为对另一名男性角色使用一张【决斗】。
//
// 流程(主动技):
//   1. use action:出牌阶段,弃一张牌(手牌或装备)+ 选两名不同男性角色 A、B
//   2. 弃置牌(弃置 atom)
//   3. A 视为对 B 使用决斗(runDuelResolution,复用 决斗.ts 提取的结算核心)
//      - A 是决斗发起者(出杀后手),B 是目标(出杀先手)
//      - 无实体决斗牌(cardId 省略),但可被无懈可击抵消
//
// 关键点:
//   - 限一次/回合:离间/usedThisTurn(后缀约定,回合结束 atom 自动清空)。
//   - 性别检查用 getGender(character):A、B 必须是男性;貂蝉本人为女性,天然不可选。
//   - 弃置的牌可以是手牌或装备牌(弃置 atom 同时处理两区)。
//   - 决斗结算复用 决斗.ts 的 runDuelResolution,保证与正常决斗行为一致
//     (无懈可击、无双双杀、轮流出杀、输者受 1 点伤害)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { getGender } from '../character-meta';
import { runDuelResolution } from './决斗';

/** 校验某座次是否为男性存活角色 */
function isMaleAlive(state: GameState, target: number): boolean {
  const p = state.players[target];
  if (!p?.alive) return false;
  return getGender(p.character) === '男';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '离间',
    description: '出牌阶段限一次,弃一张牌,令一名男性角色视为对另一名男性角色使用决斗',
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
      const self = st.players[ownerId];
      if (!self?.alive) return '角色不可用';
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, '离间')) return '本回合已使用过离间';

      // cardId:被弃置的牌(手牌或装备)
      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string') return '需要选择一张牌弃置';
      const inHand = self.hand.includes(cardId);
      const inEquip = Object.values(self.equipment).includes(cardId);
      if (!inHand && !inEquip) return '牌不在你的手牌或装备区';

      // targets:两名不同的男性角色 [发起者A, 目标B]
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length !== 2) {
        return '需要选择两名男性角色';
      }
      const [A, B] = targets;
      if (A === B) return '必须选择两名不同的角色';
      if (!isMaleAlive(st, A)) return '决斗发起者必须是男性角色';
      if (!isMaleAlive(st, B)) return '决斗目标必须是男性角色';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const [A, B] = params.targets as [number, number];

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, ownerId, '离间');

      await pushFrame(st, '离间', ownerId, { ...params });

      // 1. 弃置一张牌(手牌或装备)
      await applyAtom(st, { type: '弃置', player: ownerId, cardIds: [cardId] });

      // 2. A 视为对 B 使用决斗(无实体牌,cardId 省略)
      await runDuelResolution(st, A, B);

      await popFrame(st);
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '离间',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '离间：弃一张牌,令一名男性角色对另一名男性角色决斗',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: {
        min: 2,
        max: 2,
        filter: (view, target) => {
          const p = view.players[target];
          if (!p || p.alive === false) return false;
          return getGender(p.character) === '男';
        },
      },
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn('离间')(ctx),
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
