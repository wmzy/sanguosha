// 崩坏(董卓·锁定技):回合结束阶段,若你的体力不是全场最少的(或同时为最少),
// 你须减1点体力或1点体力上限。
//
// 模式 A(被动触发):after hook 挂在「阶段开始」,phase='回合结束'(结束阶段)。
//   结束阶段开始 → 检查体力是否全场最少(含并列) → 若不是则询问选择 → 执行扣减。
//
// 触发条件解析(对齐官方规则):"不是全场最少(或之一)" = 体力严格大于全场最小值。
//   - 体力 == 全场最小(含并列最少) → 不触发
//   - 体力 > 全场最小 → 触发,须扣减
//
// 选择:减1点体力上限(设上限) 或 减1点体力(失去体力)。
//   体力上限可降至0:上限为0时角色直接死亡(设上限 after-hook → runDeathFlow)。
//
// 本文件同时导出 createBenghuaiSkill 工厂(崩坏族共享实现),界崩坏 复用之,
// 仅注入 描述/询问 requestType/禁用检查 差异参数(选择键共享 '崩坏/choice'——
// 标/界董卓只会拥有一版崩坏)。
import type { FrontendAPI, GameState, Skill } from '../types';
import { getHealthValue } from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import { defineConfirmAction, registerChoiceRespond } from '../util/skillRuntime';

const CHOICE_KEY = '崩坏/choice'; // 'maxHealth' | 'health'

/** 崩坏族(锁定技)差异参数 */
export interface BenghuaiOptions {
  description: string;
  /** 选择询问的 requestType(标 '崩坏/choose' / 界 '界崩坏/choose',键空间隔离) */
  chooseRt: string;
  /** 界版专属:结束阶段触发前的禁用检查(界酒池"酒杀造成伤害后本回合崩坏失效"
   *  经 turn.vars['崩坏/disabled'] 传递);标版不传,恒触发。 */
  disableCheck?: (state: GameState) => boolean;
}

/** 崩坏族共享实现:标版崩坏与界崩坏仅 描述/询问键/禁用检查 不同,主流程逐字一致。 */
export function createBenghuaiSkill(opts: BenghuaiOptions) {
  return {
    createSkill(id: string, ownerId: number): Skill {
      return {
        id,
        ownerId,
        name: '崩坏',
        description: opts.description,
        isLocked: true,
      };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      // ── respond:董卓回应崩坏选择(确认=减体力上限,取消=减体力) ──
      // choice=true → 减体力上限;choice=false(或超时)→ 减体力
      registerChoiceRespond(
        state,
        skill.id,
        ownerId,
        opts.chooseRt,
        CHOICE_KEY,
        'maxHealth',
        'health',
        {
          mismatchError: '当前不是崩坏选择',
        },
      );

      // ── 结束阶段开始:检查体力并询问 ──
      registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
        const atom = ctx.atom;
        if (atom.type !== '阶段开始') return;
        if (atom.player !== ownerId) return;
        if (atom.phase !== '回合结束') return; // 结束阶段 = phase '回合结束'

        const self = ctx.state.players[ownerId];
        if (!self?.alive) return;

        // 界酒池第三段效果:本回合崩坏失效(仅界版注入 disableCheck)
        if (opts.disableCheck?.(ctx.state) === true) return;

        // 全场存活玩家最小体力
        const alivePlayers = ctx.state.players.filter((p) => p.alive);
        const minHealth = alivePlayers.reduce(
          (min, p) => Math.min(min, getHealthValue(p)),
          Number.POSITIVE_INFINITY,
        );
        // 体力值 == 最小(含并列)→ 不触发;体力值 > 最小 → 触发
        if (getHealthValue(self) <= minHealth) return;

        // 询问选择
        delete ctx.state.localVars[CHOICE_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: opts.chooseRt,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title: '崩坏:减1点体力上限,还是减1点体力?',
            confirmLabel: '减体力上限',
            cancelLabel: '减体力',
          },
          defaultChoice: false,
          timeout: 15,
        });

        const choice = ctx.state.localVars[CHOICE_KEY];
        delete ctx.state.localVars[CHOICE_KEY];
        if (choice === 'maxHealth') {
          await applyAtom(ctx.state, {
            type: '设上限',
            player: ownerId,
            amount: self.maxHealth - 1,
          });
        } else {
          await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
        }
      });

      return () => {};
    },

    onMount(_skill: Skill, api: FrontendAPI): void {
      defineConfirmAction(api, 'respond', {
        label: '崩坏',
        title: '崩坏:减1点体力上限,还是减1点体力?',
        confirmLabel: '减体力上限',
        cancelLabel: '减体力',
        style: 'default',
      });
    },
  };
}

const OPTIONS: BenghuaiOptions = {
  description: '锁定技:回合结束阶段,若你的体力不是全场最少的,须减1点体力或1点体力上限',
  chooseRt: '崩坏/choose',
};

export const { createSkill, onInit, onMount } = createBenghuaiSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
