// 天义(太史慈·吴·主动技):出牌阶段限一次,你可以与一名角色拼点:
//   若你赢,本回合你攻击范围无限、可额外使用一张【杀】、使用【杀】时可额外指定一个目标;
//   若你没赢,你不能使用【杀】直到回合结束。
//
// 拼点规则(与驱虎/烈刃一致):A=1(最小),2-10=面值,J=11,Q=12,K=13。
// 点数大者赢,相等算"没赢"。拼点双方各出一张手牌,拼点后两张牌进入弃牌堆。
//
// 三项赢效果实现(均挂在 turn.vars,回合结束自动清空):
//   1. 攻击范围无限:turn.vars['天义/win']=发起者座次;distance.ts 的 inAttackRange 据此放行。
//   2. 可额外使用一张杀:注册 slashMaxProvider,win 时贡献 +1(slash-quota 提供者模式)。
//   3. 使用杀时可额外指定一个目标:杀.validate 不限目标数(参考方天画戟),配合"攻击范围无限"
//      天然成立——一张杀可对任意两名存活角色生效。
//
// 输的效果:
//   - turn.vars['天义/lost']=发起者座次;注册 slashBlocker 返回 true → canSlash=false →
//     杀.use 的 validate 拒绝("出杀次数已达上限")。无论是否装连弩都禁杀(规则:本回合不能用杀)。
//
// 限一次:player.vars['天义/usedThisTurn'](后缀约定,回合结束 atom 自动清空)。
// 目标需 respond 选拼点牌——respond action 为所有玩家注册(validate 严格校验 pending requestType)。
// use action 骨架(七连检 validate + 拼点仪式 + 输赢分支)由 flows/rank 的
// registerRankUseAction/defineRankUseAction 提供,本文件只注入赢/没赢的 turn.vars 结算差异。
import type { FrontendAPI, GameState, Skill } from '../types';
import { registerRankUseAction, defineRankUseAction } from '../flows/rank';
import { activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { registerSlashExtraProvider, registerSlashBlocker } from '../rules/slash-quota';
import { registerSlashTargetProvider } from '../rules/slash-target';
import { registerAttackRangeExemptor } from '../rules/distance';
import { slashExtraKey, slashTargetKey, slashBlockedKey, TIANYI_WIN_VIEW_KEY } from '../rules/vars-keys';
import { setTurnVarUsage, projectTurnUsage } from '../rules/turn-usage';

const WIN_VAR = TIANYI_WIN_VIEW_KEY;
const LOST_VAR = '天义/lost';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '天义',
    description:
      '出牌阶段限一次,与一名角色拼点:赢则本回合攻击范围无限、可额外使用一张杀、杀可额外指定一个目标;没赢则本回合不能使用杀',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── 额外出杀提供者:拼点赢后本回合 +1(可额外使用一张杀)──
  const unloadProvider = registerSlashExtraProvider(
    state,
    ownerId,
    (st: GameState, player: number) => (st.turn.vars[WIN_VAR] === player ? 1 : 0),
  );

  // ─── 出杀阻断器:拼点没赢后本回合禁杀(不能使用杀)──
  const unloadBlocker = registerSlashBlocker(
    state,
    ownerId,
    (st: GameState, player: number) => st.turn.vars[LOST_VAR] === player,
  );

  // ─── 距离豁免器:拼点赢后本回合攻击范围无限 ──────────────────────
  //   通过 distance provider 实现,避免污染 杀.ts/distance.ts。
  const unloadRangeExemptor = registerAttackRangeExemptor(
    state,
    ownerId,
    (st, from, _to, _cardId) => st.turn.vars[WIN_VAR] === from,
  );

  // ─── 杀目标数提供者:拼点赢后本回合杀可额外指定一个目标(≤2) ──
  const unloadTargetProvider = registerSlashTargetProvider(
    state,
    ownerId,
    (st, player) => (st.turn.vars[WIN_VAR] === player ? 2 : 0),
  );

  // ─── use action:太史慈主动发动天义(拼点 use-action 骨架工厂) ──
  registerRankUseAction(state, skill.id, ownerId, {
    displayName: '天义',
    // 赢:三项效果(攻击范围无限 / +1 杀 / 额外目标)统一由 turn.vars['天义/win'] 驱动
    // (state 真相 + view 投影同 key 同值一步提交;「攻击范围无限」投影到 view 后,
    //  前端 viewCanAttack/无头枚举据此放开距离,否则超出徒手范围的目标选不中)
    onWin: async (st, from) => {
      await setTurnVarUsage(st, from, WIN_VAR, from);
      // 投影到 view.turnUsage,供前端 viewSlashMax/viewSlashTargetMax 推断(通用前缀 key)
      await projectTurnUsage(st, from, slashExtraKey('天义'), 1);
      await projectTurnUsage(st, from, slashTargetKey('天义'), 1);
    },
    // 没赢:本回合不能使用杀(由 slashBlocker 落实;state 存座次、view 投影 true,不同值须分开写)
    onLose: async (st, from) => {
      st.turn.vars[LOST_VAR] = from;
      await projectTurnUsage(st, from, slashBlockedKey('天义'), true);
    },
    respondMismatchError: '当前不是天义回应',
  });

  // ─── respond action:为所有玩家注册 ────────────────────────
  // 目标(其他玩家)需要 respond 选拼点牌。默认 respond 只注册在 owner(太史慈)上,
  // 目标无法 dispatch,故为每个玩家注册(封装于工厂内 registerRankCardRespond,
  // validate 严格检查 pending requestType,非天义 pending 一律拒绝)。

  // actions/hooks 随 state-bound 注册表自动清理;provider/blocker 是模块级集合,需显式卸载。
  return () => {
    unloadProvider();
    unloadBlocker();
    unloadRangeExemptor();
    unloadTargetProvider();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  defineRankUseAction(api, {
    label: '天义',
    style: 'primary',
    title: '天义:选择一张拼点牌和一名目标',
    activeWhen: (ctx) =>
      activeUnlessUsedThisTurn('天义')(ctx) &&
      (ctx.view.players[ctx.perspectiveIdx]?.hand?.length ?? 0) > 0,
    // respond(拼点牌选择):前端通过 pending prompt 渲染,声明让前端识别为天义回应。
    respondTitle: '天义:请出一张拼点牌',
  });
}

export default { createSkill, onInit, onMount };
