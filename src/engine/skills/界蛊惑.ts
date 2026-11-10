// 界蛊惑：本仓库选择的兼容口径为依次收集全部质疑者、真牌后缠怨并弃牌或失体力、假牌令质疑者摸牌。
// 主动声明由已注册的 CardEffect 驱动；未质疑前实体牌留在隐藏的弃牌堆，结算使用匿名临时牌。
// 响应入口：闪、桃救援、杀与无懈可击。声明及响应均与正常出牌/打出流程衔接。
import type { ActionContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { registerAction, hasBlockingPending, declareAlternativeResponse, findPendingSlot } from '../core/skill';
import { canSlash } from '../rules/slash-quota';
import { usedThisTurn, markOncePerTurn } from '../rules/once-per-turn';
import { usedThisTurnKey } from '../rules/vars-keys';
import { viewCanSlash } from '../rules/action-active';
import { getCardEffect, getAllCardEffects } from './cards';
import { validateCardUse, computeAutoTargets } from './cards/validate';
import { chargeOnSettle, runUseFlow } from './cards/use-card';
import { runPlayFlow } from './cards/play-card';
import type { Card } from '../types';

const SKILL_ID = '界蛊惑';
const DISPLAY_NAME = '蛊惑'; // OL 官方技能名(不带"界"前缀)

/** 并行质疑 requestType(同时质疑窗口)。 */
const QUESTION_REQUEST = '界蛊惑/质疑';
/** 真牌后续选择 requestType(弃牌或失体力)。 */
const CHOOSE_REQUEST = '界蛊惑/choose';
/** 质疑者列表(Array<number>),由 respond 写入,runQuestioning 读取。 */
const QUESTIONERS_VAR = '界蛊惑/质疑者列表';
/** 弃牌/失体力选择(每个质疑者分别写入),key=`界蛊惑/choice/${seat}`。 */
const CHOOSE_VAR_PREFIX = '界蛊惑/choice/';
/** 扣牌 id(扣牌 atom 写入)。 */
const DOWNCARD_VAR = '蛊惑/扣牌'; // 复用标版 key(扣牌 atom 写此 key)
const RESCUED_VAR = '求桃/已救';

/** use 主动使用可声明的牌(有主动效果);闪仅经 dodge 响应路径打出。 */
const ACTIVE_DECLARATIONS = getAllCardEffects()
  .filter(([, effect]) => effect.timing === '出牌阶段' && !effect.delayed && effect.target.kind !== 'effect')
  .map(([name]) => name);
type ActiveDeclaration = (typeof ACTIVE_DECLARATIONS)[number];

/** 主动使用 action 的 actionType 前缀:一个声明牌名一个 action(`use:杀` / `use:桃` / `use:酒`)。
 *  客户端(浏览器技能按钮 / 无头枚举)无法凭空提供 `params.declaredName` —— 把「声明」
 *  编码进 actionType 后,声明由用户点哪个按钮决定,前后端一一对应。
 *  (与 界渐营/界矫诏 的 `transform:<牌名>` 同款约定。) */
const USE_ACTION_PREFIX = 'use:';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '每回合限一次,扣置一张手牌声明为任意基本牌或普通锦囊牌使用/打出;其他角色可质疑:真→缠怨+弃牌或失1体力,假→作废+质疑者摸1牌',
  };
}

/** 蛊惑-杀 生效后的杀结算:成为目标→检测有效性→询问闪→(被抵消/伤害)。
 *  扣牌留弃牌堆(不进处理区,保隐藏),cardId 仅作 hook 来源标识。
 *  pushFrame('杀') + 检测有效性期间临时改 cardMap[name]='杀',使武器技/仁王盾生效。 */
async function provideAsBasicToProcessing(state: GameState, yuji: number, concealedId: string, outputName: string): Promise<void> {
  const physical = state.cardMap[concealedId];
  if (!physical) return;
  const anonymousId = makeAnonymousCardId(state, yuji);
  state.cardMap[anonymousId] = makeAnonymousCard(physical, anonymousId, outputName);
  await applyAtom(state, { type: '获得', player: yuji, cardId: anonymousId });
  await runPlayFlow(state, yuji, anonymousId);
}

