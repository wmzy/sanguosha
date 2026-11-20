// src/engine/skills/蛊惑.ts
// 蛊惑(于吉·群·转化技):每回合限一次,你可以扣置一张手牌当任意基本牌
//   (杀/闪/桃/酒)使用或打出。其他角色可依次质疑:
//     - 无人质疑:该牌视为所声明的基本牌生效。
//     - 有人质疑,翻开此牌:
//         · 真(确实是声明的牌):质疑者失去1点体力,该牌按声明使用。
//         · 假(不是声明的牌):质疑者获得此牌,该牌作废。
//
// 规则来源:docs/design/引擎缺失能力.md 第12项 + 标准三国杀(风扩展包·于吉)。
// 注:docs/research/武将技能/群雄/于吉.md 中 officialDesc(真→缠怨/假→作废)为界版口径,
//   本标版实现沿用既有"标准规则"(真→质疑者失1体力/假→质疑者获牌且作废;每回合限一次),
//   与现有测试及 research "实现要点"一致;真→缠怨需独立"缠怨"技能,不在本技能范围。
//
// 本文件同时承载标版/界版的共享入口(registerGuEntries + mountGuActions):
// 界蛊惑.ts import 并注入界版差异(质疑流程 runQuestioning 与 respond 分支)。
// 标界同构的部分:use×3(声明杀/桃/酒)/dodge(闪)/rescue(桃) 五个入口的注册与校验、
// 蛊惑-杀结算(resolveGuSlash)、影子提供(provideAsBasicToProcessing)、
// 按声明生效(applyDeclaredEffect)、onMount 全部 defineAction 与激活判定。
// 真实差异(界版,见 界蛊惑.ts):同时质疑(全面收集质疑者)、真→缠怨+弃牌或失体力、
// 假→质疑者摸牌、respond 三分支。
//
// 三类入口(共用 runQuestioning 质疑流程):
//   1. use(主动,杀/桃/酒):出牌阶段、自己回合、无阻塞 pending、存活、本回合未用过。
//      params: { cardId(扣牌), target?(杀的目标) }; 声明牌名编码在 actionType(use:杀/use:桃/use:酒)。
//   2. dodge(响应·闪):被【杀】指定(询问闪 pending 命中自己)时,扣一张手牌声明为闪打出。
//      质疑无人/真 → 提供一张"闪"到当前结算帧处理区(供杀结算检测处理区有闪 → 抵消)。
//   3. rescue(响应·桃濒死救援):濒死求桃(桃/求桃 pending 命中自己)时,扣一张手牌声明为桃打出。
//      质疑无人/真 → 置 localVars['求桃/已救']=true(同 桃.respond/急救.respond,runDyingFlow 据此救援)。
//   闪无主动效果(不能主动"使用"闪),故 use 不接受声明闪;闪仅经 dodge 响应路径打出。
//
// runQuestioning(质疑流程,各入口共用):
//   a. 扣牌 atom:手牌→弃牌堆(面朝下,身份对他人隐藏),声明公开。记录 localVars。
//   b. 质疑循环:从于吉下家起按座次 for 遍历每个其他存活角色 →
//        请求回应('蛊惑/质疑', target=该角色, confirm prompt)。
//        respond(质疑)= 设 localVars['蛊惑/质疑者']; pass/超时 = 不质疑。
//        首个质疑者即触发翻牌,后续不再询问(标准规则:质疑者 singular)。
//   c. 结算分叉:
//        - 无人质疑 → voided=false(按声明生效)。
//        - 有人质疑 → 展示 atom(翻开,广播真实身份):
//            · 真 → 失去体力(质疑者,1) → voided=false。
//            · 假 → 移动牌(扣牌 弃牌堆→质疑者手牌) → voided=true(作废)。
//
// 蛊惑-杀(use 声明杀,生效路径):扣牌留弃牌堆(不进处理区,避免 cardMap 暴露真身破坏隐藏信息),
//   杀结算复用 cards/_virtualSlash.runVirtualSlash(时机 atom 序列与实体杀一致:成为目标→检测有效性→
//   询问闪(promptCancel 统一闪清理)→被抵消/伤害;武器技/无双按杀帧 hook 生效)。
//   虚拟杀经 physicalCard 借用扣牌花色/颜色/点数/伤害属性——仁王盾按物理花色判假杀,
//   火杀保留火焰伤害;charge:true 计入出杀次数。
//
// respond(质疑)注册到每个座次(被问询者非于吉),onInit 返回合并卸载函数
//   (unloadSkillInstance 仅按 (skillId,于吉座次) 清 action,清不到其他座次)。
import type { ActionContext, FrontendAPI, GameState, Json, PendingSlot, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { registerAction, declareAlternativeResponse } from '../core/skill';
import { canSlash } from '../rules/slash-quota';
import { usedThisTurn, markOncePerTurn } from '../rules/once-per-turn';
import { usedThisTurnKey } from '../rules/vars-keys';
import { viewCanAttack } from '../rules/viewDistance';
import { viewCanSlash } from '../rules/action-active';
import { USE_ACTION_PREFIX } from '../util/declaredActionType';
import { registerRespondForAllSeats, engineCanPlayNowReason, viewAskedDodge, defineConfirmAction, currentRequestType } from '../util/skillRuntime';
import { runVirtualSlash } from './cards/_virtualSlash';
import { canUseSlash } from './cards/杀';

const REQUEST_TYPE = '蛊惑/质疑';
const QUESTIONER_VAR = '蛊惑/质疑者';
const DOWNCARD_VAR = '蛊惑/扣牌';
const DECLARE_VAR = '蛊惑/声明';
const RESCUED_VAR = '求桃/已救';
/** 主动使用可声明的牌名(有主动效果);闪仅经 dodge 响应路径打出,故不在其中。 */
const ACTIVE_DECLARATIONS = ['杀', '桃', '酒'] as const;

type ActiveDeclaration = (typeof ACTIVE_DECLARATIONS)[number];

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '蛊惑',
    description: '每回合限一次,扣置一张手牌声明为基本牌(杀/闪/桃/酒)使用或打出;其他角色可质疑',
  };
}

