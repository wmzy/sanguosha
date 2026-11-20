// 驱虎(荀彧·主动技):出牌阶段限一次,你可以与一名角色拼点:
//   若你赢,该角色对其攻击范围内另一名角色造成 1 点伤害;
//   若你没赢,该角色对你造成 1 点伤害。
//
// 拼点规则:A=1(最小),2-10=面值,J=11,Q=12,K=13。点数大者赢,相等算"没赢"。
// 拼点双方各出一张手牌,拼点后两张牌进入弃牌堆。
//
// 设计要点:
//   - 目标需要 respond 选择拼点牌。但 respond action 默认只注册在技能 owner(荀彧)身上,
//     目标(其他玩家)无法 dispatch。因此本技能在 onInit 时为所有玩家注册 respond action,
//     validate 严格检查 pending requestType,非驱虎 pending 时拒绝(无副作用)。
//   - 每回合限一次:用 player.vars['驱虎/usedThisTurn'] + 回合用量 atom 同步 view。
//   - use action 骨架(七连检 validate + 拼点仪式 + 输赢分支)由 flows/rank 的
//     registerRankUseAction/defineRankUseAction 提供,本文件只注入赢/没赢的伤害结算差异。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { runDamageFlow } from '../flows/damage';
import { registerRankUseAction, defineRankUseAction } from '../flows/rank';
import { activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { registerAction } from '../core/skill';
import { inAttackRange } from '../rules/distance';
import { currentRequestType, requireRequestType } from '../util/skillRuntime';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '驱虎',
    description: '出牌阶段限一次,与一名角色拼点:赢则该角色对其攻击范围内另一角色造成1伤害,没赢则其对你造成1伤害',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── use action:荀彧主动发动驱虎(拼点 use-action 骨架工厂) ──
  registerRankUseAction(state, skill.id, ownerId, {
    displayName: '驱虎',
    needCardError: '需要选择拼点牌',
    // 赢:目标对其攻击范围内另一名角色造成 1 点伤害(荀彧选目标)
    onWin: async (st, from, target) => {
      // 检查目标的攻击范围内是否有可选角色
      const candidates = st.players
        .filter(
          (p) => p.alive && p.index !== target && inAttackRange(st, target, p.index),
        )
        .map((p) => p.index);

      if (candidates.length === 0) {
        // 目标攻击范围内无其他角色,无法造成伤害,驱虎结算结束
        return;
      }

      delete st.localVars['驱虎/victim'];
      await applyAtom(st, {
        type: '请求回应',
        requestType: '驱虎/选目标',
        target: from,
        prompt: {
          type: 'choosePlayer',
          title: `驱虎:选择 ${st.players[target].name} 攻击范围内的一名角色,其将受到1点伤害`,
          min: 1,
          max: 1,
          filter: (view, t) => t !== from && view.players[t]?.alive === true, // 后端 validate 已校验攻击范围;前端排除自己与死亡角色
        },
        timeout: 30,
      });

      const victim = st.localVars['驱虎/victim'] as number | undefined;
      delete st.localVars['驱虎/victim'];
      if (typeof victim === 'number' && st.players[victim]?.alive && victim !== target) {
        if (inAttackRange(st, target, victim)) {
          await runDamageFlow(st, target, victim, 1);
        }
      }
    },
    // 没赢(输或平):目标对荀彧造成 1 点伤害
    onLose: async (st, from, target) => {
      await runDamageFlow(st, target, from, 1);
    },
  });

  // ─── respond action:为所有玩家注册 ────────────────────────
  // 目标(其他玩家)需要 respond 选拼点牌;荀彧赢后荀彧自己也要 respond 选伤害目标。
  // 默认 respond 只注册在 owner(荀彧)上,目标无法 dispatch,故此处为每个玩家注册。
  // validate 严格检查 pending requestType,非驱虎 pending 一律拒绝(无副作用)。
  for (const p of state.players) {
    const pid = p.index;
    registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const check = requireRequestType(st, pid, ['驱虎/拼点', '驱虎/选目标'], {
          mismatchError: '当前不是驱虎回应',
        });
        if (check.error) return check.error;
        const reqType = check.requestType;
        if (reqType === '驱虎/拼点') {
          // 目标出拼点牌:校验 cardId 在手牌中
          const cardId = params.cardId as string;
          if (typeof cardId !== 'string') return '请选择一张拼点牌';
          if (!st.players[pid].hand.includes(cardId)) return '拼点牌不在手牌中';
          return null;
        }
        if (reqType === '驱虎/选目标') {
          // 仅荀彧(ownerId)可选目标;且必须是合法目标
          if (pid !== ownerId) return '只有驱虎发动者可以选择目标';
          const victim = params.target as number;
          if (typeof victim !== 'number') return '请选择一名目标';
          return null;
        }
        return '当前不是驱虎回应';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const reqType = currentRequestType(st, pid);
        if (reqType === '驱虎/拼点') {
          st.localVars['驱虎/targetCard'] = params.cardId;
        } else if (reqType === '驱虎/选目标') {
          st.localVars['驱虎/victim'] = params.target;
        }
      },
    );
  }

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  defineRankUseAction(api, {
    label: '驱虎',
    style: 'danger',
    title: '驱虎:选择一张拼点牌和一名目标',
    activeWhen: (ctx) =>
      activeUnlessUsedThisTurn('驱虎')(ctx) &&
      (ctx.view.players[ctx.perspectiveIdx]?.hand?.length ?? 0) > 0,
    // respond(拼点牌选择 / 伤害目标选择):前端通过 pending prompt 渲染,
    // 声明让前端识别为驱虎回应。
    respondTitle: '驱虎:请出一张拼点牌',
  });
}
