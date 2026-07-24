// 界潜袭(界马岱·蜀·主动技,OL 界限突破官方逐字):
//   准备阶段,你可以摸一张牌并展示一张牌。若如此做:
//   - 距离为1的其他角色本回合不能使用或打出与"潜袭"牌颜色相同的手牌;
//   - 你本回合使用"潜袭"牌造成的伤害+1。
//
// 界限突破(相对标潜袭,标版 src/engine/skills/潜袭.ts 未实现):
//   1. 标版:准备阶段摸一张并弃置一张,令距离为1的一名角色本回合不能使用/打出与弃牌同色手牌
//      (单一目标;代价=弃置)。
//   2. 界版:摸一张并展示一张(不弃置,展示后仍持手牌,展示 atom 仅广播身份);效果群体
//      作用于所有距离≤1 的其他角色;且 owner 用此"潜袭牌"造伤+1。
//
// 实现要点:
//   - 触发时机:阶段开始(准备) after-hook(参考洛神/志继/界凿险)。
//   - 流程:询问发动 → 摸牌 count=1 → 选一张手牌展示(pickProcessingCard,prompt 仅 owner 可见)
//     → 展示 atom 公开 → 记录 cardId+color 到 turn.vars(回合结束 atom 自动清空)
//     → 对所有 effectiveDistance(state, ownerId, target)===1 的其他存活角色加禁色标签。
//   - 禁色实施(三处 before-hook):
//       a) 请求回应:目标有禁色标签 + prompt 是出牌型(useCard/useCardAndTarget/pick*
//          /distribute) → modify 包装 cardFilter 排除禁色;若包装后手中无可用牌 → cancel。
//       b) 询问闪:目标有禁色标签 → 若手中无非禁色闪 → cancel;否则放行(前端 UI 应隐藏禁色闪)。
//       c) 询问杀:同 b,把"闪"换"杀"。
//     注:询问闪/询问杀 的 prompt 写在 atom def(全局共享),无法 per-atom 替换 cardFilter;
//     当目标手中同时持有禁色与非禁色闪/杀时,引擎层不强制过滤,依赖前端 UI 不让玩家点禁色牌。
//     这是已知边界,与义绝 BAN_TAG 的"全 cancel"语义不同(义绝禁所有色,本技仅禁一色)。
//   - 增伤 before-hook on '造成伤害':source===ownerId + cardId===turn.vars['界潜袭/cardId']
//     + amount>0 → amount+1(单次消费,清掉 turn.vars['界潜袭/cardId'] 防重入)。
//   - 回合结束 after-hook:清所有玩家的界潜袭禁色标签(本回合生效,回合结束失效)。
//
// 命名:文件名/loader key/character skill name 均为 '界潜袭'(避开标潜袭冲突);
//   内部 Skill.name = '潜袭'(OL 官方技能名,玩家可见)。
import type {
  ActionPrompt,
  AtomBeforeContext,
  AtomOfName,
  Card,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import type { Color } from '../../shared/types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { effectiveDistance } from '../distance';
import {
  registerAction,
  registerAfterHook,
  registerBeforeHook,
  type SkillModule,
} from '../skill';

const SKILL_ID = '界潜袭';
const DISPLAY_NAME = '潜袭';

/** localVars:owner 是否发动潜袭(choice=true/false)。 */
const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
/** localVars:owner 选中的展示牌 cardId。 */
const PICK_KEY = `${SKILL_ID}/pickedCard`;

/** requestType 常量。 */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
const PICK_RT = `${SKILL_ID}/pick`;

/** turn.vars:本回合潜袭牌的 cardId(用于增伤匹配,回合结束自动清空)。 */
const CARDID_VAR = `${SKILL_ID}/cardId`;
/** turn.vars:本回合潜袭牌的颜色('红'|'黑')。 */
const COLOR_VAR = `${SKILL_ID}/color`;

/** 标签:距离 1 的其他角色本回合不能使用或打出红色/黑色手牌。 */
const TAG_RED = `${SKILL_ID}/禁红`;
const TAG_BLACK = `${SKILL_ID}/禁黑`;
const ALL_TAGS = [TAG_RED, TAG_BLACK];

/** 需要打出/使用手牌的 prompt 类型(纯选择型如 confirm/chooseSuit/selectTarget 不在此列)。 */
const CARD_PLAY_PROMPTS = new Set([
  'useCard',
  'useCardAndTarget',
  'pickProcessingCard',
  'pickTargetCard',
  'distribute',
]);

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '准备阶段,你可以摸一张牌并展示一张牌;距离为1的其他角色本回合不能使用或打出与"潜袭"牌颜色相同的手牌,你本回合使用"潜袭"牌造成的伤害+1',
  };
}