/** 蛊惑-杀 生效后的杀结算:复用 runVirtualSlash(时机 atom 序列与实体杀一致——
 *  指定目标/成为目标/检测有效性/生效前/询问闪(经 promptCancel 统一闪清理)/被抵消/
 *  伤害/生效后,武器技与无双等杀帧 hook 均生效)。
 *  扣牌留弃牌堆(不进处理区,保隐藏——虚拟杀是独立 cardMap 条目,结算后即删);
 *  physicalCard 借用扣牌的花色/颜色/点数/伤害属性:仁王盾按物理花色判假杀(黑扣牌当杀
 *  会被无效),火杀扣牌保留火焰伤害。charge:true 计入出杀次数(标准 FAQ:真牌/无人质疑
 *  =正常使用;被闪抵消/仁王盾无效同样计次,与原实现无条件 incSlashUsed 一致)。 */
async function resolveGuSlash(
  state: GameState,
  source: number,
  target: number,
  cardId: string,
): Promise<void> {
  await runVirtualSlash(state, source, target, {
    prefix: '蛊惑',
    physicalCard: state.cardMap[cardId],
    charge: true,
  });
}

/** 将扣牌(在弃牌堆)经 弃牌堆→手牌→当作(影子 outputName)→手牌→处理区 提供到当前结算帧。
 *  供 dodge(闪)在质疑通过后向处理区提供一张"闪"(供杀结算检测处理区有闪 → 抵消)。
 *  影子复用 武圣/奇袭 的转化模型:入弃牌堆时按 shadowOf 还原为扣牌。 */
async function provideAsBasicToProcessing(
  state: GameState,
  yuji: number,
  concealedId: string,
  outputName: string,
  skillKey: string,
): Promise<void> {
  // 扣牌回手(经 移动牌 产生 ViewEvent,保持 processedView 一致;弃牌堆→手牌 不暴露牌面)
  await applyAtom(state, {
    type: '移动牌',
    cardId: concealedId,
    from: { zone: '弃牌堆' },
    to: { zone: '手牌', player: yuji },
  });
  const shadowId = `${concealedId}#${skillKey}${outputName}`;
  // 当作:扣牌(在手牌)→ 影子 outputName(手牌);影子 name=outputName 供处理区检测
  await applyAtom(state, {
    type: '当作',
    player: yuji,
    cardIds: [concealedId],
    shadowId,
    outputName,
  });
  // 影子打出进处理区(当前结算帧,即外层 杀 帧;蛊惑帧已弹出)
  await applyAtom(state, {
    type: '移动牌',
    cardId: shadowId,
    from: { zone: '手牌', player: yuji },
    to: { zone: '处理区' },
  });
}

