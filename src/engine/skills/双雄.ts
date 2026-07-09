// 双雄(颜良文丑·群雄):摸牌阶段,你可以放弃摸牌,改为展示牌堆顶两张牌
// 并选择其中一张,然后本回合你可以将一张与此牌同花色的手牌当【决斗】使用。
//
// 两部分组合:
//   A) 摸牌阶段触发(before-hook on 阶段开始,镜像再起/突袭):
//        询问发动 → 取牌堆顶2张(peek,不移动)→ 选其中一张(distribute select)
//        → 记 turn.vars['双雄/suit']=所选牌花色 → 两张牌均弃置(牌堆→弃牌堆)
//        → 跳过默认摸牌(applyAtom(阶段结束, 摸牌) + return {kind:'cancel'})
//   B) 转化 action(transform,preceding 决斗.use,镜像武圣单卡转化):
//        把一张花色匹配的手牌当【决斗】(影子卡 outputName='决斗')
//
// 跳过默认摸牌的手法同再起/突袭/兵粮寸断:applyAtom(阶段结束, 摸牌) 把阶段
// 推进到出牌,再 return {kind:'cancel'} 取消本次 阶段开始(摸牌),使 回合管理
// 的 after-hook(自动摸2张)不再执行。
//
// 展示机制:牌堆顶两张牌通过 select prompt 的静态 cardIds 传给发动者(其可见牌面,
// 含 name/suit/rank),由 cardMap 查得。两张牌随后从牌堆直接弃置(均不入手)。
//
// 花色状态同步:turn.vars['双雄/suit'] 由 before-hook 写入 state(后端 transform
// validate 读)。view 侧经「回合用量」atom 同步到 players[me].turnUsage['双雄/suit'],
// 供前端 transform 的 activeWhen/cardFilter 读取(processedView 不增量维护 turn.vars)。
import type {
  AtomBeforeContext,
  Card,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook, hasBlockingPending } from '../skill';
import { skipPhase } from '../skip-phase';
import { defaultPlayActive } from '../action-active';

const CONFIRM_RT = '双雄/confirm';
const SELECT_RT = '双雄/select';
const TRIGGERED_KEY = '双雄/triggered';
const SELECTED_KEY = '双雄/selected';
const REVEALED_KEY = '双雄/revealed';
const SUIT_KEY = '双雄/suit';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '双雄',
    description: '摸牌阶段,可放弃摸牌,展示牌堆顶两张并选一张,本回合可将同花色手牌当决斗使用',
  };
}

