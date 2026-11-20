// 界乱武(界贾诩·群·限定技,OL 界限突破官方逐字):
//   "限定技,出牌阶段,你可以令所有其他角色依次选择一项:1.对其距离最小的另一名角色
//    使用一张【杀】;2.失去1点体力。所有角色结算完毕后,你可以视为使用一张无距离
//    限制的【杀】。"
//
// 与标版乱武(src/engine/skills/乱武.ts)的区别:
//   - 标版:仅"令所有其他角色依次对距离最近者出杀,无法如此做者失去1点体力"。
//   - 界版:在标版主循环结束后,追加一次询问——贾诩可选择视为使用一张【杀】,
//     无距离限制。视为使用的【杀】占出杀次数限制(与界仁德视为使用基本牌一致)。
//
// 实现要点:
//   - 主循环/use 校验/respond 校验/onMount 定义复用标版乱武导出的共享核心
//     (runLuanwuMainLoop/validateLuanwuUse/validateLuanwuSlashRespond 等),
//     仅询问 requestType 前缀不同('界乱武/出杀');键名/文案/限定技标记('乱武/used')
//     与标版逐字共享。逼杀统一走 runUseFlow(damageType 由 cardMap 自动传导)。
//   - 主循环结束后,若贾诩仍存活且有出杀次数剩余(canSlash),发起 choosePlayer 询问:
//     目标为任意存活其他角色(targetFilter 不校验距离 → 无距离限制)。
//     贾诩选目标 → 走 runVirtualSlash(共享虚拟杀结算,cards/_virtualSlash);
//     贾诩 pass / 超时 → 不视为使用杀。
//   - 视为使用杀占出杀次数(由 runVirtualSlash 的 charge 计费负责)。
//
// 命名:文件名/loader key/character skill name 均为 '界乱武';内部 Skill.name='乱武'。
import type { FrontendAPI, GameState, GameView, Json, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { defaultPlayActive } from '../rules/action-active';
import { registerRespondForAllSeats, currentRequestType, firstTarget, defineConfirmAction } from '../util/skillRuntime';
import { runVirtualSlash } from './cards/_virtualSlash';
import { registerAction } from '../core/skill';
import { canSlash } from '../rules/slash-quota';
import type { SkillModule } from '../types';
import {
  validateLuanwuUse,
  runLuanwuMainLoop,
  validateLuanwuSlashRespond,
  applyLuanwuSlashRespond,
  defineLuanwuSlashRespondAction,
} from './乱武';

const USED_KEY = '乱武/used';
/** 他人响应界乱武主询问的 requestType(出杀选择写入/消费均由共享核心负责) */
const REQUEST_TYPE = '界乱武/出杀';
/** 界版追加:贾诩选择"视为使用杀"目标的 requestType/localVars key */
const FINAL_TARGET_VAR = '界乱武/最终杀目标';
const FINAL_TARGET_RT = '界乱武/最终杀目标';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '乱武',
    description:
      '限定技:出牌阶段令所有其他角色依次对距离最小者出杀,无法如此做者失去1点体力;结算后可视为使用一张无距离限制的【杀】',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use(贾诩主动发动)──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, _params: Record<string, Json>): string | null =>
        validateLuanwuUse(st, ownerId),
      async (st: GameState, _params: Record<string, Json>) => {
        const from = ownerId;
        // 限定技标记:第一个 await 前设置,防 dispatch 重入
        st.players[from].vars[USED_KEY] = true;
        await pushFrame(state, '界乱武', from, {});
        try {
          // ── 主循环:从贾诩下家起,令他人选杀最近者或失1体力(标/界共享)──
          await runLuanwuMainLoop(st, from, REQUEST_TYPE);

          // ── 界版追加:所有角色结算完毕后,贾诩可视为使用一张无距离限制的【杀】 ──
          // 贾诩仍存活 + 有出杀次数剩余 + 场上有其他存活角色 → 发起目标询问
          if (st.players[from]?.alive && canSlash(st, from)) {
            const aliveOthers = st.players.filter((p) => p.alive && p.index !== from);
            if (aliveOthers.length > 0) {
              delete st.localVars[FINAL_TARGET_VAR];
              await applyAtom(st, {
                type: '请求回应',
                requestType: FINAL_TARGET_RT,
                target: from,
                prompt: {
                  type: 'choosePlayer',
                  title: '界乱武:视为使用一张无距离限制的【杀】,选择目标(pass 则不使用)',
                  min: 1,
                  max: 1,
                  filter: (_view: GameView, t: number) =>
                    t !== from && st.players[t]?.alive === true,
                },
                timeout: 20,
              });
              const finalTarget = st.localVars[FINAL_TARGET_VAR] as number | undefined;
              delete st.localVars[FINAL_TARGET_VAR];
              if (typeof finalTarget === 'number' && st.players[finalTarget]?.alive) {
                // 出杀次数累加已由 runVirtualSlash 的 charge 计费负责
                await runVirtualSlash(st, from, finalTarget, { prefix: '界乱武', charge: true });
              }
            }
          }
        } finally {
          await popFrame(state);
        }
      },
    ),
  );

  // ── respond(注册到每个座次)──
  // ① 他人响应乱武主询问(REQUEST_TYPE):选杀+最近目标 → 委托标版共享校验
  // ② 贾诩响应界版追加询问(FINAL_TARGET_RT):选最终杀目标(界版专有)
  unloaders.push(
    ...registerRespondForAllSeats(
      state,
      skill.id,
      (st, seat, params) => {
        if (currentRequestType(st, seat) === FINAL_TARGET_RT) {
          // 最终杀目标:仅需 target(任意存活其他角色,无距离限制)
          const t = firstTarget(params);
          if (typeof t !== 'number') return '请选择目标';
          if (t === seat) return '不能以自己为目标';
          if (!st.players[t]?.alive) return '目标不存在或已死亡';
          return null;
        }
        return validateLuanwuSlashRespond(st, seat, params, REQUEST_TYPE);
      },
      async (st, seat, params) => {
        if (currentRequestType(st, seat) === FINAL_TARGET_RT) {
          const t = firstTarget(params);
          if (typeof t === 'number') st.localVars[FINAL_TARGET_VAR] = t;
          return;
        }
        applyLuanwuSlashRespond(st, params);
      },
    ),
  );

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  defineConfirmAction(api, 'use', {
    label: '乱武',
    title: '乱武(限定技):令所有其他角色依次对距离最近者出杀,无法如此做者失去1点体力;结算后可视为使用一张无距离限制的【杀】',
    activeWhen: (ctx) => defaultPlayActive(ctx),
  });
  // respond:被乱武问询的角色选杀+最近目标 / 贾诩选最终杀目标。前端按 pending prompt 渲染。
  defineLuanwuSlashRespondAction(api);
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