/** 按声明的牌生效(扣牌已在弃牌堆=已使用)。 */
async function applyDeclaredEffect(
  state: GameState,
  source: number,
  declaredName: string,
  target: number | undefined,
  cardId: string,
): Promise<void> {
  if (declaredName === '杀') {
    if (typeof target !== 'number' || !state.players[target]?.alive) return;
    await resolveGuSlash(state, source, target, cardId);
  } else if (declaredName === '桃') {
    const tgt = typeof target === 'number' ? target : source;
    if (!state.players[tgt]?.alive) return;
    await applyAtom(state, { type: '回复体力', target: tgt, amount: 1, source });
  } else if (declaredName === '酒') {
    await applyAtom(state, {
      type: '加标记',
      player: source,
      mark: { id: '酒/nextKillDamageBonus', scope: -1, payload: 1, duration: 'turn' },
    });
  }
}

/** 蛊惑质疑流程(标版,各入口共用):扣牌 → 质疑循环 → (有人质疑)翻牌结算。
 *  返回 { voided: 是否作废(假牌被质疑), downCard: 扣牌 id, questioner?: 质疑者 }。 */
async function runQuestioning(
  state: GameState,
  yuji: number,
  cardId: string,
  declaredName: string,
): Promise<{ voided: boolean; downCard: string; questioner?: number }> {
  // ① 扣牌(面朝下,声明公开,真身对他人隐藏)
  await applyAtom(state, { type: '扣牌', player: yuji, cardId, declaredName });

  // ② 质疑循环:从下家起逆时针逐个询问,首个质疑者即翻牌
  const n = state.players.length;
  let questioner: number | undefined = undefined;
  for (let step = 1; step < n; step++) {
    const p = (yuji - step + n) % n;
    if (p === yuji) continue;
    if (!state.players[p]?.alive) continue;
    delete state.localVars[QUESTIONER_VAR];
    await applyAtom(state, {
      type: '请求回应',
      requestType: REQUEST_TYPE,
      target: p,
      prompt: {
        type: 'confirm',
        title: `是否质疑于吉声明为【${declaredName}】的蛊惑?`,
      },
      timeout: 20,
    });
    const q = state.localVars[QUESTIONER_VAR] as number | undefined;
    if (q !== undefined) {
      questioner = q;
      break; // 首个质疑者触发翻牌,后续不再询问
    }
  }

  const downCard = state.localVars[DOWNCARD_VAR] as string;
  if (questioner === undefined) {
    // ③a 无人质疑 → 按声明生效
    return { voided: false, downCard };
  }
  // ③b 有人质疑 → 翻开
  await applyAtom(state, { type: '展示', player: yuji, cardId: downCard });
  const isReal = state.cardMap[downCard]?.name === declaredName;
  if (isReal) {
    // 真:质疑者失去1点体力,然后按声明使用
    await applyAtom(state, { type: '失去体力', target: questioner, amount: 1 });
    return { voided: false, downCard, questioner };
  }
  // 假:质疑者获得此牌,该牌作废(扣牌 弃牌堆→质疑者手牌)
  await applyAtom(state, {
    type: '移动牌',
    cardId: downCard,
    from: { zone: '弃牌堆' },
    to: { zone: '手牌', player: questioner },
  });
  return { voided: true, downCard, questioner };
}

/** 清理本次蛊惑临时 localVars。 */
function cleanupVars(state: GameState): void {
  delete state.localVars[DOWNCARD_VAR];
  delete state.localVars[DECLARE_VAR];
  delete state.localVars[QUESTIONER_VAR];
}

/** 标版/界版共用入口的差异注入。 */
export interface GuEntryDeps {
  /** 技能键('蛊惑'|'界蛊惑'):限一次标记 + 影子卡 id 后缀 */
  readonly skillKey: string;
  /** 质疑流程(标版:首个质疑者即翻牌;界版:全面收集质疑者后统一翻牌) */
  readonly runQuestioning: (
    state: GameState,
    yuji: number,
    cardId: string,
    declaredName: string,
  ) => Promise<{ voided: boolean; downCard: string }>;
  /** 质疑流程后的 localVars 清理(在 popFrame 前调用;两版清理集不同) */
  readonly cleanupVars: (state: GameState) => void;
}