/** 按声明的牌生效(扣牌已在弃牌堆=已使用)。 */
async function applyDeclaredEffect(
  state: GameState,
  source: number,
  declaredName: string,
  targetsInput: number[],
  cardId: string,
): Promise<void> {
  const effect = getCardEffect(declaredName);
  const physical = state.cardMap[cardId];
  if (!effect || !physical) return;
  const anonymousId = makeAnonymousCardId(state, source);
  state.cardMap[anonymousId] = makeAnonymousCard(physical, anonymousId, declaredName);
  try {
    let targets = effect.preUse
      ? effect.preUse(state, source, { cardId: anonymousId, targets: targetsInput, target: targetsInput[0] ?? source })
      : [...targetsInput];
    if ((effect.target.kind === 'self' || ('selfTarget' in effect.prompt && effect.prompt.selfTarget)) && targets.length === 0) {
      targets = [source];
    }
    else if (targets.length === 0) targets = computeAutoTargets(state, source, declaredName);
    await runUseFlow(state, source, anonymousId, targets, declaredName, {
      virtual: true,
      allowWuxieForVirtual: true,
      onSettle: chargeOnSettle(state, source, anonymousId),
    });
  } finally {
    delete state.cardMap[anonymousId];
  }
}

function makeAnonymousCardId(state: GameState, ownerId: number): string {
  return `guhuo-anon:${ownerId}:${state.seq + 1}`;
}

function makeAnonymousCard(physical: Card, id: string, declaredName: string): Card {
  return {
    id,
    name: declaredName,
    suit: physical.suit,
    color: physical.color,
    rank: physical.rank,
    type: ['杀', '桃', '酒', '闪'].includes(declaredName) ? '基本牌' : '锦囊牌',
    ephemeral: true,
  };
}

function validateDeclaredResponse(
  state: GameState,
  ownerId: number,
  params: Record<string, Json>,
  declaredName: '杀' | '无懈可击',
): string | null {
  const slot = declaredName === '无懈可击' ? findPendingSlot(state, ownerId) : state.pendingSlots.get(ownerId);
  if (!slot) return '当前不需要回应';
  const atom = slot.atom as { type: string; requestType?: string; target?: number };
  const validWindow = declaredName === '杀'
    ? atom.type === '询问杀' || (atom.type === '请求回应' && atom.requestType === '杀/respondKill')
    : atom.type === '请求回应' && atom.requestType === '无懈可击';
  if (!validWindow) return '当前不是对应的响应窗口';
  if (atom.target !== undefined && atom.target !== ownerId && declaredName !== '无懈可击') return '不是问你的';
  if (!state.players[ownerId]?.alive) return '你已死亡';
  if (state.players[ownerId].skills.includes('缠怨')) return '缠怨时不能质疑蛊惑';
  if (usedThisTurn(state, ownerId, SKILL_ID)) return '本回合已使用过蛊惑';
  const cardId = params.cardId as string | undefined;
  if (typeof cardId !== 'string' || !state.players[ownerId].hand.includes(cardId)) return '请选择一张手牌';
  return null;
}

/** 对单个质疑者结算"真牌"后果:加缠怨标记 + 选弃一张牌或失去1点体力。
 *  无手牌时强制失去1点体力(沿用刚烈 FAQ 模式)。 */
async function applyTruthConsequence(state: GameState, questioner: number, yuji: number): Promise<void> {
  // 加缠怨标记(scope=questioner,持久——docs 未描述持续时间,按"持久锁定"处理)
  await applyAtom(state, { type: '添加技能', player: questioner, skillId: '缠怨' });
  await applyAtom(state, {
    type: '加标记',
    player: questioner,
    mark: { id: '缠怨', scope: questioner },
  });
  const canDiscard = state.players[questioner].hand.length >= 1;
  if (canDiscard) {
    delete state.localVars[CHOOSE_VAR_PREFIX + questioner];
    await applyAtom(state, {
      type: '请求回应',
      requestType: CHOOSE_REQUEST,
      target: questioner,
      prompt: {
        type: 'confirm',
        title: '界蛊惑:弃置一张手牌,或失去1点体力?',
        confirmLabel: '弃置一张手牌',
        cancelLabel: '失去1点体力',
      },
      defaultChoice: false,
      timeout: 30,
    });
    const choice = state.localVars[CHOOSE_VAR_PREFIX + questioner] as string | undefined;
    if (choice === 'discard') {
      const hand = [...state.players[questioner].hand];
      await applyAtom(state, { type: '弃置', player: questioner, cardIds: hand.slice(0, 1) });
      return;
    }
  }
  // 失去1点体力(来源为于吉)
  await applyAtom(state, {
    type: '失去体力',
    target: questioner,
    amount: 1,
  });
  // 注:官方"失去1点体力"——标版蛊惑用「失去体力」atom;此处沿用(不触反馈/奸雄等伤害来源技)
  // yuji 参数留作用 future source 追溯(若改用 造成伤害);当前不消费,避免 lint 报未用。
  void yuji;
}

