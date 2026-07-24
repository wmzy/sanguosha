// 界陷阵(界高顺·群·主动技,OL hero/604 界限突破官方逐字):
//   "出牌阶段限一次，你可以与一名角色拼点：若你赢，你本回合对其使用牌无距离和次数限制
//    且无视其防具，你使用【杀】或普通锦囊牌能多指定其为目标；若你没赢，你本回合不能
//    对其使用【杀】且你的【杀】不计入手牌上限。"
//
// 界限突破(相对标 高顺 陷阵,docs/research/武将技能/群雄/高顺.md):
//   1. 标版"使用仅指定唯一目标的【杀】或普通锦囊牌可以多指定其为目标"
//      界版去掉"仅指定唯一目标"前提 → 任意【杀】/普通锦囊牌均可多指定其为目标。
//   2. 标版"不能使用【杀】"(全回合禁杀);界版"不能对其使用【杀】"(仅对拼点目标禁杀)。
//   3. 标版"你的【杀】不计入手牌上限";界版相同。
//   标版高顺未实现,按界武将命名约定独立创建"界陷阵.ts"。
//
// 实现要点:
//   - 限一次:player.vars['界陷阵/usedThisTurn'](后缀约定,回合结束 atom 自动清空)。
//   - 拼点流程(参考 天义.ts):
//       1) 请求回应(target 选拼点牌)
//       2) runRankCompareFlow(扣置→亮出→后→弃牌堆,两张牌面朝下同时扣置)
//       3) 结算输赢 → 设对应 turn.vars
//   - 赢效果:
//       turn.vars['陷阵/winTarget'] = target(座次下标,回合结束自动清空)。
//       · 无距离:distance.ts 的 inAttackRange/effectiveDistance 据此对 target 放行(横切)。
//         覆盖【杀】(inAttackRange)与所有 distance-based 锦囊(effectiveDistance,如顺手牵羊)。
//       · 无次数:registerSlashUnlimitedProvider 返回 true(owner 本回合出杀无上限)。
//         严格规则下"仅对此目标无次数",但引擎 slash-quota 不感知 target,简化为全局无限。
//       · 无视防具:青釭剑模式——指定目标 after-hook 临时卸载 target 防具技能实例,
//         造成伤害 after-hook 恢复。仅对 winTarget 触发,其他 target 不受影响。
//       · 多指定为目标:需各锦囊/杀 validate 配合,引擎层不易统一,本实现暂以 distance/次数
//         放行间接落实【杀】多目标(目标数不限+距离无限);普通锦囊多目标保留为待扩展。
//   - 没赢效果:
//       turn.vars['陷阵/lostTarget'] = target(座次下标)。
//       · 不能对其使用【杀】:成为目标 before-hook(owner 为 source 且 target=lostTarget)→ cancel。
//         杀.execute 检测 becameTarget=false 跳过该目标结算(不询问闪、不伤害)。
//       · 你的【杀】不计入手牌上限:registerHandLimitProvider 返回 默认公式+手牌中杀牌数。
//         (镜像 界将驰 选项① / 界洛神 思路)
//   - 拼点点数:A=1, 2-10=面值, J=11, Q=12, K=13;严格大于才算赢,相等算没赢。
//
// 命名:文件名/loader key/character skill name 均为 '界陷阵'(避开标版潜在冲突);
//   内部 Skill.name = '陷阵'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { runRankCompareFlow } from '../rank-flow';
import {
  registerAction,
  registerAfterHook,
  registerBeforeHook,
  unloadSkillInstance,
  instantiateSkill,
  type SkillModule,
} from '../skill';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerSlashUnlimitedProvider } from '../slash-quota';
import { registerHandLimitProvider } from '../hand-limit';
import { registerDistanceExemptor, registerAttackRangeExemptor } from '../distance';
import { defaultPlayActive } from '../action-active';

const SKILL_ID = '界陷阵';
const DISPLAY_NAME = '陷阵';

const TARGET_CARD_KEY = `${SKILL_ID}/targetCard`;
const PD_RT = `${SKILL_ID}/拼点`;
/** 赢效果标记:owner 本回合对 target 使用牌无距离/次数限制且无视防具。值=目标座次。 */
const WIN_VAR = '陷阵/winTarget';
/** 没赢效果标记:owner 本回合不能对 target 使用杀。值=目标座次。 */
const LOST_VAR = '陷阵/lostTarget';

/** 拼点牌点数:A=1, 2-10=面值, J=11, Q=12, K=13。 */
function rankValue(rank: string): number {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次,与一名角色拼点:赢则本回合对其使用牌无距离和次数限制且无视防具,可多指定其为目标;没赢则本回合不能对其使用杀,且你的杀不计入手牌上限',
  };
}