/**
 * 注册蛊惑的五个入口 + 替代回应声明(标版/界版共用):
 * declareAlternativeResponse×2 → use×3(`use:杀`/`use:桃`/`use:酒`) → dodge → rescue。
 * 质疑流程与 respond(质疑分支)由各版注入/自注册。
 */
export function registerGuEntries(
  state: GameState,
  skill: Skill,
  deps: GuEntryDeps,
): Array<() => void> {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];
  unloaders.push(declareAlternativeResponse(state, ownerId, '询问闪'));
  unloaders.push(declareAlternativeResponse(state, ownerId, '请求回应', '桃/求桃'));

  // ── use(主动发动:杀/桃/酒)──
  // 声明编码进 actionType(`use:杀`…):声明的牌名是 action 身份的一部分,不是客户端可选的
  // params —— 旧实现要求 params.declaredName,而浏览器/无头客户端都构造不出它,整条主动
  // 使用路径在真实客户端不可达(按钮点了没反应 / AI 枚举不出)。
  const registerDeclaredUse = (declaredName: ActiveDeclaration): (() => void) =>
    registerAction(
      state,
      skill.id,
      ownerId,
      `${USE_ACTION_PREFIX}${declaredName}`,
      (st: GameState, params: Record<string, Json>): string | null => {
        const playError = engineCanPlayNowReason(st, ownerId);
        if (playError) return playError;
        if (usedThisTurn(st, ownerId, deps.skillKey)) return '本回合已使用过蛊惑';
        const self = st.players[ownerId];
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string' || !self.hand.includes(cardId)) return '请选择一张手牌';
        if (declaredName === '杀') {
          // 目标必须显式给出且存活(canUseSlash 读数组,空 targets 不报错——单目标存在性
          // 由此处保证,错误文案保持原实现);范围/目标数上限复用 杀.ts 的 canUseSlash
          // (读 params.targets,dispatch 入口已归一 target/targets 两种形状)。
          // 出杀次数上限仍由 canSlash 自查(蛊惑 use 不走 validateCardUse,checkUsageLimit 不会代查)。
          const target = params.target as number | undefined;
          if (typeof target !== 'number' || !st.players[target]?.alive) return '请选择合法目标';
          const slashErr = canUseSlash(st, ownerId, params);
          if (slashErr) return slashErr;
          if (!canSlash(st, ownerId, cardId)) return '出杀次数已达上限';
        } else if (declaredName === '桃') {
          const target = (params.target as number | undefined) ?? ownerId;
          const tp = st.players[target];
          if (!tp?.alive) return '目标不存在';
          if (tp.health >= tp.maxHealth) return '桃只能对受伤角色使用';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const cardId = params.cardId as string;
        const target = params.target as number | undefined;
        // 限一次标记:第一个 await 前设置,防 dispatch 重入
        await markOncePerTurn(st, from, deps.skillKey);
        await pushFrame(st, '蛊惑', from, { cardId, declaredName });
        try {
          const result = await deps.runQuestioning(st, from, cardId, declaredName);
          if (!result.voided) {
            await applyDeclaredEffect(st, from, declaredName, target, result.downCard);
          }
        } finally {
          deps.cleanupVars(st);
          await popFrame(st);
        }
      },
    );
  for (const declaredName of ACTIVE_DECLARATIONS) unloaders.push(registerDeclaredUse(declaredName));

  // ── dodge/rescue(响应入口)共用工厂 ──
  // 两入口仅三处不同:窗口判定(询问闪 vs 请求回应+桃/求桃)、声明牌名('闪'/'桃')、
  // 质疑通过后的成功动作(向杀帧处理区提供闪 vs 置 RESCUED_VAR);validate 前奏与执行时序
  // (markOncePerTurn → pushFrame → runQuestioning → finally{cleanupVars; popFrame} → 成功动作)
  // 完全同构,由工厂统一承载——时序勿改(dispatch/测试依赖 finally 先清理后弹帧)。
  const registerGuResponse = (
    actionKind: string,
    checkWindow: (slot: PendingSlot) => string | null,
    declaredName: '闪' | '桃',
    onSuccess: (st: GameState, from: number, downCard: string) => Promise<void> | void,
  ): (() => void) =>
    registerAction(
      state,
      skill.id,
      ownerId,
      actionKind,
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(ownerId);
        if (!slot) return '当前不需要回应';
        const windowError = checkWindow(slot);
        if (windowError) return windowError;
        if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
        if (!st.players[ownerId]?.alive) return '你已死亡';
        if (usedThisTurn(st, ownerId, deps.skillKey)) return '本回合已使用过蛊惑';
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string' || !st.players[ownerId].hand.includes(cardId)) {
          return '请选择一张手牌';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const cardId = params.cardId as string;
        await markOncePerTurn(st, from, deps.skillKey);
        await pushFrame(st, '蛊惑', from, { cardId, declaredName });
        let notVoided: boolean;
        let downCard: string;
        try {
          const result = await deps.runQuestioning(st, from, cardId, declaredName);
          notVoided = !result.voided;
          downCard = result.downCard;
        } finally {
          deps.cleanupVars(st);
          await popFrame(st);
        }
        // 质疑无人/真 → onSuccess 按声明生效;作废(假牌被质疑)→ 不生效
        if (notVoided) {
          await onSuccess(st, from, downCard);
        }
      },
    );

  // ── dodge(响应·闪):被杀指定(询问闪 pending)时,扣牌声明为闪打出 ──
  unloaders.push(
    registerGuResponse(
      'dodge',
      (slot) =>
        (slot.atom as { type: string }).type !== '询问闪' ? '当前不是出闪的窗口' : null,
      '闪',
      // 向外层结算帧(杀帧)处理区提供一张"闪"(供抵消检测);
      // 作废(假牌被质疑)时不提供闪 → 杀结算检测处理区无闪 → 于吉受伤
      (st, from, downCard) => provideAsBasicToProcessing(st, from, downCard, '闪', deps.skillKey),
    ),
  );

  // ── rescue(响应·桃濒死救援):求桃 pending 时,扣牌声明为桃打出 ──
  unloaders.push(
    registerGuResponse(
      'rescue',
      (slot) => {
        const atom = slot.atom as { type: string; requestType?: string };
        if (atom.type !== '请求回应') return '当前不是求桃窗口';
        if (atom.requestType !== '桃/求桃') return '当前不是求桃窗口';
        return null;
      },
      '桃',
      // 标记已救援(同 桃.respond/急救.respond,runDyingFlow 据此回复濒死者体力);
      // 作废(假牌被质疑)时不救援
      (st) => {
        st.localVars[RESCUED_VAR] = true;
      },
    ),
  );

  return unloaders;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const unloaders = registerGuEntries(state, skill, {
    skillKey: '蛊惑',
    runQuestioning,
    cleanupVars,
  });

  // ── respond(注册到每个座次:被蛊惑问询的角色选择是否质疑)──
  unloaders.push(
    ...registerRespondForAllSeats(
      state,
      skill.id,
      (st, seat): string | null => {
        const slot = st.pendingSlots.get(seat);
        if (!slot) return '当前不需要回应';
        if (currentRequestType(st, seat) !== REQUEST_TYPE) return '当前不是蛊惑质疑窗口';
        if (!st.players[seat]?.alive) return '你已死亡';
        return null;
      },
      async (st, seat) => {
        st.localVars[QUESTIONER_VAR] = seat;
      },
    ),
  );

  return () => {
    for (const u of unloaders) u();
  };
}

