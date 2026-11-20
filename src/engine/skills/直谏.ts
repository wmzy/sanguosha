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
//   - 装备到"他人"而非自己:不能复用 装备通用.use(它绑定 ownerId),这里经共享
//     _equipReplace.equipReplacingOld 复刻 装备通用 的 替换/装备+添加技能 序列(目标=target)。
//   - 无次数限制。
//
// 本文件同时导出 createZhijianSkill 工厂(直谏族共享实现),界直谏 复用之,
// 仅注入 名称/描述/文案/可否替换原装备 差异参数。
import type { FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { registerAction } from '../core/skill';
import { equipReplacingOld } from './_equipReplace';
import { slotOf } from '../util/equip-slot';
import { engineCanPlayNowReason } from '../util/skillRuntime';

/** 直谏族(主动技)差异参数 */
export interface ZhijianOptions {
  /** Skill.name(标 '直谏' / 界 '界直谏') */
  name: string;
  description: string;
  /** 技能 id('直谏'/'界直谏'):frame 名 + 自指错误文案 */
  skillId: string;
  /** onMount 按钮文案 */
  mountLabel: string;
  /** onMount 弹窗标题 */
  mountTitle: string;
  /** 界版:可替换原装备(栏位已有装备时先弃置原装备再装新装备);
   *  标版"不得替换"——validate 要求目标对应栏位为空。 */
  allowReplace?: boolean;
}

/** 直谏族共享实现:标版直谏与界直谏的 装备流程 逐字一致;
 *  界版仅放宽"栏位必须为空"为"可替换"(替换序列与 装备通用 一致)。 */
export function createZhijianSkill(opts: ZhijianOptions) {
  return {
    createSkill(id: string, ownerId: number): Skill {
      return {
        id,
        ownerId,
        name: opts.name,
        description: opts.description,
      };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      registerAction(
        state,
        skill.id,
        ownerId,
        'use',
        (st: GameState, params: Record<string, Json>) => {
          // 通用合法条件
          const playError = engineCanPlayNowReason(st, ownerId);
          if (playError) return playError;
          const self = st.players[ownerId];

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
          if (target === ownerId) return `不能对自己使用${opts.skillId}`;
          const targetPlayer = st.players[target];
          if (!targetPlayer?.alive) return '目标不合法';

          // 标版:不得替换原装备——目标对应栏位必须为空(界版可替换,不检查)
          if (!opts.allowReplace && targetPlayer.equipment[slot]) {
            return '目标该装备栏位已有装备,不得替换';
          }

          return null;
        },
        async (st: GameState, params: Record<string, Json>) => {
          const cardId = params.cardId as string;
          const target =
            Array.isArray(params.targets) && typeof params.targets[0] === 'number'
              ? params.targets[0]
              : (params.target as number);
          const card = st.cardMap[cardId];

          await pushFrame(st, opts.skillId, ownerId, { ...params });
          // 1. 把装备牌交到目标手中(装备 atom 要求 cardId 在目标手牌中)
          await applyAtom(st, {
            type: '移动牌',
            cardId,
            from: { zone: '手牌', player: ownerId },
            to: { zone: '手牌', player: target },
          });
          // 2. 界版:目标对应栏位已有装备则替换(与 装备通用 替换语义一致;会触发目标
          //    "失去装备"类技能如枭姬,属预期)。标版 validate 已保证栏位为空,替换分支不触发。
          // 3. 装备到目标(从目标手牌移入目标装备区)。
          // 4. 若装备自带技能(以 card.name 作 skillId),动态挂载(与 装备通用 一致)。
          await equipReplacingOld(st, target, slotOf(card)!, cardId);
          // 5. 摸一张牌
          await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
          await popFrame(st);
        },
      );

      return () => {};
    },

    onMount(_skill: Skill, api: FrontendAPI): (() => void) | undefined {
      api.defineAction('use', {
        label: opts.mountLabel,
        style: 'primary',
        prompt: {
          type: 'useCardAndTarget',
          title: opts.mountTitle,
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
    },
  };
}

const OPTIONS: ZhijianOptions = {
  name: '直谏',
  description: '出牌阶段:将一张装备牌置于一名其他角色的空装备区,然后摸一张牌',
  skillId: '直谏',
  mountLabel: '直谏',
  mountTitle: '直谏:将一张装备牌置于一名其他角色的空装备区',
};

export const { createSkill, onInit, onMount } = createZhijianSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