/** 界蛊惑质疑流程(各入口共用):扣牌 → 质疑循环 → (有人质疑)翻牌结算。
 *  返回 { voided: 是否作废(假牌被质疑), downCard: 扣牌 id, questioners: 质疑者列表 }。
 *
 *  "同时质疑"在引擎中用顺序询问+全面收集实现(不走多目标并行 slot):
 *    1) 多目标并行 slot 的 toViewEvents.othersView 用 targets[0] 作为 target 标识,导致非 target
 *       viewer 的 view.pending 跟踪 targets[0];当 targets[0] 的 slot resolve 时,
 *       harness 的 pendingResolved 处理会误清所有非 target viewer 的 pending
 *       (即使其他 slot 仍存活)——与 buildView 不一致。改用 请求回应 逐个问询避免此问题。
 *    2) 顺序询问全面收集(不随首问者 break)与同时质疑在游戏状态结果上等价:
 *       规则只依赖"最终质疑者集合",不依赖决策时序/信息暴露。
 *       (唯一区别是 UX:顺序询问时后问者知道前问者的选择——可在 UI 层面优化为盲选) */
async function runQuestioning(
  state: GameState,
  yuji: number,
  cardId: string,
  declaredName: string,
): Promise<{ voided: boolean; downCard: string; questioners: number[] }> {
  // ① 扣牌(面朝下,声明公开,真身对他人隐藏)
  await applyAtom(state, { type: '扣牌', player: yuji, cardId, declaredName });

  // ② 质疑循环:从下家起逆时针逐个询问,全部询问完毕才翻牌(同时质疑语义)
  const n = state.players.length;
  const questioners: number[] = [];
  for (let step = 1; step < n; step++) {
    const p = (yuji - step + n) % n;
    if (p === yuji) continue;
    if (!state.players[p]?.alive) continue;
    delete state.localVars[QUESTIONERS_VAR];
    await applyAtom(state, {
      type: '请求回应',
      requestType: QUESTION_REQUEST,
      target: p,
      prompt: {
        type: 'confirm',
        title: `是否质疑于吉声明为【${declaredName}】的蛊惑?`,
      },
      timeout: 20,
    });
    const q = state.localVars[QUESTIONERS_VAR] as number | undefined;
    if (q !== undefined && !questioners.includes(q)) questioners.push(q);
  }

  const downCard = state.localVars[DOWNCARD_VAR] as string;
  if (questioners.length === 0) {
    // ③a 无人质疑 → 按声明生效(不翻牌)
    return { voided: false, downCard, questioners: [] };
  }
  // ③b 有人质疑 → 翻开
  await applyAtom(state, { type: '展示', player: yuji, cardId: downCard });
  const isReal = state.cardMap[downCard]?.name === declaredName;
  if (isReal) {
    // 真:扣牌按声明生效(voided=false);每个质疑者:缠怨 + 弃一张牌或失去1点体力
    // 按质疑询问顺序(逆时针)逐个结算,保证视图可预测且符合方向约定
    for (const q of questioners) {
      if (!state.players[q]?.alive) continue; // 结算过程中死亡则跳过
      await applyTruthConsequence(state, q, yuji);
    }
    return { voided: false, downCard, questioners };
  }
  // 假:扣牌作废(留弃牌堆);每个质疑者摸一张牌
  for (const q of questioners) {
    if (!state.players[q]?.alive) continue;
    await applyAtom(state, { type: '摸牌', player: q, count: 1 });
  }
  return { voided: true, downCard, questioners };
}

