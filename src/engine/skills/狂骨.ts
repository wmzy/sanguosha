// 狂骨(魏延·被动可选技):当你对距离1以内的一名角色每造成1点伤害后,
// 你可以回复1点体力或摸一张牌(按伤害点数逐点发动,2点伤害可发动两次)。
//
// 实现(被动 after-hook + 两步 respond,同反馈/制霸模式):
//   造成伤害 after-hook(source===ownerId, amount>0):
//     若 effectiveDistance(owner, target) <= 1:
//       1. 询问是否发动狂骨(请求回应 requestType='狂骨/confirm',confirm prompt)
//          不发动 / 超时 → 结束(无效果)——「你可以」为可选触发,非锁定自动。
//       2. 发动 → 询问二选一(请求回应 requestType='狂骨/choose',confirm prompt)
//          · choice=true(回复体力)→ 回复体力 1
//          · choice=false(摸牌)/ 超时缺省 → 摸牌 1(已承诺发动,不浪费机会)
//
// 关键点:
//   - 一个技能实例仅能注册一个 respond action(actionKey 冲突),故 confirm 与二选一
//     合并为单 respond 按 requestType 分支(同反馈/固政/制霸模式)。
//   - 距离1以内:effectiveDistance 最小为 1(座位相邻或自己),<= 1 即满足。
//     装备 -1 马(进攻修正)通过 player.vars['距离/进攻修正'] 进一步缩短距离——自动支持。
//   - 官方无体力条件:即使满血也可选择摸牌(回复体力则被上限截断,无溢出)。
//
// 本文件同时导出 createKuangguSkill 工厂(狂骨族共享实现),界狂骨 复用之,
// 仅注入 名称/描述/技能 id(键前缀)/满血禁疗 差异参数。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import { effectiveDistance } from '../rules/distance';
import { askConfirm, currentRequestType, requireRequestType } from '../util/skillRuntime';

/** 狂骨族(被动可选技)差异参数 */
export interface KuangguOptions {
  /** Skill.name(标 '狂骨' / 界 '界狂骨') */
  name: string;
  description: string;
  /** 技能 id('狂骨'/'界狂骨'):requestType 与 localVars 键前缀 */
  skillId: string;
  /** 询问文案前缀('狂骨'/'界狂骨':是否发动 X?/ X:回复1点体力…) */
  displayName: string;
  /** 界版:满血时禁用二选一的「回复体力」按钮(confirmDisabled)。 */
  disableHealWhenFull?: boolean;
}

/** 狂骨族共享实现:标版狂骨与界狂骨的逐点询问主流程逐字一致;
 *  界版仅询问文案前缀不同,且满血时禁用「回复体力」按钮。 */
export function createKuangguSkill(opts: KuangguOptions) {
  /** 是否发动狂骨的 requestType */
  const CONFIRM_REQUEST = `${opts.skillId}/confirm`;
  /** 二选一(回复体力 / 摸牌)的 requestType */
  const CHOOSE_REQUEST = `${opts.skillId}/choose`;
  /** localVars key:是否发动(respond 写,hook 读) */
  const CONFIRMED_KEY = `${opts.skillId}/confirmed`;
  /** localVars key:二选一结果 'heal' | 'draw'(respond 写,hook 读) */
  const CHOICE_KEY = `${opts.skillId}/choice`;

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

      // ── respond:处理「是否发动」与「二选一」两类询问(单 respond 按 requestType 分支)──
      // 选择者是魏延本人(owner),故只注册到 ownerId 座次;以 skillId 隔离路由。
      // requestType 前缀必须等于 skillId:前端 resolvePendingRespond 按 requestType
      // 前缀推导 skillId 后路由,前缀错会查不到实例 → 点击无效。
      const offRespond = registerAction(
        state,
        skill.id,
        ownerId,
        'respond',
        (st: GameState, _params: Record<string, Json>) => {
          return requireRequestType(st, ownerId, [CONFIRM_REQUEST, CHOOSE_REQUEST], {
            mismatchError: '当前不是狂骨询问',
          }).error;
        },
        async (st: GameState, params: Record<string, Json>) => {
          const rt = currentRequestType(st, ownerId);
          if (rt === CONFIRM_REQUEST) {
            st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
          } else if (rt === CHOOSE_REQUEST) {
            // choice=true(确认)→ 回复体力;choice=false(取消)/缺省 → 摸牌
            st.localVars[CHOICE_KEY] = params.choice === true ? 'heal' : 'draw';
          }
        },
      );

      // ── 造成伤害 after hook:狂骨主逻辑 ──
      // 官方(OL):每造成1点伤害,可回复1点体力或摸一张牌——按伤害点数逐点发动,
      // amount=2(酒杀/裸衣)时可独立发动两次,每次各自询问是否发动+二选一。
      registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
        const atom = ctx.atom;
        if (atom.source !== ownerId) return;
        const amount = atom.amount ?? 0;
        if (amount <= 0) return;
        if (atom.target === undefined) return;
        const target = atom.target;
        if (!ctx.state.players[target]?.alive) return;

        // 距离1以内(含自己):effectiveDistance 最小为 1
        if (effectiveDistance(ctx.state, ownerId, target) > 1) return;

        // 每点伤害独立发动一次(前一次回复体力/摸牌可能改变存活/体力状态,逐次复查)
        for (let i = 0; i < amount; i++) {
          const self = ctx.state.players[ownerId];
          if (!self?.alive) return;

          // 满血时回复体力无效(界版):禁用「回复体力」按钮,玩家只能摸牌
          const fullHealth = self.health >= self.maxHealth;

          // 1. 询问是否发动狂骨(可选触发:官方「你可以」)
          const confirmed = await askConfirm(ctx.state, CONFIRM_REQUEST, ownerId, {
            confirmedKey: CONFIRMED_KEY,
            title: `是否发动${opts.displayName}?(第 ${i + 1}/${amount} 点伤害)`,
            confirmLabel: '发动',
            cancelLabel: '不发动',
            defaultChoice: false,
            timeout: 30,
          });
          if (confirmed !== true) continue; // 本点不发动,继续下一点

          // 2. 发动 → 询问二选一(回复 1 点体力 / 摸 1 张牌)
          delete ctx.state.localVars[CHOICE_KEY];
          await applyAtom(ctx.state, {
            type: '请求回应',
            requestType: CHOOSE_REQUEST,
            target: ownerId,
            prompt: {
              type: 'confirm',
              title: `${opts.displayName}:回复1点体力,或摸一张牌?`,
              confirmLabel: '回复1点体力',
              cancelLabel: '摸一张牌',
              ...(opts.disableHealWhenFull
                ? { confirmDisabled: fullHealth ? true : undefined }
                : {}),
            },
            defaultChoice: false,
            timeout: 30,
          });
          const choice = ctx.state.localVars[CHOICE_KEY] as string | undefined;
          if (choice === 'heal') {
            await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
          } else {
            // 'draw' 或超时缺省 → 摸一张牌(已承诺发动,不浪费机会)
            await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
          }
        }
      });

      return () => {
        offRespond();
      };
    },

    onMount(_skill: Skill, _api: FrontendAPI): void {
      // 被动技,无主动 action
      return;
    },
  };
}

const OPTIONS: KuangguOptions = {
  name: '狂骨',
  description: '对距离1以内的角色每造成1点伤害后,你可以回复1点体力或摸一张牌',
  skillId: '狂骨',
  displayName: '狂骨',
};

export const { createSkill, onInit, onMount } = createKuangguSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