/** onMount 共用:注册 use×3/dodge/rescue/respond 的前端动作(标版/界版仅 skillKey 不同)。 */
export function mountGuActions(api: FrontendAPI, skillKey: string): (() => void) | void {
  // use:每个声明牌名一个 action(与后端 `use:<牌名>` 一一对应)。
  // 声明【杀】:需选目标(攻击范围内,与后端 杀 分支的 inAttackRange 同源);
  // 声明【桃】:自疗(同 桃 的 selfTarget),需自己受伤(镜像 桃 的 peachActiveWhen);
  // 声明【酒】:无目标。
  api.defineAction(`${USE_ACTION_PREFIX}杀`, {
    label: '蛊惑·杀',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '蛊惑:扣置一张手牌,声明为【杀】使用',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) => viewCanAttack(view.players, api.viewer, t),
      },
    },
    activeWhen: (ctx: ActionContext) =>
      activeUseActive(ctx, skillKey) && viewCanSlash(ctx.view, ctx.perspectiveIdx),
  });
  api.defineAction(`${USE_ACTION_PREFIX}桃`, {
    label: '蛊惑·桃',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '蛊惑:扣置一张手牌,声明为【桃】使用',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: {
        min: 0,
        max: 1,
        filter: (view, t) => {
          const p = view.players[t];
          return p?.alive === true && p.health < p.maxHealth;
        },
      },
      selfTarget: true,
    },
    activeWhen: (ctx: ActionContext) => {
      if (!activeUseActive(ctx, skillKey)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      return p?.alive === true && p.health < p.maxHealth;
    },
  });
  api.defineAction(`${USE_ACTION_PREFIX}酒`, {
    label: '蛊惑·酒',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '蛊惑:扣置一张手牌,声明为【酒】使用',
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
    activeWhen: (ctx: ActionContext) => activeUseActive(ctx, skillKey),
  });
  // dodge:被杀指定时,扣手牌当闪打出。
  api.defineAction('dodge', {
    label: '蛊惑·闪',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '蛊惑:扣置一张手牌,声明为闪打出',
      cardFilter: { min: 1, max: 1 },
    },
    activeWhen: (ctx: ActionContext) => dodgeActive(ctx, skillKey),
  });
  // rescue:濒死求桃时,扣手牌当桃救援。
  api.defineAction('rescue', {
    label: '蛊惑·桃',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '蛊惑:扣置一张手牌,声明为桃救援',
      cardFilter: { min: 1, max: 1 },
    },
    activeWhen: (ctx: ActionContext) => rescueActive(ctx, skillKey),
  });
  // respond:被蛊惑问询的角色选择是否质疑。前端按 pending prompt 渲染。
  defineConfirmAction(api, 'respond', {
    label: '质疑',
    style: 'danger',
    title: '是否质疑于吉的蛊惑?',
  });
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  return mountGuActions(api, '蛊惑');
}

