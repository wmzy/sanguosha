// 界渐营(界沮授·群·被动技,OL 界限突破官方逐字):
//   当你于出牌阶段使用牌时,若此牌与你于此阶段使用的上一张牌花色或点数相同,
//   则你可以摸一张牌。出牌阶段限一次,你可以将一张牌当做任意一张基本牌使用,
//   若你于本阶段使用的上一张牌有花色,则此牌的花色视为与上一张牌的花色相同。
//
// 与标版渐营区别(标版未实现,docs/research/武将技能/群雄/沮授.md):
//   - 标版渐营只有"用牌与前张同花色或点数则摸一张"被动效果
//   - 界版新增第二段:出牌阶段限一次,将一张牌当任意基本牌使用(可继承上张花色)
//
// 实现要点:
//   - "上一张牌"追踪:turn.vars['界渐营/lastSuit']/['界渐营/lastRank'](string)
//     生产者:移动牌 after-hook(from=手牌,to=处理区,在 owner 出牌阶段)+ 装备 after-hook
//     消费者:移动牌 after-hook(下次比较)、渐营 transform execute(继承花色)
//     重置:阶段开始(出牌) after-hook(owner) → 置 ''(空,表示无上一张)
//   - 触发时机:移动牌 after-hook(owner 手牌→处理区,在 owner 出牌阶段)
//     和 装备 after-hook(owner 出牌阶段装备牌)
//     (装备也是"使用牌",需要追踪。OL 装备使用计入 渐营 触发条件)
//   - 限一次(第二段):player.vars['界渐营/transformUsedThisTurn'](后缀 /usedThisTurn 自动清空)
//   - 转化(第二段):当作 atom 创建影子卡;若上一张牌有花色,override 影子卡 suit/color
//   - 花色继承后视图同步限制:当作 atom 的 applyView 据源卡 view.cardMap 构造影子,
//     override 是直接 mutate state.cardMap[shadowId](applyView 看不到),故视图可能不一致。
//     测试中用 disableAutoCompare() 跳过已知视图不一致,行为正确性由 state 直接验证。
//
// 命名:文件名/loader key/character skill name 均为 '界渐营'(避开标版冲突);
//   内部 Skill.name = '渐营'(OL 官方技能名,玩家可见)。
import type {
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import {
  registerAction,
  registerAfterHook,
  hasBlockingPending,
  type SkillModule,
} from '../skill';
import { defaultPlayActive } from '../action-active';

const SKILL_ID = '界渐营';
const DISPLAY_NAME = '渐营';

/** 上一张牌花色('' = 本阶段尚未使用过牌) */
const LAST_SUIT_KEY = `${SKILL_ID}/lastSuit`;
/** 上一张牌点数('' = 本阶段尚未使用过牌) */
const LAST_RANK_KEY = `${SKILL_ID}/lastRank`;
/** 第二段"当任意基本牌使用"限一次标记(后缀 /usedThisTurn 自动清空) */
const TRANSFORM_USED_KEY = `${SKILL_ID}/transformUsedThisTurn`;
/** 询问 requestType:渐营是否摸一张 */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
/** localVars key:owner 是否确认摸牌 */
const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;

/** 渐营第二段允许声明的目标牌名(基本牌) */
const ALLOWED_NAMES: ReadonlySet<string> = new Set(['杀', '闪', '桃', '酒']);

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段用牌若与上一张花色或点数相同,可摸一张;每阶段限一次,可将一张牌当任意基本牌使用(若有上一张花色则继承)',
  };
}

/** 影子卡 id: ${原id}#界渐营 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#${SKILL_ID}`;
}

/** 上一张牌花色('' / '♠' / '♥' / '♣' / '♦') */
function lastSuit(state: GameState): string {
  const v = state.turn.vars[LAST_SUIT_KEY];
  return typeof v === 'string' ? v : '';
}

/** 上一张牌点数 */
function lastRank(state: GameState): string {
  const v = state.turn.vars[LAST_RANK_KEY];
  return typeof v === 'string' ? v : '';
}

/** 写入"上一张牌" */
function setLast(state: GameState, suit: string, rank: string): void {
  state.turn.vars[LAST_SUIT_KEY] = suit;
  state.turn.vars[LAST_RANK_KEY] = rank;
}

/** 重置"上一张牌"为空 */
function resetLast(state: GameState): void {
  setLast(state, '', '');
}

/** 是否处于 owner 的出牌阶段 */
function inMyPlayPhase(state: GameState, ownerId: number): boolean {
  return state.currentPlayerIndex === ownerId && state.phase === '出牌';
}

