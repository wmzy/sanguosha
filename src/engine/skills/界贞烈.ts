// 界贞烈(界王异·魏·被动技,OL 界限突破官方逐字):
//   当你成为其他角色【杀】或普通锦囊牌的目标后,你可以失去1点体力令此牌对你无效,
//   然后你可以选择一项:1.获得使用者一张牌;2.本回合结束阶段,发动一次"秘计"。
//
// 与标版贞烈差异(标版 src/engine/skills/贞烈.ts 未实现):
//   - 标版:成杀/锦囊目标后,失体令其无效,然后弃置使用者一张牌
//   - 界版:成杀/锦囊目标后,失体令其无效,然后二选一:
//          ① 获得使用者一张牌(主动获益,与标版"弃置"相反)
//          ② 本回合结束阶段发动一次"秘计"(挂起增益,界秘计.ts 消费)
//
// 触发时机(两类,覆盖"杀或普通锦囊"):
//   A. 杀/决斗(走「成为目标」atom 的流程,杀.ts / 决斗 runUseFlow 均先发):
//      「成为目标」after-hook(atom.target=ownerId && atom.source≠ownerId && 卡为杀/决斗)
//   B. 普通锦囊(无「成为目标」atom,但都开无懈窗口):
//      「请求回应」before-hook(requestType='无懈可击' && cancelTarget=ownerId && 顶帧=普通锦囊)
//      ——顺手牵羊/过河拆桥/AOE(南蛮/万箭)/桃园结义/五谷丰登/借刀杀人/决斗/火攻/无中生有
//   C. 铁索连环(无目标级无懈窗口,顶帧 from=使用者,cancelTarget=from 而非 owner):
//      「设横置」before-hook(atom.player=ownerId && 顶帧=铁索连环)合并触发与拦截
//      ——铁索连环 execute 内逐目标 applyAtom(设横置),此处既是"成为目标"也是"效果生效"
//
// 令此牌对王异无效(per-cardId 局部标记 + 多 before-hook 拦截效果 atom):
//   - 激活后写 localVars[`贞烈/无效/${cardId}/${ownerId}`] = true
//   - 检测有效性 before-hook(杀):atom.target=owner && atom.cardId 匹配 → cancel
//   - 造成伤害 before-hook(南蛮/万箭/决斗/火攻):atom.target=owner && atom.cardId 匹配 → cancel
//   - 询问杀 before-hook(南蛮入侵):atom.target=owner && 顶帧 cardId 匹配 → cancel
//   - 获得 before-hook(顺手牵羊):atom.from=owner && 顶帧 cardId 匹配 → cancel
//   - 弃置 before-hook(过河拆桥):atom.player=owner && 顶帧 cardId 匹配 → cancel
//   - 设横置 before-hook(铁索连环):atom.player=owner && 顶帧 cardId 匹配 → cancel
//
// 选项 ①(获得使用者一张牌):复用 runPickTargetCardPanel
//   - mode='obtain',requestType='贞烈/选牌',includeJudge=false(经典规则仅手牌+装备)
//   - 来源(使用者)无牌可获时不弹面板,贞烈仍生效(只无效,不获益)
//
// 选项 ②(本回合结束阶段发动一次秘计):
//   - 写 turn.vars[`秘计/pendingFrom贞烈/${ownerId}`] = true
//   - 后缀非 /usedThisTurn,故「回合结束」atom 不会清(由 界秘计 在结束阶段消费;
//     回合结束 atom 清 turn.vars 作兜底,跨回合不会泄漏)
//
// 命名:文件名/loader key/character skill name 均为 '界贞烈';内部 Skill.name='贞烈'(OL 官方名)。
import type {
  Card,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
  SkillModule,
} from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';
import { isDelayedTrick } from '../card-meta';
import { runPickTargetCardPanel } from './选牌面板';

const SKILL_ID = '界贞烈';
const DISPLAY_NAME = '贞烈';