/** 影子卡 id:${原id}#双雄 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#双雄`;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // respond:处理 confirm(是否发动)与 select(选一张)两类询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState, params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== CONFIRM_RT && rt !== SELECT_RT) return '当前不是双雄询问';
      if (rt === SELECT_RT) {
        const cardIds = params.cardIds as string[] | undefined;
        if (!Array.isArray(cardIds) || cardIds.length !== 1) return '需要选择一张牌';
        const revealed = s.localVars[REVEALED_KEY] as string[] | undefined;
        if (!revealed?.includes(cardIds[0])) return '该牌不在可选范围';
      }
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        s.localVars[TRIGGERED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === SELECT_RT) {
        s.localVars[SELECTED_KEY] = params.cardIds;
      }
    },
  );

  // 阶段开始(摸牌) before:询问发动 → 取牌堆顶2张 → 选牌 → 记花色 → 弃置 → 跳过默认摸牌
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '摸牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 发动前置条件:牌堆顶至少 2 张可展示。不足则放弃发动,走默认摸牌
      if (ctx.state.zones.deck.length < 2) return;

      // 询问是否发动双雄
      delete ctx.state.localVars[TRIGGERED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动双雄?(放弃摸牌,展示牌堆顶两张,选一张花色,本回合同花色手牌当决斗)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[TRIGGERED_KEY] !== true) return; // 不发动 → 默认摸牌

      // 取牌堆顶 2 张(deck 末尾为顶):peek,不移动
      const top2 = ctx.state.zones.deck.slice(-2);
      ctx.state.localVars[REVEALED_KEY] = top2;

      // 选其中一张(distribute select:静态 cardIds 展示给发动者)
      delete ctx.state.localVars[SELECTED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: SELECT_RT,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: '双雄:选择一张牌(其花色为本回合决斗可用花色)',
          cardIds: top2,
          minTotal: 1,
          maxTotal: 1,
        },
        timeout: 15,
      });

      const picked = ctx.state.localVars[SELECTED_KEY] as string[] | undefined;
      // 兜底:超时或非法回应时取牌堆顶第一张(必须选一张,不放弃发动效果)
      const chosenId =
        picked?.length === 1 && top2.includes(picked[0]) ? picked[0] : top2[top2.length - 1];
      const chosenCard = ctx.state.cardMap[chosenId];
      const chosenSuit = chosenCard?.suit ?? '';

      // 记录本回合决斗可用花色(后端 transform validate 读)
      ctx.state.turn.vars[SUIT_KEY] = chosenSuit;
      // 同步到 view 侧(经「回合用量」atom),供前端 activeWhen/cardFilter 读取
      await applyAtom(ctx.state, {
        type: '回合用量',
        player: ownerId,
        key: SUIT_KEY,
        value: chosenSuit,
      });

      // 两张展示牌均弃置(FAQ:展示后两张都弃置,均不入手)。从牌堆直接移到弃牌堆。
      for (const id of top2) {
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: id,
          from: { zone: '牌堆' },
          to: { zone: '弃牌堆' },
        });
      }
      // 清理询问期 localVars
      delete ctx.state.localVars[TRIGGERED_KEY];
      delete ctx.state.localVars[SELECTED_KEY];
      delete ctx.state.localVars[REVEALED_KEY];

      // 跳过默认摸牌(直接型):阶段结束(摸牌)+ cancel
      return skipPhase(ctx.state, { player: ownerId, phase: '摸牌' });
    },
  );

  // transform action:把一张花色匹配的手牌转化为影子"决斗"(新建 Card 实体,
  // shadowOf 指向原卡)。作为 preceding 在 决斗.use 之前执行。
  // 决斗.use validate 读 cardMap[影子id] 看到"决斗"通过。决斗技能零感知双雄。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (s: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending + 存活
      const myTurn = s.currentPlayerIndex === ownerId;
      const inActPhase = s.phase === '出牌';
      const free = !hasBlockingPending(s);
      const self = s.players[ownerId];
      const selfAlive = self.alive === true;
      // 本回合必须已发动过双雄(花色已记)
      const suit = s.turn.vars[SUIT_KEY] as string | undefined;
      const suitSet = typeof suit === 'string' && suit !== '';
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const card = cardIdOk ? s.cardMap[cardId] : undefined;
      const cardExists = !!card;
      // 核心:手牌花色与所选花色相同
      const suitMatch = !!card && card.suit === suit;
      const ok =
        myTurn && inActPhase && free && selfAlive && suitSet && cardInHand && cardExists && suitMatch;
      return ok ? null : '双雄:需要一张与本回合所选花色相同的手牌';
    },
    async (s: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      // 通过「当作」atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(s, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '决斗',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (s: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete s.cardMap[sId];
      const self = s.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '双雄',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动双雄?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });

  // 转化技 transform:把一张同花色手牌当【决斗】。前端两步 UI(选牌+目标),
  // 提交时 preceding=[双雄.transform] + 主 action=决斗.use。
  // cardFilter 放宽为任意手牌(花色匹配由后端 validate 兜底),
  // activeWhen 仅在已发动双雄且存在同花色手牌时激活按钮。
  api.defineAction('transform', {
    label: '双雄',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张与本回合所选花色相同的手牌当决斗使用',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
    transform: (card: Card) => ({
      name: '决斗',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.hand) return false;
      const suit = p.turnUsage?.[SUIT_KEY];
      if (typeof suit !== 'string' || suit === '') return false;
      return p.hand.some((c) => c.suit === suit);
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