/** 第二段是否已用过(限一次/阶段) */
function transformUsed(state: GameState, ownerId: number): boolean {
  return !!state.players[ownerId]?.vars[TRANSFORM_USED_KEY];
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:owner 在"摸一张牌"询问下的回应 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CONFIRM_RT) return '当前不是渐营询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── transform:第二段——把一张牌转化为声明的影子基本牌 ──
  // 作为 preceding 在 <outputName>.use 之前执行。<outputName>.validate 看到"基本牌"通过。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (!inMyPlayPhase(st, ownerId)) return '只能在你的出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (transformUsed(st, ownerId)) return '本阶段渐营转化已用过';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const cardId = params.cardId as string | undefined;
      const outputName = params.outputName as string | undefined;
      if (typeof cardId !== 'string') return '需要选择一张牌';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      if (typeof outputName !== 'string' || !ALLOWED_NAMES.has(outputName)) {
        return '声明的牌名不合法(须为基本牌: 杀/闪/桃/酒)';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const cardId = params.cardId as string;
      const outputName = params.outputName as string;
      const shadowId = shadowIdOf(cardId);
      const prevSuit = lastSuit(st);

      // 限一次标记:同步设 vars(防 dispatch 重入)+ 回合用量 atom 投影 view(前端禁用按钮)。
      // 必须在第一个 await 之前设置(见制衡.ts 注释)。
      st.players[ownerId].vars[TRANSFORM_USED_KEY] = true;
      await applyAtom(st, {
        type: '回合用量',
        player: ownerId,
        key: TRANSFORM_USED_KEY,
        value: true,
      });

      // 创建影子卡(原卡仍在 cardMap,shadowOf 指向原卡;原卡花色/颜色继承)
      await applyAtom(st, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName,
      });

      // 若上一张牌有花色,override 影子卡 suit/color 与之一致
      if (prevSuit !== '') {
        const shadow = st.cardMap[shadowId];
        if (shadow) {
          shadow.suit = prevSuit as Card['suit'];
          shadow.color = prevSuit === '♥' || prevSuit === '♦' ? '红' : '黑';
        }
      }
    },
    // rollback: 主 action validate 失败时撤销转化(删影子,手牌还原 + 清限一次标记)
    (st: GameState, params: Record<string, Json>): void => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete st.cardMap[sId];
      const self = st.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
      // 撤销限一次标记(transform 失败 → 渐营算作未用)
      delete self.vars[TRANSFORM_USED_KEY];
    },
  );

  // ── 阶段开始(出牌) after-hook:owner 出牌阶段开始 → 重置"上一张牌" ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    resetLast(ctx.state);
  });

  // ── 移动牌 after-hook:owner 出牌阶段内 hand→处理区 = 主动使用/打出 ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const st = ctx.state;
    if (!inMyPlayPhase(st, ownerId)) return;
    const atom = ctx.atom;
    if (atom.from?.zone !== '手牌') return;
    if (atom.from.player !== ownerId) return;
    if (atom.to?.zone !== '处理区') return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    const card = st.cardMap[cardId];
    if (!card) return;

    await checkAndPromptDraw(st, ownerId, card);
  });

  // ── 装备 after-hook:owner 出牌阶段内装备牌 = 使用牌 ──
  registerAfterHook(state, skill.id, ownerId, '装备', async (ctx) => {
    const st = ctx.state;
    if (!inMyPlayPhase(st, ownerId)) return;
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    const card = st.cardMap[cardId];
    if (!card) return;

    await checkAndPromptDraw(st, ownerId, card);
  });

  return () => {};
}

/**
 * 渐营第一段核心:比较当前牌与"上一张牌",若花色或点数相同则询问是否摸一张;
 * 之后无条件将"上一张牌"更新为当前牌。
 */
async function checkAndPromptDraw(
  st: GameState,
  ownerId: number,
  card: Card,
): Promise<void> {
  const prevSuit = lastSuit(st);
  const prevRank = lastRank(st);
  const hasPrev = prevSuit !== '' || prevRank !== '';

  const suitMatch = hasPrev && card.suit !== '' && card.suit === prevSuit;
  const rankMatch = hasPrev && card.rank !== '' && card.rank === prevRank;

  // 先更新"上一张牌"——询问与执行摸牌都应不阻塞追踪,且若询问被拒不应影响下一张比较
  setLast(st, card.suit, card.rank);

  if (!suitMatch && !rankMatch) return; // 不匹配 → 不询问

  // 匹配 → 询问是否摸一张
  delete st.localVars[CONFIRMED_KEY];
  await applyAtom(st, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '是否发动渐营?(此牌与上一张花色或点数相同,可摸一张)',
      confirmLabel: '摸一张',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 10,
  });

  if (st.localVars[CONFIRMED_KEY] === true) {
    await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
  }
  delete st.localVars[CONFIRMED_KEY];
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('transform', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '渐营:选择一张牌,声明一种基本牌(杀/闪/桃/酒)使用',
      description: '出牌阶段限一次;若上一张牌有花色,此牌视为与之同花色',
      cardFilter: { min: 1, max: 1 },
      // outputName 由前端通过额外 UI(声明面板)选择;此处不限定具体牌名
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      if (p.turnUsage?.[TRANSFORM_USED_KEY]) return false; // 本阶段已用过
      return (p.handCount ?? 0) > 0;
    },
  });
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动渐营?',
      confirmLabel: '摸一张',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