/** 贞烈发动确认 requestType(yes/no) */
const CONFIRM_RT = '贞烈/confirm';
/** 贞烈选项①/② requestType('gain' | 'miji') */
const CHOOSE_RT = '贞烈/choose';
/** 贞烈选牌面板 requestType(交给 runPickTargetCardPanel) */
const PICK_RT = '贞烈/选牌';

/** localVars:发动确认结果(boolean) */
const CONFIRM_KEY = '贞烈/confirmed';
/** localVars:选项结果('gain' | 'miji') */
const CHOOSE_KEY = '贞烈/choice';
/** localVars 前缀:此牌对此 owner 无效。完整 key = `${prefix}${cardId}/${ownerId}` */
const INVALID_PREFIX = '贞烈/无效/';
/** localVars 前缀:此牌对此 owner 已触发过贞烈(防同一张牌重复触发)。 */
const PROCESSED_PREFIX = '贞烈/已处理/';
/** turn.vars key:本回合结束阶段需发动一次秘计(由 界秘计.ts 消费)。 */
const MIJI_PENDING_PREFIX = '秘计/pendingFrom贞烈/';

/** 完整无效 key */
function invalidKey(cardId: string, ownerId: number): string {
  return `${INVALID_PREFIX}${cardId}/${ownerId}`;
}
/** 完整已处理 key */
function processedKey(cardId: string, ownerId: number): string {
  return `${PROCESSED_PREFIX}${cardId}/${ownerId}`;
}

/** 判定卡是否为杀或普通锦囊(贞烈可触发的卡类型) */
function isKillOrNormalTrick(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.name === '杀') return true;
  if (card.type === '锦囊牌') {
    return !isDelayedTrick(card) && card.trickSubtype !== '响应锦囊';
  }
  return false;
}

/** 是否已标记此牌对此 owner 无效 */
function isInvalidFor(
  state: GameState,
  cardId: string | undefined,
  ownerId: number,
): boolean {
  if (!cardId) return false;
  return state.localVars[invalidKey(cardId, ownerId)] === true;
}

/** 是否已对此牌触发过贞烈(防重入) */
function isProcessedFor(
  state: GameState,
  cardId: string | undefined,
  ownerId: number,
): boolean {
  if (!cardId) return false;
  return state.localVars[processedKey(cardId, ownerId)] === true;
}

/**
 * 贞烈发动主流程(触发点共用):
 *   1. 询问发动确认
 *   2. 若确认:失去1点体力 + 标记此牌无效
 *   3. 若失去体力后仍存活:询问选项(① 获得来源一张牌 / ② 结束阶段发动秘计)
 *   4. 标记本张牌已处理(防同一张牌重复触发)
 *
 * @param state    GameState
 * @param ownerId  王异座次
 * @param cardId   触发牌 id
 * @param sourceId 使用者座次(用于选项①)
 */