/** 清理本次蛊惑临时 localVars。 */
function cleanupVars(state: GameState): void {
  delete state.localVars[DOWNCARD_VAR];
  delete state.localVars[QUESTIONERS_VAR];
  // 清理所有 choice 变量(按前缀扫描)
  for (const key of Object.keys(state.localVars)) {
    if (key.startsWith(CHOOSE_VAR_PREFIX)) delete state.localVars[key];
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];
  unloaders.push(declareAlternativeResponse(state, ownerId, '询问闪'));
  unloaders.push(declareAlternativeResponse(state, ownerId, '询问杀'));
  unloaders.push(declareAlternativeResponse(state, ownerId, '请求回应', '桃/求桃'));
  unloaders.push(declareAlternativeResponse(state, ownerId, '请求回应', '无懈可击'));

  // ── use(界于吉主动发动:主动基本牌/普通锦囊)──
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
        if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
        if (st.phase !== '出牌') return '只能在出牌阶段发动';
        if (hasBlockingPending(st)) return '当前有未完成的询问';
        if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过蛊惑';
        const self = st.players[ownerId];
        if (!self?.alive) return '玩家不存在或已死亡';
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string' || !self.hand.includes(cardId)) return '请选择一张手牌';
        const effect = getCardEffect(declaredName);
        const physical = st.cardMap[cardId];
        if (!effect || !physical) return '声明牌尚未实现';
        const anonymousId = makeAnonymousCardId(st, ownerId);
        st.cardMap[anonymousId] = makeAnonymousCard(physical, anonymousId, declaredName);
        try {
          if (!Array.isArray(params.targets) && typeof params.target === 'number') params.targets = [params.target];
          if (effect.target.kind === 'self' && !Array.isArray(params.targets)) params.targets = [ownerId];
          if (declaredName === '杀' && !canSlash(st, ownerId, anonymousId, params.targets as number[] | undefined)) {
            return '出杀次数已达上限';
          }
          return validateCardUse(st, ownerId, { ...params, cardId: anonymousId }, declaredName, 'forced');
        } finally {
          delete st.cardMap[anonymousId];
        }
      },
      async (st: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const cardId = params.cardId as string;
        const targets = Array.isArray(params.targets)
          ? (params.targets as number[])
          : typeof params.target === 'number' ? [params.target] : [];
        // 限一次标记:第一个 await 前设置,防 dispatch 重入
        await markOncePerTurn(st, from, SKILL_ID);
        // 结算帧参数会公开广播；扣牌真身不能作为公开参数发送。
        await pushFrame(st, '蛊惑', from, { declaredName });
        try {
          const result = await runQuestioning(st, from, cardId, declaredName);
          if (!result.voided) {
            await applyDeclaredEffect(st, from, declaredName, targets, result.downCard);
          }
        } finally {
          cleanupVars(st);
          await popFrame(st);
        }
      },
    );
  for (const declaredName of ACTIVE_DECLARATIONS) unloaders.push(registerDeclaredUse(declaredName));

  // ── dodge(响应·闪):被杀指定(询问闪 pending)时,扣牌声明为闪打出 ──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'dodge',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(ownerId);
        if (!slot) return '当前不需要回应';
        if ((slot.atom as { type: string }).type !== '询问闪') return '当前不是出闪的窗口';
        if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
        if (!st.players[ownerId]?.alive) return '你已死亡';
        if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过蛊惑';
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string' || !st.players[ownerId].hand.includes(cardId)) {
          return '请选择一张手牌';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const cardId = params.cardId as string;
        await markOncePerTurn(st, from, SKILL_ID);
        await pushFrame(st, '蛊惑', from, { declaredName: '闪' });
        let notVoided: boolean;
        let downCard: string;
        try {
          const result = await runQuestioning(st, from, cardId, '闪');
          notVoided = !result.voided;
          downCard = result.downCard;
        } finally {
          cleanupVars(st);
          await popFrame(st);
        }
        // 质疑无人/真 → 向外层结算帧(杀帧)处理区提供一张"闪"(供抵消检测)
        if (notVoided) {
          await provideAsBasicToProcessing(st, from, downCard, '闪');
        }
        // 作废(假牌被质疑)时不提供闪 → 杀结算检测处理区无闪 → 于吉受伤
      },
    ),
  );

  // ── rescue(响应·桃濒死救援):求桃 pending 时,扣牌声明为桃打出 ──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'rescue',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(ownerId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as { type: string; requestType?: string; target: number };
        if (atom.type !== '请求回应') return '当前不是求桃窗口';
        if (atom.requestType !== '桃/求桃') return '当前不是求桃窗口';
        if (atom.target !== ownerId) return '不是问你的';
        if (!st.players[ownerId]?.alive) return '你已死亡';
        if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过蛊惑';
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string' || !st.players[ownerId].hand.includes(cardId)) {
          return '请选择一张手牌';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const cardId = params.cardId as string;
        await markOncePerTurn(st, from, SKILL_ID);
        await pushFrame(st, '蛊惑', from, { declaredName: '桃' });
        let notVoided: boolean;
        try {
          const result = await runQuestioning(st, from, cardId, '桃');
          notVoided = !result.voided;
        } finally {
          cleanupVars(st);
          await popFrame(st);
        }
        // 质疑无人/真 → 标记已救援(同 桃.respond/急救.respond,runDyingFlow 据此回复濒死者体力)
        if (notVoided) {
          st.localVars[RESCUED_VAR] = true;
        }
        // 作废(假牌被质疑)时不救援
      },
    ),
  );

  unloaders.push(registerAction(
    state, skill.id, ownerId, 'respondKill',
    (st, params) => validateDeclaredResponse(st, ownerId, params, '杀'),
    async (st, params) => {
      const cardId = params.cardId as string;
      await markOncePerTurn(st, ownerId, SKILL_ID);
      await pushFrame(st, '蛊惑', ownerId, { declaredName: '杀' });
      let result: Awaited<ReturnType<typeof runQuestioning>>;
      try { result = await runQuestioning(st, ownerId, cardId, '杀'); }
      finally { cleanupVars(st); await popFrame(st); }
      if (!result.voided) await provideAsBasicToProcessing(st, ownerId, result.downCard, '杀');
    },
  ));

  unloaders.push(registerAction(
    state, skill.id, ownerId, 'respondWuxie',
    (st, params) => validateDeclaredResponse(st, ownerId, params, '无懈可击'),
    async (st, params) => {
      const cardId = params.cardId as string;
      await markOncePerTurn(st, ownerId, SKILL_ID);
      await pushFrame(st, '蛊惑', ownerId, { declaredName: '无懈可击' });
      let result: Awaited<ReturnType<typeof runQuestioning>>;
      try { result = await runQuestioning(st, ownerId, cardId, '无懈可击'); }
      finally { cleanupVars(st); await popFrame(st); }
      if (result.voided) return;
      st.localVars['抵消/已回应'] = true;
      await applyDeclaredEffect(st, ownerId, '无懈可击', [ownerId], result.downCard);
    },
  ));

  // ── respond(注册到每个座次:被蛊惑问询的角色,含 ownerId 本人)──
  //   1. 同时质疑窗口(请求回应 slot,requestType='界蛊惑/质疑'):choice=true 加入质疑者列表。
  //   2. 真牌后续选择窗口(请求回应 slot,requestType='界蛊惑/choose'):choice=true 弃牌,false 失体力。
  //  注:与 ownerId 上的 use/dodge/rescue 共存,各 actionType 独立不冲突。
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, _params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          const atom = slot.atom as { type: string; requestType?: string };
          if (atom.type !== '请求回应') return '当前不需要回应';
          const rt = atom.requestType;
          if (rt !== QUESTION_REQUEST && rt !== CHOOSE_REQUEST)
            return '当前不是界蛊惑问询窗口';
          if (!st.players[seat]?.alive) return '你已死亡';
          if (rt === QUESTION_REQUEST && st.players[seat].skills.includes('缠怨')) return '缠怨时不能质疑蛊惑';
          return null;
        },
        async (st: GameState, params: Record<string, Json>) => {
          const slot = st.pendingSlots.get(seat);
          const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
          if (rt === QUESTION_REQUEST) {
            // choice=true/confirmed=true → 质疑;pass/超时/choice=false → 不质疑
            const questioned = params.choice === true || params.confirmed === true;
            if (!questioned) return;
            // 顺序询问:直接记录当前座次为质疑者(供 runQuestioning 读取)
            st.localVars[QUESTIONERS_VAR] = seat;
          } else if (rt === CHOOSE_REQUEST) {
            // choice=true → 弃一张牌;choice=false/缺省 → 失去1点体力
            st.localVars[CHOOSE_VAR_PREFIX + seat] =
              params.choice === true ? 'discard' : 'damage';
          }
        },
      ),
    );
  }

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  for (const name of ACTIVE_DECLARATIONS) {
    const effect = getCardEffect(name)!;
    if (!('cardFilter' in effect.prompt)) continue;
    api.defineAction(`${USE_ACTION_PREFIX}${name}`, {
      label: `蛊惑·${name}`,
      style: effect.style,
      prompt: {
        ...effect.prompt,
        title: `蛊惑:扣置一张手牌,声明为【${name}】使用`,
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      activeWhen: (ctx: ActionContext) =>
        activeUseActive(ctx) && (effect.activeWhen?.(ctx) ?? true) &&
        (name !== '杀' || viewCanSlash(ctx.view, ctx.perspectiveIdx)),
    });
  }
  // dodge:被杀指定时,扣手牌当闪打出。
  api.defineAction('dodge', {
    label: '蛊惑·闪',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '蛊惑:扣置一张手牌,声明为闪打出',
      cardFilter: { min: 1, max: 1 },
    },
    activeWhen: (ctx: ActionContext) => dodgeActive(ctx),
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
    activeWhen: (ctx: ActionContext) => rescueActive(ctx),
  });
  api.defineAction('respondKill', {
    label: '蛊惑·杀', style: 'danger',
    prompt: { type: 'useCard', title: '蛊惑:扣置一张手牌,声明为【杀】打出', cardFilter: { filter: () => true, min: 1, max: 1 } },
    activeWhen: (ctx: ActionContext) => responseActive(ctx, '询问杀'),
  });
  api.defineAction('respondWuxie', {
    label: '蛊惑·无懈可击', style: 'danger',
    prompt: { type: 'useCard', title: '蛊惑:扣置一张手牌,声明为【无懈可击】打出', cardFilter: { filter: () => true, min: 1, max: 1 } },
    activeWhen: (ctx: ActionContext) => responseActive(ctx, '无懈可击'),
  });
  // respond:被蛊惑问询的角色选择是否质疑 / 弃牌或失体力。前端按 pending prompt 渲染。
  api.defineAction('respond', {
    label: '质疑',
    style: 'danger',
    prompt: { type: 'confirm', title: '是否质疑于吉的蛊惑?' },
  });
  return () => {};
}

