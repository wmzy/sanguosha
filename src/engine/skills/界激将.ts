// 界激将(界刘备·主公技):
//   主公技,其他蜀势力角色可以在你需要时使用或打出【杀】(视为由你使用或打出);
//   每回合限一次,其他蜀势力角色于其回合外使用、打出或替你使用或打出【杀】时,
//   其可以令你摸一张牌。
//
// OL 官方:
//   "主公技,其他蜀势力角色可以在你需要时使用或打出【杀】(视为由你使用或打出);
//    每回合限一次,其他蜀势力角色于其回合外使用、打出或替你使用或打出【杀】时,
//    其可以令你摸一张牌。"
//
// 与标激将区别:
//   - 标激将:仅主动技形式(主公 dispatch → 蜀角色出杀/不出,不出则主公摸1)。
//   - 界激将:① 沿用标激将主动技机制;② 新增被动触发——蜀角色于其回合外用杀
//     (使用/打出/替你使用),其可令主公摸1张(每回合限一次,选择权在该蜀角色)。
//
// 实现要点:
//   - 主动技 use/respond 两分支与 onMount 复用标版共享实现(见 激将.ts 的
//     registerJijiangUseAction / registerJijiangRespondActions / mountJijiangActions),
//     ownerId===0(主公固定0号位)门槛不变;damageType 由 cardMap 自动传导(火杀/雷杀不丢)。
//   - 界版真增量 = 回合外摸牌双 hook(本文件):
//     · 指定目标 after-hook:蜀角色 source 回合外用杀指定目标 → 询问是否令主公摸1。
//       "使用/替你使用杀" 均会触发 指定目标 atom(杀 use 流程必经),覆盖主路径。
//     · 询问杀 after-hook:"打出杀"(南蛮入侵/决斗 被询问杀后把杀移入处理区)不走
//       指定目标,故另挂:atom.target(打出方)为蜀角色且回合外且确实打出杀 → 触发摸牌。
//     · "每回合限一次":用 state.turn.vars[PER_TURN_VAR](两条 hook 共享,同一回合只摸一次)。
//   - respond 第三分支(被动型 drawChoice)经 RESPOND_OPTIONS 的 extraRequestTypes 注入共享注册。
import type { FrontendAPI, GameState, Skill, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { frameCards } from '../core/frame';
import { registerAfterHook, declareAlternativeResponse } from '../core/skill';
import { askConfirm } from '../util/skillRuntime';
import {
  registerJijiangUseAction,
  registerJijiangRespondActions,
  mountJijiangActions,
  type JijiangRespondOptions,
} from './激将';

// localVars keys(界激将新增被动触发)
const REQUEST_TYPE = '界激将/drawChoice';
const CONFIRMED_VAR = '界激将/confirmed';
// 每回合限一次标记:存 state.turn.vars(回合结束 atom 清空 turn.vars → 自动复位)
const PER_TURN_VAR = '界激将/triggered';
// use(代使用)路径的 localVars 键 / requestType 常量(对齐 标激将/乱武 风格)
const USE_REQUEST_TYPE = '界激将/出杀';
const USE_CHOICE_VAR = '界激将/出杀选择';
const USE_KILL_TARGET_VAR = '界激将/killTarget';
// 代打出路径 localVars 键:主公被询问杀时,记录替主公打出杀的蜀角色座次
// (询问杀 after-hook 读此键判定"替你打出"触发;代打出 execute 写,询问杀 hook 读后即删)
const SUBSTITUTE_PLAYER_VAR = '界激将/代打出者';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界激将',
    description: '主公技:蜀势力角色可代你使用或打出杀;每回合限一次,蜀角色回合外用杀时可令你摸1张',
  };
}