/** 取目标当前被禁的颜色(优先红,再黑;界潜袭只设一种)。 */
function bannedColor(tags: string[]): Color | null {
  if (tags.includes(TAG_RED)) return '红';
  if (tags.includes(TAG_BLACK)) return '黑';
  return null;
}

/** 判断玩家手中是否存在「指定 name 且非禁色」的牌。 */
function hasNonBannedCard(
  state: GameState,
  player: number,
  cardName: string,
  ban: Color,
): boolean {
  const hand = state.players[player]?.hand ?? [];
  for (const id of hand) {
    const c = state.cardMap[id];
    if (!c) continue;
    if (c.name !== cardName) continue;
    if (c.color === ban) continue;
    if (c.color === '无色') continue; // 无色牌不计(转化合成卡,基本牌不会无色)
    return true;
  }
  return false;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // respond:owner 在「界潜袭/confirm」「界潜袭/pick」询问下的回应
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const reqType = atom['requestType'] as string | undefined;
      if (reqType === CONFIRM_RT) {
        if (typeof params.choice !== 'boolean') return '需要选择一项';
        return null;
      }
      if (reqType === PICK_RT) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张手牌展示';
        if (!st.players[ownerId]?.hand.includes(cardId)) return '牌不在手牌中';
        return null;
      }
      return '当前不是界潜袭回应';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const reqType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (reqType === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true;
      } else if (reqType === PICK_RT) {
        st.localVars[PICK_KEY] = params.cardId as string;
      }
    },
  );

  // ── 阶段开始(准备) after-hook:潜袭主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '准备') return;
    if (!ctx.state.players[ownerId]?.alive) return;

    // 询问是否发动潜袭
    delete ctx.state.localVars[CONFIRM_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动潜袭?(摸一张并展示一张牌;距离1的其他角色本回合不能使用/打出同色手牌,你用此牌造伤+1)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (ctx.state.localVars[CONFIRM_KEY] !== true) {
      delete ctx.state.localVars[CONFIRM_KEY];
      return;
    }
    delete ctx.state.localVars[CONFIRM_KEY];

    await pushFrame(ctx.state, SKILL_ID, ownerId, {});

    // ── 摸一张牌 ──
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });

    // ── 选一张手牌展示(owner 自选;含刚摸到的牌) ──
    const self = ctx.state.players[ownerId];
    if (!self?.alive || self.hand.length === 0) {
      // 无手牌可展示 → 无事发生(仍算发动过,但效果落空)
      await popFrame(ctx.state);
      return;
    }
    const cards = self.hand
      .map((id) => {
        const c = ctx.state.cardMap[id];
        if (!c) return null;
        return { cardId: id, cardName: c.name, suit: c.suit, rank: c.rank };
      })
      .filter(
        (c): c is { cardId: string; cardName: string; suit: Card['suit']; rank: string } =>
          c !== null,
      );

    delete ctx.state.localVars[PICK_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: PICK_RT,
      target: ownerId,
      prompt: {
        type: 'pickProcessingCard',
        title: '潜袭:选择一张手牌展示(距离1的其他角色本回合不能使用/打出同色手牌,你用此牌造伤+1)',
        cards,
      },
      timeout: 30,
    });

    // 读取 owner 选择(超时兜底:选手牌第一张,不放弃展示机会)
    let pickedId = ctx.state.localVars[PICK_KEY] as string | undefined;
    const ownerHand = ctx.state.players[ownerId]?.hand ?? [];
    if (!pickedId || !ownerHand.includes(pickedId)) {
      pickedId = ownerHand[0];
    }
    delete ctx.state.localVars[PICK_KEY];

    const pickedCard = pickedId ? ctx.state.cardMap[pickedId] : undefined;
    if (!pickedCard) {
      await popFrame(ctx.state);
      return;
    }

    // ── 公开展示此牌(全员可见) ──
    await applyAtom(ctx.state, { type: '展示', player: ownerId, cardId: pickedId });

    // ── 颜色判定('红' / '黑';无色不生效——但单张手牌不会无色) ──
    const color = pickedCard.color;
    if (color !== '红' && color !== '黑') {
      // 无色(理论上不会出现,稳妥起见中止)
      await popFrame(ctx.state);
      return;
    }

    // ── 记录到 turn.vars(供增伤 hook 匹配;回合结束 atom 自动清空) ──
    ctx.state.turn.vars[CARDID_VAR] = pickedId;
    ctx.state.turn.vars[COLOR_VAR] = color;

    // ── 对所有距离 1 的其他存活角色加禁色标签 ──
    const tag = color === '红' ? TAG_RED : TAG_BLACK;
    for (const p of ctx.state.players) {
      if (p.index === ownerId) continue;
      if (!p.alive) continue;
      if (effectiveDistance(ctx.state, ownerId, p.index) !== 1) continue;
      if (!p.tags.includes(tag)) {
        await applyAtom(ctx.state, { type: '加标签', player: p.index, tag });
      }
    }

    await popFrame(ctx.state);
  });

  // ── 禁色 before-hook:请求回应(覆盖出牌型 prompt) ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '请求回应',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      const target = atom.target;
      if (typeof target !== 'number' || target < 0) return;
      if (target === ownerId) return; // owner 自己不受禁色影响
      const player = ctx.state.players[target];
      if (!player?.alive) return;
      const ban = bannedColor(player.tags);
      if (!ban) return;
      const promptType = atom.prompt?.type;
      if (!promptType || !CARD_PLAY_PROMPTS.has(promptType)) return;

      // 包装 cardFilter 排除禁色牌
      const prompt = atom.prompt as
        | {
            type: string;
            cardFilter?: { filter?: (c: Card) => boolean; min: number; max: number };
          }
        | undefined;
      const cardFilter = prompt?.cardFilter;
      if (!cardFilter) return; // 无 cardFilter 的 prompt 不是出牌窗口,放行

      // 先检查目标手中是否存在「过滤后仍可用」的牌:若一张都没有 → cancel
      const originalFilter = cardFilter.filter;
      const hand = player.hand;
      const hasValid = hand.some((id) => {
        const c = ctx.state.cardMap[id];
        if (!c) return false;
        if (c.color === ban) return false;
        return originalFilter ? originalFilter(c) : true;
      });
      if (!hasValid) {
        return { kind: 'cancel' };
      }

      // 包装 filter
      const wrappedFilter = (c: Card) => {
        if (c.color === ban) return false;
        return originalFilter ? originalFilter(c) : true;
      };
      return {
        kind: 'modify',
        atom: {
          ...ctx.atom,
          prompt: {
            ...prompt,
            cardFilter: { ...cardFilter, filter: wrappedFilter },
          },
        } as typeof ctx.atom,
      };
    },
  );

  // ── 禁色 before-hook:询问闪 / 询问杀(目标手中无非禁色所需牌时 cancel) ──
  const askHandler = (cardName: string) => async (
    ctx: AtomBeforeContext<AtomOfName<'询问闪' | '询问杀'>>,
  ): Promise<HookResult | void> => {
    const atom = ctx.atom;
    const target = atom.target;
    if (typeof target !== 'number') return;
    if (target === ownerId) return;
    const player = ctx.state.players[target];
    if (!player?.alive) return;
    const ban = bannedColor(player.tags);
    if (!ban) return;
    // 目标手中存在非禁色的所需牌 → 放行(前端 UI 应隐藏禁色牌)
    // 全为禁色 → cancel(目标无可用牌响应)
    if (hasNonBannedCard(ctx.state, target, cardName, ban)) return;
    return { kind: 'cancel' };
  };
  registerBeforeHook(state, skill.id, ownerId, '询问闪', askHandler('闪'));
  registerBeforeHook(state, skill.id, ownerId, '询问杀', askHandler('杀'));

  // ── 增伤 before-hook on '造成伤害':owner 用潜袭牌造伤 +1(单次消费) ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      const cardId = atom.cardId;
      if (typeof cardId !== 'string') return;
      // 匹配本回合潜袭牌(影子卡场景 cardId 不同,不计入——按字面"潜袭牌"解释)
      if (ctx.state.turn.vars[CARDID_VAR] !== cardId) return;
      // 单次消费:清掉 turn.vars 中的 cardId,防同一牌多次触发(理论上牌入弃牌堆后不再造伤)
      delete ctx.state.turn.vars[CARDID_VAR];
      return {
        kind: 'modify',
        atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom,
      };
    },
  );

  // ── 回合结束 after-hook:清所有玩家的界潜袭禁色标签 ──
  //    仅 owner 自己的回合结束触发(禁色标签绑本回合,潜袭在 owner 回合准备阶段加)。
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    for (const p of ctx.state.players) {
      for (const tag of ALL_TAGS) {
        if (p.tags.includes(tag)) {
          await applyAtom(ctx.state, { type: '去标签', player: p.index, tag });
        }
      }
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '是否发动潜袭?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