/** use 激活:自己回合出牌阶段 + 无阻塞 pending + 本回合未用过 + 有手牌。 */
function activeUseActive(ctx: ActionContext): boolean {
  const { view, perspectiveIdx } = ctx;
  const p = view.players[perspectiveIdx];
  if (!p) return false;
  if (view.currentPlayerIndex !== perspectiveIdx) return false;
  if (view.phase !== '出牌') return false;
  const pending = view.pending;
  const blocked = pending != null && pending.isBlocking !== false;
  if (blocked) return false;
  if (p.turnUsage?.[usedThisTurnKey(SKILL_ID)]) return false;
  return (p.hand?.length ?? 0) > 0;
}

/** dodge 激活:询问闪 pending 命中自己 + 本回合未用过 + 有手牌。 */
function dodgeActive(ctx: ActionContext): boolean {
  const { view, perspectiveIdx } = ctx;
  const p = view.players[perspectiveIdx];
  if (!p) return false;
  if (p.turnUsage?.[usedThisTurnKey(SKILL_ID)]) return false;
  if ((p.hand?.length ?? 0) === 0) return false;
  const pending = view.pending;
  return (
    pending?.target === perspectiveIdx &&
    (pending.atom as { type?: string } | null)?.type === '询问闪'
  );
}

/** rescue 激活:桃/求桃 pending 命中自己 + 本回合未用过 + 有手牌。 */
function rescueActive(ctx: ActionContext): boolean {
  const { view, perspectiveIdx } = ctx;
  const p = view.players[perspectiveIdx];
  if (!p) return false;
  if (p.turnUsage?.[usedThisTurnKey(SKILL_ID)]) return false;
  if ((p.hand?.length ?? 0) === 0) return false;
  const pending = view.pending;
  const atom = pending?.atom as { type?: string; requestType?: string } | null;
  return (
    pending?.target === perspectiveIdx &&
    atom?.type === '请求回应' &&
    atom?.requestType === '桃/求桃'
  );
}

function responseActive(ctx: ActionContext, kind: '询问杀' | '无懈可击'): boolean {
  const p = ctx.view.players[ctx.perspectiveIdx];
  if (!p?.alive || (p.hand?.length ?? 0) === 0 || p.turnUsage?.[usedThisTurnKey(SKILL_ID)]) return false;
  const pending = ctx.view.pending;
  const atom = pending?.atom as { type?: string; requestType?: string } | null;
  return kind === '询问杀'
    ? pending?.target === ctx.perspectiveIdx && atom?.type === '询问杀'
    : atom?.type === '请求回应' && atom.requestType === kind;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
