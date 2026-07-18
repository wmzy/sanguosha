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
// 三类入口(共用 runQuestioning 质疑流程):
//   1. use(主动,杀/桃/酒):出牌阶段、自己回合、无阻塞 pending、存活、本回合未用过。
//      params: { cardId(扣牌), declaredName(杀/桃/酒), target?(杀/桃的目标) }。
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
//   杀结算复用标准三阶段(成为目标→检测有效性→询问闪→被抵消/伤害):
//     · pushFrame('杀',…)——使武器技(贯石斧/青龙)的 被抵消 after-hook(frame.skillId==='杀')生效;
//     · 检测有效性期间临时把 cardMap[扣牌].name 置为'杀'(try/finally 还原)——使仁王盾
//       (检测有效性 before-hook: name==='杀' && color==='黑' → cancel)按物理花色判定假牌当杀。
//   扣牌不在处理区,故 frameCards 的闪检测不受其真身影响(仅目标打出的闪在处理区)。
//
// respond(质疑)注册到每个座次(被问询者非于吉),onInit 返回合并卸载函数
//   (unloadSkillInstance 仅按 (skillId,于吉座次) 清 action,清不到其他座次)。
import type { ActionContext, Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, hasBlockingPending } from '../skill';
import { inAttackRange } from '../distance';
import { canSlash, incSlashUsed, slashUsed } from '../slash-quota';
import { usedThisTurn, markOncePerTurn } from '../once-per-turn';

const REQUEST_TYPE = '蛊惑/质疑';
const QUESTIONER_VAR = '蛊惑/质疑者';
const DOWNCARD_VAR = '蛊惑/扣牌';
const DECLARE_VAR = '蛊惑/声明';
const RESCUED_VAR = '求桃/已救';
/** use 主动使用可声明的牌(有主动效果);闪仅经 dodge 响应路径打出。 */
const ACTIVE_DECLARATIONS = ['杀', '桃', '酒'] as const;
const BASIC_CARDS = ['杀', '闪', '桃', '酒'] as const;
type DeclaredName = (typeof BASIC_CARDS)[number];

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '蛊惑',
    description: '每回合限一次,扣置一张手牌声明为基本牌(杀/闪/桃/酒)使用或打出;其他角色可质疑',
  };
}

/** 蛊惑-杀 生效后的杀结算:成为目标→检测有效性→询问闪→(被抵消/伤害)。
 *  扣牌留弃牌堆(不进处理区,保隐藏),cardId 仅作 hook 来源标识。
 *  pushFrame('杀') + 检测有效性期间临时改 cardMap[name]='杀',使武器技/仁王盾生效。 */
