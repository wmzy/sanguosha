// 界父魂(界关兴张苞·转化技 + 被动触发):
//   你可将两张牌当【杀】使用或打出。
//   你使用的转化【杀】目标角色只能使用颜色相同的手牌响应;
//   你于出牌阶段使用【杀】造成伤害后,你本回合获得"武圣""咆哮"。
//
// OL 界限突破官方(hero/690)逐字。
//
// 与标版父魂(关兴张苞)差异:
//   1. 牌范围:界版"两张牌"(含装备区),标版"两张手牌"
//   2. 界版新增:转化杀的目标只能用同色手牌响应(颜色限制)
//   3. 触发条件:界版"使用【杀】造成伤害"(任何杀),标版"以此法造成伤害"(仅转化杀)
//
// 实现:
//   A. 转化 action(2 牌 → 杀):preceding=[界父魂.transform] + 主 action=杀.use
//      类似丈八蛇矛多卡转化,但允许装备区牌(参考界武圣卸装备模式)。
//      影子 id = ${id1}#${id2}#父魂,多卡转化 shadowOf=undefined,颜色取综合。
//
//   B. 颜色限制:转化杀的目标只能用同色手牌响应
//      before-hook on 询问闪:检测当前结算帧的 杀 是 ownerId 的转化杀
//      (frame.params.cardId 含 '#' 即为影子卡)且颜色非无色 → 设 localVars['闪/色限制']
//      after-hook on 询问闪:清 localVars['闪/色限制'](无论 resolve 路径)
//      闪.ts 通用色限制检查读取此 localVars(其他技能亦可复用)
//
//   C. 获得武圣咆哮(被动,本回合):
//      after-hook on 造成伤害:source=ownerId + amount>0 + 自己回合出牌阶段
//        → state.turn.vars['父魂/granted'] = ownerId
//        + applyAtom(回合用量) 投影到 view.players[ownerId].turnUsage
//      咆哮效果:slashMaxProvider 读 turn.vars,granted 时返回 Infinity
//      武圣效果:transform action(1 红色手牌 → 杀),activeWhen 读 turnUsage
//      回合结束 atom 自动清空 turn.vars → grant 自然失效
//
// 契约:
//   - turn.vars['父魂/granted']:生产=造成伤害 after hook,消费=slashMaxProvider+武圣 transform
//   - localVars['闪/色限制']:生产=询问闪 before hook,消费=闪.respond validate,清=询问闪 after hook
import type {
  Card,
  EquipSlot,
  GameView,
  GameState,
  Json,
  Skill,
  FrontendAPI,
  HookResult,
} from '../types';
import type { Color } from '../../shared/types';
import { registerAction, registerAfterHook, registerBeforeHook, hasBlockingPending } from '../skill';
import { applyAtom, topFrame } from '../create-engine';
import { registerSlashMaxProvider } from '../slash-quota';
import { viewCanAttack } from '../viewDistance';
import { defaultPlayActive, viewCanSlash } from '../action-active';

const GRANT_VAR = '父魂/granted';
const COLOR_LIMIT_VAR = '闪/色限制';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '父魂',
    description:
      '转化技:两张牌当杀;转化杀目标只能用同色手牌响应;出牌阶段杀造成伤害后本回合获得武圣咆哮',
  };
}

// ─── A. 父魂 转化 action:2 张牌(手牌或装备区)→ 杀 ─────────────

/** 父魂 影子卡 id:${id1}#${id2}#父魂 */
function 父魂ShadowId(id1: string, id2: string): string {
  return `${id1}#${id2}#父魂`;
}

/** 玩家某张牌是否在自己的可控区域(手牌或装备区) */
function cardInOwnZone(self: GameState['players'][number], cardId: string): boolean {
  if (self.hand.includes(cardId)) return true;
  return Object.values(self.equipment).some((id) => id === cardId);
}

// ─── B'. granted 武圣 影子卡 id:${原id}#父魂武圣 ─────────────

