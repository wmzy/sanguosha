// 闭月(貂蝉·群·被动技):回合结束阶段,你可以摸一张牌。
//
// 流程(被动触发):
//   1. after-hook 挂「阶段开始」(phase='回合结束'):自己回合结束时触发
//   2. 询问是否发动(请求回应 confirm)
//   3. 确认 → 摸一张牌(摸牌 atom)
//
// 关键点:
//   - 触发时机:阶段开始(回合结束)——回合结束阶段开始时触发。
//     该 atom 由 回合管理 的 阶段结束(弃牌) after-hook 链触发
//     (nextPhase('弃牌')='回合结束' → applyAtom(阶段开始, 回合结束))。
//   - 每回合限一次:回合结束阶段天然一次,无需额外标记。
//   - 可选发动:描述明确"你可以摸一张牌",需询问玩家(confirm)。
//   - respond action 注册在貂蝉本人座次(ownerId),因询问目标是自己。
//
// 本文件同时导出 createEndPhaseDrawSkill 工厂(结束阶段摸牌技共享实现),
// 界闭月 复用之,仅注入摸牌张数(无手牌摸 2 张)与文案/键差异参数(镜像 鬼道/界鬼道)。
import type {
  FrontendAPI,
  GameState,
  PlayerState,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';
import { askConfirm, registerConfirmRespond, defineConfirmAction } from '../util/skillRuntime';

/** 结束阶段摸牌技(闭月族)差异参数 */
export interface EndPhaseDrawOptions {
  /** Skill.name(玩家可见技能名;标/界官方均为 '闭月') */
  name: string;
  description: string;
  /** confirm 询问的 requestType(技能名/xxx 命名空间,标/界键隔离) */
  requestType: string;
  /** 记录确认结果的 localVars 键 */
  confirmedKey: string;
  /** 摸牌张数:在阶段开始(回合结束)时按 owner 状态求值(标版恒 1;界版无手牌 2,否则 1) */
  drawCount: (self: PlayerState) => number;
  /** onMount defineAction 的 confirm 标题(标版与询问文案一致;界版无"(摸X张牌)"后缀) */
  mountTitle: string;
}

/** 闭月族共享实现:标闭月与界闭月仅摸牌张数与文案/键不同,respond/hook/onMount 骨架一致。 */
export function createEndPhaseDrawSkill(opts: EndPhaseDrawOptions) {
  return {
    createSkill(id: string, ownerId: number): Skill {
      return {
        id,
        ownerId,
        name: opts.name,
        description: opts.description,
      };
    },

    onInit(skill: Skill, state: GameState): (() => void) | void {
      const ownerId = skill.ownerId;

      // ── confirm respond:貂蝉本人回应是否发动闭月 ──
      registerConfirmRespond(state, skill.id, ownerId, opts.requestType, opts.confirmedKey, {
        mismatchError: '当前不是闭月确认',
      });

      // ── 回合结束阶段开始 → 询问是否摸牌 ──
      registerAfterHook(
        state,
        skill.id,
        ownerId,
        '阶段开始',
        async (ctx) => {
          const atom = ctx.atom;
          if (atom.type !== '阶段开始') return;
          if (atom.phase !== '回合结束') return;
          if (atom.player !== ownerId) return;

          const self = ctx.state.players[ownerId];
          if (!self?.alive) return;

          // 摸牌张数(标版恒 1 张;界版:0 张 → 2 张,否则 → 1 张)
          const drawCount = opts.drawCount(self);
          const countLabel = drawCount === 2 ? '两张牌' : '一张牌';

          // 询问是否发动闭月
          const confirmed = await askConfirm(ctx.state, opts.requestType, ownerId, {
            confirmedKey: opts.confirmedKey,
            title: `是否发动${opts.name}?(摸${countLabel})`,
            confirmLabel: '发动',
            cancelLabel: '不发动',
            defaultChoice: false,
            timeout: 15,
          });

          if (confirmed) {
            await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: drawCount });
          }
        },
      );

      return () => {};
    },

    onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
      defineConfirmAction(api, 'respond', { label: opts.name, title: opts.mountTitle });

      return () => {};
    },
  };
}

const OPTIONS: EndPhaseDrawOptions = {
  name: '闭月',
  description: '回合结束阶段,你可以摸一张牌',
  requestType: '闭月/confirm',
  confirmedKey: '闭月/confirmed',
  drawCount: () => 1,
  mountTitle: '是否发动闭月?(摸一张牌)',
};

export const { createSkill, onInit, onMount } = createEndPhaseDrawSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