async function resolveGuSlash(
  state: GameState,
  source: number,
  target: number,
  cardId: string,
): Promise<void> {
  const card = state.cardMap[cardId];
  const damageType = card?.damageType;
  await pushFrame(state, '杀', source, { cardId, declaredName: '杀', target });
  // 临时把扣牌当作"杀"(仅 cardMap.name),供仁王盾按物理花色判定;try/finally 必还原。
  const origName = card?.name;
  if (card && origName !== '杀') card.name = '杀';
  try {
    const became = await applyAtom(state, { type: '成为目标', source, target, cardId });
    if (!became) return; // 空城等:目标不合法
    const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
    if (!valid) return; // 仁王盾黑杀无效等
    await applyAtom(state, { type: '询问闪', target, source });
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length > 0) {
      // 被抵消:触发武器技(贯石斧强命/青龙追杀,frame.skillId==='杀' 命中)
      await applyAtom(state, { type: '被抵消', source, target, cardId });
      const remaining = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
      for (const dId of remaining) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: dId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    } else if (state.players[target]?.alive) {
      await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId, damageType });
    }
  } finally {
    // 异常安全:弹帧 + 清理滞留处理区的闪 + 还原 cardMap.name
    for (const id of frameCards(state)) {
      if (state.cardMap[id]?.name === '闪') {
        await applyAtom(state, {
          type: '移动牌',
          cardId: id,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    }
    await popFrame(state);
    if (card && origName !== undefined && origName !== '杀') card.name = origName;
  }
  // 蛊惑-杀 成功计入出杀次数(标准 FAQ:真牌/无人质疑=正常使用)
  incSlashUsed(state);
  await applyAtom(state, { type: '回合用量', player: source, key: '杀/usedCount', value: slashUsed(state) });
}

/** 将扣牌(在弃牌堆)经 弃牌堆→手牌→当作(影子 outputName)→手牌→处理区 提供到当前结算帧。
 *  供 dodge(闪)在质疑通过后向处理区提供一张"闪"(供杀结算检测处理区有闪 → 抵消)。
 *  影子复用 武圣/奇袭 的转化模型:入弃牌堆时按 shadowOf 还原为扣牌。 */
async function provideAsBasicToProcessing(
  state: GameState,
  yuji: number,
  concealedId: string,
  outputName: string,
): Promise<void> {
  // 扣牌回手(经 移动牌 产生 ViewEvent,保持 processedView 一致;弃牌堆→手牌 不暴露牌面)
  await applyAtom(state, {
    type: '移动牌',
    cardId: concealedId,
    from: { zone: '弃牌堆' },
    to: { zone: '手牌', player: yuji },
  });
  const shadowId = `${concealedId}#蛊惑${outputName}`;
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

/** 蛊惑质疑流程(各入口共用):扣牌 → 质疑循环 → (有人质疑)翻牌结算。
 *  返回 { voided: 是否作废(假牌被质疑), downCard: 扣牌 id, questioner?: 质疑者 }。 */
async function runQuestioning(
  state: GameState,
  yuji: number,
  cardId: string,
  declaredName: string,
): Promise<{ voided: boolean; downCard: string; questioner?: number }> {
  // ① 扣牌(面朝下,声明公开,真身对他人隐藏)
  await applyAtom(state, { type: '扣牌', player: yuji, cardId, declaredName });

  // ② 质疑循环:从下家起按座次逐个询问,首个质疑者即翻牌
  const n = state.players.length;
  let questioner: number | undefined = undefined;
  for (let step = 1; step < n; step++) {
    const p = (yuji + step) % n;
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

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use(于吉主动发动:杀/桃/酒)──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, params: Record<string, Json>): string | null => {
        if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
        if (st.phase !== '出牌') return '只能在出牌阶段发动';
        if (hasBlockingPending(st)) return '当前有未完成的询问';
        if (usedThisTurn(st, ownerId, '蛊惑')) return '本回合已使用过蛊惑';
        const self = st.players[ownerId];
        if (!self?.alive) return '玩家不存在或已死亡';
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string' || !self.hand.includes(cardId)) return '请选择一张手牌';
        const declaredName = params.declaredName as string | undefined;
        if (!declaredName || !(ACTIVE_DECLARATIONS as readonly string[]).includes(declaredName)) {
          return '主动使用须声明杀/桃/酒(闪请于被杀时以蛊惑打出)';
        }
        if (declaredName === '杀') {
          const target = params.target as number | undefined;
          if (typeof target !== 'number' || !st.players[target]?.alive) return '请选择合法目标';
          if (!inAttackRange(st, ownerId, target)) return '目标不在攻击范围内';
          if (!canSlash(st, ownerId)) return '出杀次数已达上限';
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
        const declaredName = params.declaredName as DeclaredName;
        const target = params.target as number | undefined;
        // 限一次标记:第一个 await 前设置,防 dispatch 重入
        await markOncePerTurn(st, from, '蛊惑');
        await pushFrame(st, '蛊惑', from, { cardId, declaredName });
        try {
          const result = await runQuestioning(st, from, cardId, declaredName);
          if (!result.voided) {
            await applyDeclaredEffect(st, from, declaredName, target, result.downCard);
          }
        } finally {
          cleanupVars(st);
          await popFrame(st);
        }
      },
    ),
  );

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
        if (usedThisTurn(st, ownerId, '蛊惑')) return '本回合已使用过蛊惑';
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string' || !st.players[ownerId].hand.includes(cardId)) {
          return '请选择一张手牌';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const cardId = params.cardId as string;
        await markOncePerTurn(st, from, '蛊惑');
        await pushFrame(st, '蛊惑', from, { cardId, declaredName: '闪' });
        let notVoided = false;
        let downCard = cardId;
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
        if (usedThisTurn(st, ownerId, '蛊惑')) return '本回合已使用过蛊惑';
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string' || !st.players[ownerId].hand.includes(cardId)) {
          return '请选择一张手牌';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const cardId = params.cardId as string;
        await markOncePerTurn(st, from, '蛊惑');
        await pushFrame(st, '蛊惑', from, { cardId, declaredName: '桃' });
        let notVoided = false;
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

  // ── respond(注册到每个座次:被蛊惑问询的角色选择是否质疑)──
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
          const atom = slot.atom as { requestType?: string };
          if (atom.requestType !== REQUEST_TYPE) return '当前不是蛊惑质疑窗口';
          if (!st.players[seat]?.alive) return '你已死亡';
          return null;
        },
        async (st: GameState, _params: Record<string, Json>) => {
          st.localVars[QUESTIONER_VAR] = seat;
        },
      ),
    );
  }

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '蛊惑',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '蛊惑:扣置一张手牌,声明为基本牌(杀/桃/酒)并使用',
      cardFilter: { min: 1, max: 1 },
    },
    activeWhen: (ctx: ActionContext) => activeUseActive(ctx),
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
  // respond:被蛊惑问询的角色选择是否质疑。前端按 pending prompt 渲染。
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
  if (p.turnUsage?.['蛊惑/usedThisTurn']) return false;
  return (p.hand?.length ?? 0) > 0;
}

/** dodge 激活:询问闪 pending 命中自己 + 本回合未用过 + 有手牌。 */
function dodgeActive(ctx: ActionContext): boolean {
  const { view, perspectiveIdx } = ctx;
  const p = view.players[perspectiveIdx];
  if (!p) return false;
  if (p.turnUsage?.['蛊惑/usedThisTurn']) return false;
  if ((p.hand?.length ?? 0) === 0) return false;
  const pending = view.pending;
  return (
    pending != null &&
    pending.target === perspectiveIdx &&
    (pending.atom as { type?: string } | null)?.type === '询问闪'
  );
}

/** rescue 激活:桃/求桃 pending 命中自己 + 本回合未用过 + 有手牌。 */
function rescueActive(ctx: ActionContext): boolean {
  const { view, perspectiveIdx } = ctx;
  const p = view.players[perspectiveIdx];
  if (!p) return false;
  if (p.turnUsage?.['蛊惑/usedThisTurn']) return false;
  if ((p.hand?.length ?? 0) === 0) return false;
  const pending = view.pending;
  const atom = pending?.atom as { type?: string; requestType?: string } | null;
  return (
    pending != null &&
    pending.target === perspectiveIdx &&
    atom?.type === '请求回应' &&
    atom?.requestType === '桃/求桃'
  );
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