async function runZhenlie(
  state: GameState,
  ownerId: number,
  cardId: string,
  sourceId: number,
): Promise<void> {
  // 1) 发动确认
  delete state.localVars[CONFIRM_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '是否发动贞烈?(失去1点体力令此牌对你无效,然后二选一)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 15,
  });
  if (state.localVars[CONFIRM_KEY] !== true) return;

  // 2) 失去1点体力(非伤害,不触发反馈/奸雄;触发濒死)
  await applyAtom(state, { type: '失去体力', target: ownerId, amount: 1 });

  // 标记此牌对此 owner 无效(无论后续选项如何,无效都生效)
  state.localVars[invalidKey(cardId, ownerId)] = true;

  // 3) 失去体力后死亡 → 不再询问选项(贞烈仍生效)
  if (!state.players[ownerId]?.alive) return;

  // 4) 询问选项
  delete state.localVars[CHOOSE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CHOOSE_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '贞烈:选择一项(确认=获得使用者一张牌;取消=本回合结束阶段发动一次秘计)',
      confirmLabel: '获得一张牌',
      cancelLabel: '发动秘计',
    },
    defaultChoice: false,
    timeout: 15,
  });
  const choice = state.localVars[CHOOSE_KEY] as string | undefined;
  delete state.localVars[CHOOSE_KEY];

  if (choice === 'gain') {
    // ① 获得使用者一张牌:复用 反馈 选牌面板(手牌+装备,不含判定区)
    const source = state.players[sourceId];
    if (!source?.alive) return;
    const hasCards = source.hand.length > 0 || Object.keys(source.equipment).length > 0;
    if (!hasCards) return; // 来源无牌可获 → 跳过(贞烈仍生效)
    await runPickTargetCardPanel(state, ownerId, sourceId, source, {
      mode: 'obtain',
      requestType: PICK_RT,
      title: '贞烈:选择获得使用者的一张牌',
      includeJudge: false,
    });
  } else {
    // ② 本回合结束阶段发动一次秘计:写 turn.vars(回合结束 atom 自动清兜底)
    state.turn.vars[`${MIJI_PENDING_PREFIX}${ownerId}`] = true;
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '成为其他角色杀或普通锦囊的目标后,可失1体力令此牌对你无效,然后二选一:获得使用者一张牌或本回合结束阶段发动一次秘计',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:贞烈三个 requestType 共用一个 action ──────────
  //   CONFIRM_RT  → 设 CONFIRM_KEY(boolean)
  //   CHOOSE_RT   → 设 CHOOSE_KEY('gain'|'miji')
  //   PICK_RT     → 设 选牌/结果(由 runPickTargetCardPanel 读取)
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as { requestType?: string }).requestType;
      if (rt === CONFIRM_RT || rt === CHOOSE_RT) {
        // confirm:接受 choice/confirmed 布尔
        return null;
      }
      if (rt === PICK_RT) {
        // 选牌面板:校验 zone + cardId/handIndex(同 反馈)
        const zone = params.zone;
        if (zone === 'equipment') {
          if (typeof params.cardId !== 'string') return 'cardId required';
        } else if (zone === 'hand') {
          if (typeof params.handIndex !== 'number') return 'handIndex required';
        } else {
          return 'zone required (equipment|hand)';
        }
        return null;
      }
      return '当前不是贞烈回应';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === CHOOSE_RT) {
        // confirm → 'gain';cancel → 'miji'
        st.localVars[CHOOSE_KEY] =
          params.choice === true || params.confirmed === true ? 'gain' : 'miji';
      } else if (rt === PICK_RT) {
        st.localVars['选牌/结果'] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
      }
    },
  );

  // ── 成为目标 after:杀/决斗 触发点 ─────────────────────────
  registerAfterHook(state, skill.id, ownerId, '成为目标', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    const sourceId = atom.source;
    if (sourceId === undefined || sourceId === ownerId) return; // "其他角色"
    const cardId = atom.cardId;
    if (!cardId) return;
    const card = ctx.state.cardMap[cardId];
    if (!isKillOrNormalTrick(card)) return;
    // 成为目标 hook 只处理杀/决斗——普通锦囊(顺手牵羊/过河拆桥等)通过请求回应(无懈窗口)触发
    // (旧代码中普通锦囊不走 成为目标 atom;迁移后 runUseFlow 统一发出该 atom,但普通锦囊的
    // 贞烈触发仍由 请求回应 before-hook 处理,以保持 "锦囊无效但仍弹选牌面板" 的语义)
    if (card.name !== '杀' && card.name !== '决斗') return;
    if (!ctx.state.players[ownerId]?.alive) return;
    // 防重入:同一张牌只触发一次(可能 multiple hooks fire)
    if (isProcessedFor(ctx.state, cardId, ownerId)) return;
    ctx.state.localVars[processedKey(cardId, ownerId)] = true;
    await runZhenlie(ctx.state, ownerId, cardId, sourceId);
  });

  // ── 请求回应 before:普通锦囊 触发点(无懈窗口打开前) ───────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '请求回应',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.requestType !== '无懈可击') return;
      if (atom.cancelTarget !== ownerId) return;
      const frame = topFrame(ctx.state);
      if (!frame) return;
      if (frame.from === ownerId) return; // "其他角色":使用者不是自己
      const cardId = frame.params?.cardId as string | undefined;
      if (!cardId) return;
      const card = ctx.state.cardMap[cardId];
      if (!isKillOrNormalTrick(card)) return;
      // 排除 杀/决斗(已由 成为目标 after 覆盖);此处只接普通锦囊(非杀)
      // 注:杀/决斗不会开无懈窗口,这里实际只可能是普通锦囊;但仍排除"杀"以防未来扩展
      if (card.name === '杀') return;
      if (!ctx.state.players[ownerId]?.alive) return;
      if (isProcessedFor(ctx.state, cardId, ownerId)) return;
      ctx.state.localVars[processedKey(cardId, ownerId)] = true;
      // 触发贞烈(不 cancel 无懈窗口:无懈与贞烈相互独立,无懈照常开)
      await runZhenlie(ctx.state, ownerId, cardId, frame.from);
    },
  );

  // ── 检测有效性 before:杀无效化(仁王盾同位) ────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '检测有效性',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if (isInvalidFor(ctx.state, atom.cardId, ownerId)) return { kind: 'cancel' };
    },
  );

  // ── 造成伤害 before:AOE/决斗/火攻 无效化 ──────────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if (isInvalidFor(ctx.state, atom.cardId, ownerId)) return { kind: 'cancel' };
    },
  );

  // ── 询问杀 before:南蛮入侵 无效化(不询问出杀) ─────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问杀',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      const frame = topFrame(ctx.state);
      const cardId = frame?.params?.cardId as string | undefined;
      if (isInvalidFor(ctx.state, cardId, ownerId)) return { kind: 'cancel' };
    },
  );

  // ── 获得 before:顺手牵羊/桃园/五谷 无效化(别人从王异处获得) ─
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '获得',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.from !== ownerId) return; // 别人从王异处获得
      if (atom.player === ownerId) return; // 自己获得自己不算
      const frame = topFrame(ctx.state);
      const cardId = frame?.params?.cardId as string | undefined;
      if (isInvalidFor(ctx.state, cardId, ownerId)) return { kind: 'cancel' };
    },
  );

  // ── 弃置 before:过河拆桥 无效化(弃王异的牌) ──────────────
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '弃置',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      const frame = topFrame(ctx.state);
      const cardId = frame?.params?.cardId as string | undefined;
      if (isInvalidFor(ctx.state, cardId, ownerId)) return { kind: 'cancel' };
    },
  );

  // ── 设横置 before:铁索连环 触发点 + 无效化 ─────────────────
  //   铁索连环无目标级无懈窗口(整卡一次, cancelTarget=from),上面两个触发点都
  //   覆盖不到。此处既是"成为目标"也是"效果生效":若已激活则 cancel,否则触发。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '设横置',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      const frame = topFrame(ctx.state);
      if (!frame || frame.skillId !== '铁索连环') return;
      if (frame.from === ownerId) return; // 自己用铁索连环不触发
      const cardId = frame.params?.cardId as string | undefined;
      if (!cardId) return;
      // 已无效化 → cancel
      if (isInvalidFor(ctx.state, cardId, ownerId)) return { kind: 'cancel' };
      if (!ctx.state.players[ownerId]?.alive) return;
      if (isProcessedFor(ctx.state, cardId, ownerId)) return;
      ctx.state.localVars[processedKey(cardId, ownerId)] = true;
      // 触发贞烈(若激活则同时设置无效标记 → 上方 isInvalidFor 检查会在下次进入时 cancel;
      //   本次直接 cancel 避免本次设横置生效)
      await runZhenlie(ctx.state, ownerId, cardId, frame.from);
      // 若激活,本次设横置也要 cancel(已在 runZhenlie 内设置无效标记)
      if (isInvalidFor(ctx.state, cardId, ownerId)) return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '是否发动贞烈?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