/** state-bound:记录当前被界陷阵临时卸载的 target 防具,供 造成伤害 after hook 恢复。
 *  key = target 座次(防具归属),value = { target, skillId }。 */
const tempUnloadByState = new WeakMap<
  GameState,
  Map<number, { target: number; skillId: string }>
>();

function getTempUnloadMap(
  state: GameState,
): Map<number, { target: number; skillId: string }> {
  let m = tempUnloadByState.get(state);
  if (!m) {
    m = new Map();
    tempUnloadByState.set(state, m);
  }
  return m;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── 无限出杀提供者:拼点赢后本回合 ∞(对其使用牌无次数限制)──
  //   严格规则下"仅对 winTarget 无次数",slash-quota 不感知 target,简化为全局 ∞。
  const unloadProvider = registerSlashUnlimitedProvider(
    state,
    ownerId,
    (st: GameState, player: number) =>
      typeof st.turn.vars[WIN_VAR] === 'number' && player === ownerId,
  );

  // ─── 通用距离豁免器:拼点赢后对其用牌无距离(覆盖杀 + distance-based 锦囊) ──
  //   通过 distance.registerDistanceExemptor 注册,避免污染 杀.ts/distance.ts。
  const unloadDistExemptor = registerDistanceExemptor(
    state,
    ownerId,
    (st, from, to) => st.turn.vars[WIN_VAR] === to && from === ownerId,
  );

  // ─── 【杀】距离豁免器:语义上与通用豁免器重叠(杀走 AttackRangeExemptor),
  //   由于 inAttackRange 先看 AttackRangeExemptor 再调 effectiveDistance,仅注册通用
  //   豁免器即可覆盖杀——不重复注册。

  // ─── 手牌上限豁免:拼点没赢后本回合 杀不计入手牌上限 ──
  //   覆盖型 provider:返回 默认公式(体力+加成) + 手牌中【杀】牌数量。
  //   把杀牌占用的名额加回上限,等价于杀牌不占上限。仅在 owner 处于 lost 状态时生效。
  //   (镜像 界将驰 选项① 思路)
  const unloadHandLimit = registerHandLimitProvider(state, ownerId, (st, player) => {
    if (player !== ownerId) return undefined;
    if (typeof st.turn.vars[LOST_VAR] !== 'number') return undefined;
    const p = st.players[player];
    if (!p) return undefined;
    const slashCount = p.hand.filter((cid) => st.cardMap[cid]?.name === '杀').length;
    if (slashCount === 0) return undefined;
    const bonus = (st.turn.vars[`手牌上限/bonus:${player}`] as number | undefined) ?? 0;
    const health = p.health ?? 0;
    return health + bonus + slashCount;
  });

  // ─── use action:owner 主动发动界陷阵拼点 ────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过陷阵';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const cardId = params.cardId as string;
      if (typeof cardId !== 'string') return '需要选择一张拼点牌';
      if (!self.hand.includes(cardId)) return '拼点牌不在手牌中';
      const target = params.target as number;
      if (typeof target !== 'number') return '需要选择拼点目标';
      if (target === ownerId) return '不能与自己拼点';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不存在或已死亡';
      if (targetPlayer.hand.length === 0) return '目标没有手牌,无法拼点';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const initiatorCardId = params.cardId as string;
      const target = params.target as number;

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, from, SKILL_ID);

      await pushFrame(st, SKILL_ID, from, { ...params });

      const initiatorCard = st.cardMap[initiatorCardId];
      const initiatorValue = initiatorCard ? rankValue(initiatorCard.rank) : 0;

      // 1) 询问 target 出拼点牌。拼点牌暂不移入处理区——由 runRankCompareFlow 的
      //    拼点扣置 统一同时扣置(面朝下),对齐 rankcompare.md。
      delete st.localVars[TARGET_CARD_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: PD_RT,
        target,
        prompt: {
          type: 'useCard',
          title: `陷阵:与 ${st.players[from].name} 拼点,请出一张手牌`,
          cardFilter: { min: 1, max: 1 },
        },
        timeout: 30,
      });

      const targetCardId = st.localVars[TARGET_CARD_KEY] as string | undefined;
      delete st.localVars[TARGET_CARD_KEY];

      // 2) 拼点两步化(扣置→亮出→后→弃牌堆)。target 未出牌(超时)走兜底。
      let win: boolean;
      if (targetCardId && st.players[target].hand.includes(targetCardId)) {
        const result = await runRankCompareFlow(st, from, target, initiatorCardId, targetCardId);
        win = result === '赢';
      } else {
        // target 未出牌(超时):清理发起方拼点牌(手牌→弃牌堆),按发起方默认胜出(保留旧行为)。
        await applyAtom(st, {
          type: '移动牌',
          cardId: initiatorCardId,
          from: { zone: '手牌', player: from },
          to: { zone: '弃牌堆' },
        });
        win = initiatorValue > 0;
      }

      // 3) 结算输赢:发起方点数严格大于目标 = 赢;否则(输或平)没赢
      if (win) {
        st.turn.vars[WIN_VAR] = target;
        await applyAtom(st, { type: '回合用量', player: from, key: WIN_VAR, value: target });
      } else {
        st.turn.vars[LOST_VAR] = target;
        await applyAtom(st, { type: '回合用量', player: from, key: LOST_VAR, value: target });
      }

      await popFrame(st);
    },
  );

  // ─── respond action:为所有玩家注册(目标需 respond 选拼点牌) ────────
  for (const p of state.players) {
    const pid = p.index;
    registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as unknown as Record<string, unknown>;
        if (atom.type !== '请求回应') return '当前不需要回应';
        const reqType = atom.requestType as string;
        if (reqType !== PD_RT) return '当前不是陷阵回应';
        if ((atom.target as number) !== pid) return '不是问你的';
        const cardId = params.cardId as string;
        if (typeof cardId !== 'string') return '请选择一张拼点牌';
        if (!st.players[pid].hand.includes(cardId)) return '拼点牌不在手牌中';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return;
        const atom = slot.atom as unknown as Record<string, unknown>;
        if (atom.type !== '请求回应' || (atom.requestType as string) !== PD_RT) return;
        st.localVars[TARGET_CARD_KEY] = params.cardId;
      },
    );
  }

  // ─── 指定目标 after hook:win 效果——临时卸载 winTarget 的防具技能实例 ──
  //   仅当 source=owner 且 target=winTarget 时触发(其他 source/target 不影响)。
  //   模式参考 青釭剑.ts:卸载只移除 hook 实例,不触发 卸下(装备仍在装备区)。
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '指定目标',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      const winTarget = ctx.state.turn.vars[WIN_VAR];
      if (typeof winTarget !== 'number') return;
      if (atom.target !== winTarget) return;
      const targetPlayer = ctx.state.players[winTarget];
      if (!targetPlayer) return;
      const armorId = targetPlayer.equipment?.['防具'];
      if (!armorId) return;
      const armorCard = ctx.state.cardMap[armorId];
      if (!armorCard) return;
      const armorSkillId = armorCard.name;
      if (!armorSkillId || !targetPlayer.skills.includes(armorSkillId)) return;
      // 已被本技能卸载 → 不重复
      if (getTempUnloadMap(ctx.state).has(winTarget)) return;
      unloadSkillInstance(ctx.state, armorSkillId, winTarget);
      getTempUnloadMap(ctx.state).set(winTarget, { target: winTarget, skillId: armorSkillId });
    },
  );

  // ─── 造成伤害 after hook:win 效果——恢复被临时卸载的 winTarget 防具 ──
  //   杀对 winTarget 造成伤害后立即恢复(无论命中/被闪;只要造成伤害 atom 跑过)。
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '造成伤害后',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      const winTarget = ctx.state.turn.vars[WIN_VAR];
      if (typeof winTarget !== 'number') return;
      if (atom.target !== winTarget) return;
      const unloaded = getTempUnloadMap(ctx.state).get(winTarget);
      if (!unloaded) return;
      await instantiateSkill(ctx.state, unloaded.skillId, winTarget);
      getTempUnloadMap(ctx.state).delete(winTarget);
    },
  );

  // ─── 成为目标 before hook:lost 效果——owner 不能对 lostTarget 使用杀 ──
  //   杀.execute 检测 becameTarget=false → 跳过该目标结算(不询问闪、不伤害)。
  //   杀牌仍被消耗(移入弃牌堆),owner 等同"白白打出一张杀"——符合"不能用"的语义。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '成为目标',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      const lostTarget = ctx.state.turn.vars[LOST_VAR];
      if (typeof lostTarget !== 'number') return;
      if (atom.target !== lostTarget) return;
      // 仅拦截【杀】(基本牌杀,含物理杀与武圣/丈八转化出的杀——cardMap.name 判定)
      const cardId = atom.cardId;
      if (typeof cardId !== 'string') return;
      const card = ctx.state.cardMap[cardId];
      if (!card || card.name !== '杀') return;
      return { kind: 'cancel' };
    },
  );

  return () => {
    unloadProvider();
    unloadHandLimit();
    unloadDistExemptor();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张手牌与一名其他角色拼点(陷阵)',
      cardFilter: { min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) => {
          const target = view.players[t];
          if (!target?.alive) return false;
          if (target.index === view.currentPlayerIndex) return false;
          // 目标需有手牌(拼点要求)
          return (target.handCount ?? 0) > 0;
        },
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      if (!activeUnlessUsedThisTurn(SKILL_ID)(ctx)) return false;
      // 需有手牌(拼点牌)
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return (p.handCount ?? 0) > 0;
    },
  });
  return;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
