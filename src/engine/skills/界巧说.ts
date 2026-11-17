// 界巧说(界简雍·蜀·主动技,OL hero/600 官方逐字):
//   "出牌阶段,你可以拼点:若你赢,你本回合使用的下一张牌可以多指定或少指定一个目标;
//    若你没赢,此技能失效且你不能使用锦囊牌直到回合结束。"
//
// 界限突破(相对标 简雍 巧说):
//   1. 标版触发"出牌阶段开始时";界版改为"出牌阶段"(任意时机,更灵活)。
//   2. 标版没赢仅"本回合不能使用锦囊牌";界版加"此技能失效"(等同禁用,但因每回合限一次,
//      由 usedThisTurn 已经落实)。
//
// 实现要点:
//   - 出牌阶段限一次:player.vars['界巧说/usedThisTurn'](后缀约定,回合结束 atom 自动清空)。
//   - 拼点流程(参考 天义.ts):
//       1) 请求回应(target 选拼点牌)
//       2) runRankCompareFlow(扣置→亮出→后→弃牌堆,两张牌面朝下同时扣置)
//       3) 结算输赢 → 设对应 turn.vars
//   - 赢效果:turn.vars['巧说/winNext'] = owner。语义"下一张牌可多/少指定一个目标":
//     · +1 目标(杀):注册 slashTargetProvider,winNext 生效时返回 2(与天义/方天画戟同构,
//       后端 canUseSlash→slashTargetMax 权威放行);并投影 turnUsage['杀/target/界巧说']=1
//       供前端 viewSlashTargetMax 放宽多选(否则前端只允许选 1 个目标)。
//     · -1 目标:语义较窄(杀默认 min=1,少选即可),引擎层无需额外实现。
//     · "下一张"语义:after-hook 挂「移动牌」—— owner 从手牌打出一张牌到处理区时,
//       清除 winNext + turnUsage 投影(本回合下一张牌的 +/- 目标效果已被消费)。
//   - 没赢效果:turn.vars['巧说/lost'] = owner + 注册 trickBlocker。
//     trickBlocker 是查询型谓词(state-bound,WeakMap 注册表),
//     validateUseCard 在校验普通锦囊 use 时查询;生效后 owner 不能使用任何普通锦囊牌。
//   - 拼点点数:A=1, 2-10=面值, J=11, Q=12, K=13;严格大于才算赢,相等算没赢。
//
// 命名:文件名/loader key/character skill name 均为 '界巧说'(避开标版潜在冲突);
//   内部 Skill.name = '巧说'(OL 官方技能名,玩家可见)。
// use action 骨架(七连检 validate + 拼点仪式 + 输赢分支)由 flows/rank 的
// registerRankUseAction/defineRankUseAction 提供,本文件只注入赢/没赢的 turn.vars 结算差异。
import type {
  FrontendAPI,
  GameState,
  Skill,
} from '../types';
import { projectTurnUsage } from '../rules/turn-usage';
import { registerRankUseAction, defineRankUseAction } from '../flows/rank';
import { activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { registerAfterHook } from '../core/skill';
import { registerTrickBlocker } from '../rules/trick-quota';
import { registerSlashTargetProvider } from '../rules/slash-target';
import type { SkillModule } from '../types';
import { slashTargetKey } from '../rules/vars-keys';

const SKILL_ID = '界巧说';
const DISPLAY_NAME = '巧说';

/** 赢效果标记:owner 本回合下一张牌可 +/-1 目标。 */
const WIN_NEXT_VAR = '巧说/winNext';
/** 没赢效果标记:owner 本回合不能使用普通锦囊牌。 */
const LOST_VAR = '巧说/lost';
/** 杀目标数 view 投影 key:赢后下一张杀可多指定一个目标(前端 viewSlashTargetMax 读 '杀/target/' 前缀叠加)。 */
const SLASH_TARGET_TU = slashTargetKey('界巧说');

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次拼点:赢则本回合下一张牌可多/少指定一个目标;没赢则本回合不能使用锦囊牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── 没赢效果提供者:trickBlocker(查询型,state-bound 注册表) ───
  // onInit 注册一次,谓词动态读 turn.vars;技能卸载时随 unload 清理。
  const unloadBlocker = registerTrickBlocker(
    state,
    ownerId,
    (st: GameState, player: number) => st.turn.vars[LOST_VAR] === player,
  );

  // ─── 赢效果提供者:杀目标数 +1(winNext 生效时返回 2,与天义同构) ───
  // 后端 canUseSlash→slashTargetMax 权威放行;"下一张"消费语义由 移动牌 after-hook
  // 清 winNext 落实:打出第一张牌后 provider 归 0。
  const unloadTargetProvider = registerSlashTargetProvider(
    state,
    ownerId,
    (st: GameState, player: number) => (st.turn.vars[WIN_NEXT_VAR] === player ? 2 : 0),
  );

  // ─── use action:owner 主动发动巧说拼点(拼点 use-action 骨架工厂) ──
  registerRankUseAction(state, skill.id, ownerId, {
    displayName: DISPLAY_NAME,
    // 赢:下一张牌可 +/-1 目标。turn.vars['巧说/winNext'] 驱动 slashTargetProvider(+1 杀目标);
    // 投影 turnUsage['杀/target/界巧说']=1 供前端 viewSlashTargetMax 放宽多选。
    // 移动牌 after-hook 在 owner 下张牌打出时清除 winNext + 投影(消费"下一张")。
    // state 存座次(from)、view 投影常量 1,key/值不同 → 走 projectTurnUsage。
    onWin: async (st, from) => {
      st.turn.vars[WIN_NEXT_VAR] = from;
      await projectTurnUsage(st, from, SLASH_TARGET_TU, 1);
    },
    // 没赢:本回合不能使用锦囊牌(由 trickBlocker + validateUseCard 落实)
    // state 存座次、view 投影 true → 同上走 projectTurnUsage。
    onLose: async (st, from) => {
      st.turn.vars[LOST_VAR] = from;
      await projectTurnUsage(st, from, LOST_VAR, true);
    },
    respondMismatchError: '当前不是巧说回应',
  });

  // ─── respond action:为所有玩家注册 ────────────────────────
  // target(其他玩家)需要 respond 选拼点牌。默认 respond 只注册在 owner 上,
  // 目标无法 dispatch,故为每个玩家注册(封装于工厂内 registerRankCardRespond,
  // validate 严格检查 pending requestType)。

  // ─── 清理 winNext:owner 下一张牌打出时消费 ───────────────────
  // 监听 移动牌 from 手牌(owner)→ 处理区:即 owner 出牌/打牌的时机。
  // 巧说自身的拼点牌打出在 winNext 设置之前 → 不会误清。后续任一张牌打出 → 清除标记。
  // 注意:本 hook 注册到 SKILL_ID + ownerId,仅在 owner 持有 巧说 实例时生效。
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '移动牌') return;
    if (atom.from.zone !== '手牌') return;
    if (atom.from.player !== ownerId) return;
    if (atom.to.zone !== '处理区') return;
    // 仅在 winNext 当前生效时清除(消费"下一张牌"的 +/- 目标效果)
    if (ctx.state.turn.vars[WIN_NEXT_VAR] === ownerId) {
      delete ctx.state.turn.vars[WIN_NEXT_VAR];
      await projectTurnUsage(ctx.state, ownerId, SLASH_TARGET_TU, false);
    }
  });

  return () => {
    unloadBlocker();
    unloadTargetProvider();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  defineRankUseAction(api, {
    label: DISPLAY_NAME,
    style: 'primary',
    title: '巧说:选择一张拼点牌和一名目标',
    activeWhen: (ctx) =>
      activeUnlessUsedThisTurn(SKILL_ID)(ctx) &&
      (ctx.view.players[ctx.perspectiveIdx]?.hand?.length ?? 0) > 0,
    // respond(拼点牌选择):前端通过 pending prompt 渲染
    respondTitle: '巧说:请出一张拼点牌',
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