/** 两条回合外摸牌 hook 共用的收尾:标记限一次(含 回合用量 投影) → 询问触发蜀角色 → 确认则主公摸 1。 */
async function offerLordDraw(
  state: GameState,
  ownerId: number,
  triggerIdx: number,
  lordName: string,
): Promise<void> {
  // 标记本回合已触发(同步写 turn.vars 防止 hook 重入;turn.vars 由回合结束自动清空)
  state.turn.vars[PER_TURN_VAR] = true;
  await applyAtom(state, {
    type: '回合用量',
    player: ownerId,
    key: PER_TURN_VAR,
    value: true,
  });

  // 询问蜀角色是否令主公摸1张(描述"可以"=可选;选择权在该蜀角色)
  if (
    await askConfirm(state, REQUEST_TYPE, triggerIdx, {
      confirmedKey: CONFIRMED_VAR,
      title: `界激将:是否令${lordName}摸一张牌?`,
      confirmLabel: '令主公摸牌',
      cancelLabel: '不发动',
      defaultChoice: false,
      timeout: 30,
    })
  ) {
    // 蜀角色选择发动 → 主公(刘备)摸 1 张
    await applyAtom(state, { type: '摸牌', player: ownerId, count: 1 });
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const offs: Array<() => void> = [];
  offs.push(declareAlternativeResponse(state, ownerId, '询问杀'));

  // ── use:主动激将(沿用标激将机制) ──
  offs.push(
    registerJijiangUseAction(state, skill, {
      displayName: '界激将',
      requestType: USE_REQUEST_TYPE,
      choiceVar: USE_CHOICE_VAR,
      killTargetVar: USE_KILL_TARGET_VAR,
      useError: '现在不能使用界激将',
    }),
  );

  // ── 指定目标 after hook:蜀角色回合外用杀 → 询问是否令主公摸1张 ──
  offs.push(
    registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx): Promise<void> => {
      // 主公技:仅刘备为主公(座次 0)时生效
      if (ownerId !== 0) return;
      const atom = ctx.atom;
      const sourceIdx = atom.source;
      if (typeof sourceIdx !== 'number') return;
      // 必须是其他蜀势力角色(非主公刘备本人)
      if (sourceIdx === ownerId) return;
      const source = ctx.state.players[sourceIdx];
      if (!source?.alive) return;
      if (source.faction !== '蜀') return;
      // 必须是 杀(检测 cardMap,兼容武圣等转化后的杀卡)
      const cardId = atom.cardId;
      if (!cardId) return;
      const card = ctx.state.cardMap[cardId];
      if (card?.name !== '杀') return;
      // 必须是该蜀角色"回合外"(当前回合不是其本人回合)
      if (ctx.state.currentPlayerIndex === sourceIdx) return;
      // 主公需存活(否则无人摸牌)
      const lord = ctx.state.players[ownerId];
      if (!lord?.alive) return;
      // 每回合限一次(本回合已触发过则跳过)
      if (ctx.state.turn.vars[PER_TURN_VAR] === true) return;

      await offerLordDraw(ctx.state, ownerId, sourceIdx, lord.name);
    }),
  );

  // ── 询问杀 after hook:蜀角色回合外「打出」杀(南蛮入侵/决斗)→ 询问是否令主公摸1张 ──
  //   使用杀走 runUseFlow→「指定目标」(由上面的 hook 覆盖);打出杀(被询问后把杀移入
  //   处理区)不走「指定目标」,故另挂「询问杀」after-hook。
  //   触发者(打出方)分两种:
  //   · 直接打出:atom.target=蜀角色本人(被决斗/南蛮询问杀)→ triggerIdx=askedIdx。
  //   · 代打出(替你打出):atom.target=主公(主公被询问杀,经激将 respond 令蜀盟友替打)→
  //     激将 代打出 execute 已把替打蜀角色记入 SUBSTITUTE_PLAYER_VAR,hook 读此键得 triggerIdx。
  //     (OL:"替你使用或打出杀时"含代打出,故此处须覆盖。)
  //   · 须确认确实打出了一张杀(处理区有杀——调用方的 consumePlayedSlashes 在本 after-hook
  //     之后才清理,故 frameCards 仍含杀)。
  //   · 与「指定目标」hook 共享 PER_TURN_VAR,同一回合只摸一次。
  offs.push(
    registerAfterHook(state, skill.id, ownerId, '询问杀', async (ctx): Promise<void> => {
      if (ownerId !== 0) return;
      const atom = ctx.atom;
      const askedIdx = atom.target;
      if (typeof askedIdx !== 'number') return;
      // 确定触发者(打出方):
      //   askedIdx !== ownerId → 蜀角色本人直接打出;
      //   askedIdx === ownerId → 代打出(主公被询问杀),替打蜀角色经 SUBSTITUTE_PLAYER_VAR 传递。
      let triggerIdx: number;
      if (askedIdx === ownerId) {
        const sub = ctx.state.localVars[SUBSTITUTE_PLAYER_VAR] as number | undefined;
        delete ctx.state.localVars[SUBSTITUTE_PLAYER_VAR];
        if (typeof sub !== 'number') return; // 主公自己打出/无人替打
        triggerIdx = sub;
      } else {
        triggerIdx = askedIdx;
      }
      const trigger = ctx.state.players[triggerIdx];
      if (!trigger?.alive) return;
      if (trigger.faction !== '蜀') return;
      // 必须是该蜀角色"回合外"
      if (ctx.state.currentPlayerIndex === triggerIdx) return;
      // 必须实际打出了一张杀(询问杀 resolve 后杀牌仍在处理区)
      const playedKill = frameCards(ctx.state).some((id) => ctx.state.cardMap[id]?.name === '杀');
      if (!playedKill) return;
      const lord = ctx.state.players[ownerId];
      if (!lord?.alive) return;
      // 每回合限一次(与「指定目标」hook 共享 PER_TURN_VAR)
      if (ctx.state.turn.vars[PER_TURN_VAR] === true) return;

      await offerLordDraw(ctx.state, ownerId, triggerIdx, lord.name);
    }),
  );

  // ── respond:注册到全座次,按 pending 内容分支 ────────────────
  //   atom.type==='询问杀'(主公 seat):响应型代打出(杀/respondKill 逐个询问,杀留处理区);
  //   atom.requestType==='界激将/出杀'(蜀角色 seat):主动型代使用(选杀+指定 killTarget → capture);
  //   atom.requestType==='界激将/drawChoice'(蜀角色 seat):被动触发(是否令主公摸1)。
  //   一个座次仅能有一个 respond action(registerAction 按座次去重),故合并到同一注册。
  const respondOptions: JijiangRespondOptions = {
    displayName: '界激将',
    useRequestType: USE_REQUEST_TYPE,
    useChoiceVar: USE_CHOICE_VAR,
    killTargetVar: USE_KILL_TARGET_VAR,
    respondError: '当前不是界激将询问',
    // 代打出 execute:处理区出现杀后记录替打蜀角色(供 询问杀 after-hook 判定"替你打出"触发。
    // OL:"替你使用或打出杀时"含代打出。询问杀 atom.target=主公,故 hook 无法从 atom 直接
    // 得知代打者,经此 localVars 传递)
    onSubstituteKill: (st, allyIdx) => {
      st.localVars[SUBSTITUTE_PLAYER_VAR] = allyIdx;
    },
    extraRequestTypes: [REQUEST_TYPE],
    // 被动型(drawChoice):记录是否令主公摸牌
    onExtraRequest: (st, _seat, _requestType, params) => {
      st.localVars[CONFIRMED_VAR] = params.choice === true || params.confirmed === true;
    },
  };
  offs.push(...registerJijiangRespondActions(state, skill, respondOptions));

  return () => {
    for (const off of offs) off();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  return mountJijiangActions(skill, api, {
    label: '界激将',
    useTitle: '界激将：选择一名蜀势力角色出杀',
    respondTitle: '界激将:令蜀势力角色替你打出杀?',
    useRequestType: USE_REQUEST_TYPE,
    extraRequestTypes: [REQUEST_TYPE],
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