function 武圣ShadowId(cardId: string): string {
  return `${cardId}#父魂武圣`;
}

// ─── granted 标记读写 helper ─────────────────────────

function isGranted(state: GameState, ownerId: number): boolean {
  return state.turn.vars[GRANT_VAR] === ownerId;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── A. 父魂 转化(主动 preceding) ──
  const unregTransform = registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardIds = params.cardIds;
      if (!Array.isArray(cardIds) || cardIds.length !== 2) return '需要选择 2 张牌';
      const [id1, id2] = cardIds as string[];
      if (typeof id1 !== 'string' || typeof id2 !== 'string') return 'cardIds 必须为字符串';
      if (id1 === id2) return '不能选择同一张牌';
      const cardsOwned = !!self && cardInOwnZone(self, id1) && cardInOwnZone(self, id2);
      const c1 = state.cardMap[id1];
      const c2 = state.cardMap[id2];
      const cardsExist = !!c1 && !!c2;
      const ok = myTurn && inActPhase && free && selfAlive && cardsOwned && cardsExist;
      return ok ? null : '父魂转化条件不满足';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardIds = params.cardIds as string[];
      const [id1, id2] = cardIds;
      const self = state.players[ownerId];
      // 装备区牌:先卸下到手牌(当作要求牌在手牌)。记录原槽位供 rollback。
      // 同 界武圣.ts / 奇袭.ts 的装备转化模式。
      const equipsToUnequip: Array<{ slot: EquipSlot; cardId: string }> = [];
      for (const cid of cardIds) {
        const entry = Object.entries(self.equipment).find(([, id]) => id === cid);
        if (entry) equipsToUnequip.push({ slot: entry[0] as EquipSlot, cardId: cid });
      }
      if (equipsToUnequip.length > 0) {
        params['_unequipped'] = equipsToUnequip as unknown as Json;
        for (const { slot } of equipsToUnequip) {
          await applyAtom(state, { type: '卸下', player: ownerId, slot });
        }
      }
      const shadowId = 父魂ShadowId(id1, id2);
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds,
        shadowId,
        outputName: '杀',
      });
    },
    // rollback:主 action validate 失败时撤销转化(删影子 + 还原牌)
    (state: GameState, params: Record<string, Json>) => {
      const cardIds = params.cardIds;
      const [id1, id2] = Array.isArray(cardIds) ? (cardIds as string[]) : [];
      const sId = id1 && id2 ? 父魂ShadowId(id1, id2) : undefined;
      if (!sId) return;
      delete state.cardMap[sId];
      const self = state.players[ownerId];
      // 影子从手牌移除
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand.splice(idx, 1);
      // 还原:装备区牌回装备槽;手牌回手牌
      const unequipped = params['_unequipped'] as
        | Array<{ slot: EquipSlot; cardId: string }>
        | undefined;
      if (unequipped) {
        for (const { slot, cardId } of unequipped) {
          // 若已被其他流程占用槽位,退回手牌兜底
          if (self.equipment[slot] === undefined) self.equipment[slot] = cardId;
          else self.hand.push(cardId);
        }
      }
      // 手牌原卡还原(当作把手牌过滤掉了)
      for (const cid of cardIds as string[]) {
        if (!self.hand.includes(cid) && !unequipped?.some((u) => u.cardId === cid)) {
          self.hand.push(cid);
        }
      }
    },
  );

  // ── B'. granted 武圣 转化(主动 preceding,granted 时生效) ──
  // 标准"武圣":将一张红色手牌当【杀】使用或打出。
  const unregWusheng = registerAction(
    state,
    skill.id,
    ownerId,
    '武圣transform',
    (state: GameState, params: Record<string, Json>) => {
      if (!isGranted(state, ownerId)) return '本回合未获得武圣';
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isRed = !!card && card.color === '红';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && isRed;
      return ok ? null : '现在不能使用武圣';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = 武圣ShadowId(cardId);
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '杀',
      });
    },
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = 武圣ShadowId(cardId);
      delete state.cardMap[sId];
      const self = state.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );

  // ── C. granted 咆哮:slashMaxProvider 读 turn.vars,granted 时 Infinity ──
  const unregMax = registerSlashMaxProvider(state, ownerId, (s, p) =>
    isGranted(s, p) ? Infinity : 0,
  );

  // ── D. 造成伤害 after:owner 出牌阶段杀造成伤害 → granted 标记 ──
  const unregDmgHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      // 限定出牌阶段(描述明确:"你于出牌阶段使用【杀】造成伤害后")
      if (ctx.state.phase !== '出牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      // 限定 杀 造成(其他伤害来源不触发)
      // 造成伤害 atom 携带 cardId;杀帧 skillId==='杀' 兜底
      const cardId = atom.cardId;
      const card = cardId ? ctx.state.cardMap[cardId] : undefined;
      const isSlash = card?.name === '杀' || topFrame(ctx.state)?.skillId === '杀';
      if (!isSlash) return;
      if (isGranted(ctx.state, ownerId)) return; // 已标记,避免重复投影
      ctx.state.turn.vars[GRANT_VAR] = ownerId;
      await applyAtom(ctx.state, {
        type: '回合用量',
        player: ownerId,
        key: GRANT_VAR,
        value: true,
      });
    },
  );

  // ── E. 询问闪 before:owner 的转化杀 → 设颜色限制 ──
  const unregBeforeDodge = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      // 仅 source 是 owner 时:owner 使用的转化杀
      if (atom.source !== ownerId) return;
      // 读 杀 帧 cardId(topFrame.params.cardId)
      const frame = topFrame(ctx.state);
      if (!frame || frame.skillId !== '杀') return;
      const cardId = frame.params['cardId'];
      if (typeof cardId !== 'string') return;
      // 转化杀判定:影子卡 id 含 '#'(物理杀 id 不含)
      // (武圣红牌、丈八蛇矛、父魂、granted 武圣 等转化杀均适用)
      if (!cardId.includes('#')) return;
      const slashCard = ctx.state.cardMap[cardId];
      if (!slashCard) return;
      const color = slashCard.color as Color;
      // 仅红/黑有同色要求;无色不限制
      if (color !== '红' && color !== '黑') return;
      ctx.state.localVars[COLOR_LIMIT_VAR] = color;
    },
  );

  // ── F. 询问闪 after:清颜色限制(无论 resolve 路径) ──
  const unregAfterDodge = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx) => {
      delete ctx.state.localVars[COLOR_LIMIT_VAR];
    },
  );

  return () => {
    unregTransform();
    unregWusheng();
    unregMax();
    unregDmgHook();
    unregBeforeDodge();
    unregAfterDodge();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 父魂 转化:2 张牌(手牌或装备区)→ 杀
  api.defineAction('transform', {
    label: '父魂',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择 2 张牌当杀使用',
      cardFilter: { filter: () => true, min: 2, max: 2 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    transform: (card: Card) => ({ name: '杀', sourceCardId: card.id, fromSkill: skill.id }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 手牌 + 装备区合计 ≥ 2
      const equipCount = Object.values(p.equipment ?? {}).filter(Boolean).length;
      const total = (p.handCount ?? 0) + equipCount;
      return total >= 2 && viewCanSlash(ctx.view, ctx.perspectiveIdx);
    },
  });

  // granted 武圣 转化:1 张红色手牌 → 杀(granted 时才显示)
  api.defineAction('武圣transform', {
    label: '武圣',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色手牌当杀使用',
      cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    transform: (card: Card) => ({ name: '杀', sourceCardId: card.id, fromSkill: skill.id }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      // 仅在获得武圣时显示
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      if (!p.turnUsage?.[GRANT_VAR]) return false;
      const hasRed = p.hand?.some((c) => c.color === '红') ?? false;
      return hasRed && viewCanSlash(ctx.view, ctx.perspectiveIdx);
    },
  });

  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