/** use 激活:自己回合出牌阶段 + 无阻塞 pending + 本回合未用过 + 有手牌。 */
function activeUseActive(ctx: ActionContext, skillKey: string): boolean {
  const { view, perspectiveIdx } = ctx;
  const p = view.players[perspectiveIdx];
  if (!p) return false;
  if (view.currentPlayerIndex !== perspectiveIdx) return false;
  if (view.phase !== '出牌') return false;
  const pending = view.pending;
  const blocked = pending != null && pending.isBlocking !== false;
  if (blocked) return false;
  if (p.turnUsage?.[usedThisTurnKey(skillKey)]) return false;
  return (p.hand?.length ?? 0) > 0;
}

/** dodge 激活:询问闪 pending 命中自己 + 本回合未用过 + 有手牌。 */
function dodgeActive(ctx: ActionContext, skillKey: string): boolean {
  const { view, perspectiveIdx } = ctx;
  const p = view.players[perspectiveIdx];
  if (!p) return false;
  if (p.turnUsage?.[usedThisTurnKey(skillKey)]) return false;
  if ((p.hand?.length ?? 0) === 0) return false;
  return viewAskedDodge(ctx);
}

/** rescue 激活:桃/求桃 pending 命中自己 + 本回合未用过 + 有手牌。 */
function rescueActive(ctx: ActionContext, skillKey: string): boolean {
  const { view, perspectiveIdx } = ctx;
  const p = view.players[perspectiveIdx];
  if (!p) return false;
  if (p.turnUsage?.[usedThisTurnKey(skillKey)]) return false;
  if ((p.hand?.length ?? 0) === 0) return false;
  const pending = view.pending;
  const atom = pending?.atom as { type?: string; requestType?: string } | null;
  return (
    pending?.target === perspectiveIdx &&
    atom?.type === '请求回应' &&
    atom?.requestType === '桃/求桃'
  );
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;

// [requestType 迁移·不迁项] ① registerGuResponse 校验的 slot 另传 checkWindow 回调并读
// atom.target;② rescue 的 checkWindow 是参数 slot 的 lambda(无 state,且同时校验 atom.type);
// ③ rescueActive 读 view.pending(视图层);④ 质疑 respond 校验保留 !slot 守卫以区分错误文案。
// requestType 反射点均已走 currentRequestType。
