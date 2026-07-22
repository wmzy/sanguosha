// 解围(界曹仁·主动技):
//   ① 你可以将装备区的一张牌当【无懈可击】使用。
//   ② 当你的武将牌从背面翻至正面时,你可以弃置一张牌移动场上的一张牌。
//
// 效果①实现(转化技,镜像看破/奇袭):
//   transform action:装备区的装备牌 → 卸下(装备区→手牌)+ 移除装备技能 →
//     当作 → 影子无懈可击。作为 preceding 在 无懈可击.respond 之前执行。
//   无懈可击技能零感知解围——它看到的永远是 cardMap 里的"无懈可击"。
//   不受自己回合限制(无懈可击任意时机可打)。activeWhen 检测无懈可击广播窗口且有装备。
//
// 效果②实现(被动触发,镜像巧变移动):
//   after hook 挂在「去标签」:检测 owner 的 '/翻面' 后缀标签被移除(=翻回正面)。
//   询问 → 选弃牌(手牌)→ 选源玩家 → 选源牌(pickTargetCard)→ 选目标玩家 →
//   移动场上牌(获得 atom,与巧变 moveFieldCard 一致)。
//   触发时机:据守消费翻面标签时(下一回合准备阶段)或被其他技能(界放逐)翻回正面时。
import type {
  Card,
  EquipSlot,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';
import { skillLoaders } from './index';

// ── 效果①:装备→无懈可击 转化 ──
const SHADOW_SUFFIX = '解围';

/** 影子卡 id:${原id}#解围 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#${SHADOW_SUFFIX}`;
}

/** 当前是否存在无懈可击广播窗口(玩家可回应) */
function hasNullifyWindow(state: GameState, playerId: number): boolean {
  for (const slot of state.pendingSlots.values()) {
    const atom = slot.atom as { type?: string; requestType?: string; target?: number };
    if (atom.type !== '请求回应') continue;
    if (atom.requestType !== '无懈可击') continue;
    if (typeof atom.target === 'number' && (atom.target < 0 || atom.target === playerId))
      return true;
  }
  return false;
}

// ── 效果②:翻回正面→弃牌移动 ──
const CONFIRM_RT = '解围/confirm';
const DISCARD_RT = '解围/discard';
const SOURCE_PLAYER_RT = '解围/source-player';
const SOURCE_CARD_RT = '解围/source-card';
const DEST_PLAYER_RT = '解围/dest-player';
const CONFIRMED_KEY = '解围/confirmed';
const DISCARD_KEY = '解围/discardCardId';
const SOURCE_PLAYER_KEY = '解围/sourcePlayer';
const SOURCE_CARD_KEY = '解围/sourceCard';
const DEST_PLAYER_KEY = '解围/destPlayer';
/** 重入保护:效果②交互进行中时设为 true,防止嵌套触发 */
const MOVING_FLAG = '解围/moving';

/** 取玩家"场上"的牌(手牌+装备+判定区)——用于源牌选择 */
function fieldCardIds(state: GameState, player: number): string[] {
  const p = state.players[player];
  if (!p) return [];
  const hand = [...p.hand];
  const equip = Object.values(p.equipment).filter((id): id is string => !!id);
  const judge = p.pendingTricks.map((t) => t.card.id);
  return [...hand, ...equip, ...judge];
}

/** 装备牌 subtype → 装备栏位 */
function slotOf(card: { subtype?: string } | undefined): EquipSlot | null {
  switch (card?.subtype) {
    case '武器':
      return '武器';
    case '防具':
      return '防具';
    case '进攻马':
      return '进攻马';
    case '防御马':
      return '防御马';
    case '宝物':
      return '宝物';
    default:
      return null;
  }
}

/**
 * 把 srcPlayer 场上的 srcCardId 移动到 destPlayer 场上(与巧变 moveFieldCard 一致)。
 * 判定区牌:先移除延时锦囊,再获得。
 * 装备/手牌:统一获得(获得 atom 自动处理 hand/equip 的 filter)。
 */
async function moveFieldCard(
  state: GameState,
  srcPlayer: number,
  srcCardId: string,
  destPlayer: number,
): Promise<void> {
  if (srcPlayer === destPlayer) return;
  const srcP = state.players[srcPlayer];
  if (!srcP) return;
  const card = state.cardMap[srcCardId];
  if (!card) return;

  // 判定区牌:先从判定区移除,再获得
  const judgeTrick = srcP.pendingTricks.find((t) => t.card.id === srcCardId);
  if (judgeTrick) {
    await applyAtom(state, {
      type: '移除延时锦囊',
      player: srcPlayer,
      trickName: judgeTrick.name,
    });
    await applyAtom(state, {
      type: '获得',
      player: destPlayer,
      cardId: srcCardId,
      from: srcPlayer,
    });
    return;
  }

  // 手牌/装备 → 目标手牌(获得 atom 自动处理)
  await applyAtom(state, {
    type: '获得',
    player: destPlayer,
    cardId: srcCardId,
    from: srcPlayer,
  });
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '解围',
    description:
      '装备区的一张牌当无懈可击使用;翻回正面时可弃置一张牌移动场上的一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ════════════════════════════════════════════════════════════
  // 效果①:transform action — 装备区牌 → 影子无懈可击
  // ════════════════════════════════════════════════════════════
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 解围不受自己回合限制(无懈可击任意时机可打)
      const self = state.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      // 只接受装备牌(来自装备区或手牌)
      const isEquip = !!card && card.type === '装备牌';
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const cardInEquip = cardIdOk && Object.values(self.equipment).some((id) => id === cardId);
      // 必须存在无懈可击窗口
      const hasWindow = hasNullifyWindow(state, ownerId);
      // 无其他阻塞型 pending(无懈窗口本身允许)
      const blockedByOther = (() => {
        for (const slot of state.pendingSlots.values()) {
          const atom = slot.atom as { type?: string; requestType?: string };
          if (!slot.isBlocking) continue;
          if (atom.type === '请求回应' && atom.requestType === '无懈可击') continue;
          return true;
        }
        return false;
      })();
      const ok = isEquip && (cardInHand || cardInEquip) && hasWindow && !blockedByOther;
      return ok ? null : '现在不能使用解围';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      const self = state.players[ownerId];

      // 装备区的装备牌:先移除装备技能(若有),再卸下到手牌(产生 ViewEvent),
      // 再走「当作」(当作要求牌在手牌)。
      const equipSlotEntry = Object.entries(self.equipment).find(([, id]) => id === cardId);
      if (equipSlotEntry) {
        const slot = equipSlotEntry[0] as EquipSlot;
        params['_origSlot'] = slot;
        // 移除装备自带技能(与 装备通用 一致,卸下 atom 不自动移除技能)
        const card = state.cardMap[cardId];
        if (card?.name && skillLoaders[card.name]) {
          await applyAtom(state, { type: '移除技能', player: ownerId, skillId: card.name });
        }
        await applyAtom(state, { type: '卸下', player: ownerId, slot });
      }

      // 通过「当作」atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '无懈可击',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      const self = state.players[ownerId];
      const origSlot = params['_origSlot'] as EquipSlot | undefined;

      // 删除影子卡
      delete state.cardMap[sId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) {
        if (origSlot) {
          // 原是装备牌:从手牌移除影子,还原装备槽位
          self.hand.splice(idx, 1);
          self.equipment[origSlot] = cardId;
        } else {
          // 原是手牌:影子替换回原卡
          self.hand[idx] = cardId;
        }
      }
    },
  );

  // ════════════════════════════════════════════════════════════
  // 效果②:respond — 翻回正面后多步交互的回应处理
  // ════════════════════════════════════════════════════════════
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      const valid = [
        CONFIRM_RT,
        DISCARD_RT,
        SOURCE_PLAYER_RT,
        SOURCE_CARD_RT,
        DEST_PLAYER_RT,
      ];
      if (!valid.includes(rt)) return '当前不是解围询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true;
        return;
      }
      if (rt === DISCARD_RT) {
        const cardIds = params.cardIds as string[] | undefined;
        const single = params.cardId as string | undefined;
        const id =
          (Array.isArray(cardIds) && cardIds.length > 0 ? cardIds[0] : undefined) ??
          (typeof single === 'string' ? single : undefined);
        if (id) st.localVars[DISCARD_KEY] = id;
        return;
      }
      if (rt === SOURCE_PLAYER_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[SOURCE_PLAYER_KEY] = t;
        return;
      }
      if (rt === SOURCE_CARD_RT) {
        // pickTargetCard respond: { zone, cardId, handIndex }
        const zone = params.zone as string | undefined;
        const cardId = params.cardId as string | undefined;
        const handIndex = params.handIndex as number | undefined;
        st.localVars[SOURCE_CARD_KEY] = JSON.stringify({ zone, cardId, handIndex });
        return;
      }
      if (rt === DEST_PLAYER_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[DEST_PLAYER_KEY] = t;
        return;
      }
    },
  );

  // ════════════════════════════════════════════════════════════
  // 效果②:去标签 after-hook — 翻回正面触发
  // ════════════════════════════════════════════════════════════
  registerAfterHook(state, skill.id, ownerId, '去标签', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '去标签') return;
    if (atom.player !== ownerId) return;
    // 只在 '/翻面' 后缀标签被移除时触发(= 翻回正面)
    if (!atom.tag?.endsWith('/翻面')) return;

    // 重入保护
    if (ctx.state.localVars[MOVING_FLAG]) return;

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 必须有手牌可弃
    if (self.hand.length === 0) return;
    // 场上必须有可移动的牌(任意玩家)
    const hasFieldCards = ctx.state.players.some(
      (p) => p.alive && fieldCardIds(ctx.state, p.index).length > 0,
    );
    if (!hasFieldCards) return;

    // 设重入保护
    ctx.state.localVars[MOVING_FLAG] = true;
    try {
      // 步骤 1:确认是否发动
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '解围:是否弃置一张牌移动场上的一张牌?',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return;

      // 步骤 2:选弃置的手牌
      delete ctx.state.localVars[DISCARD_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: DISCARD_RT,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: '解围:选择一张手牌弃置',
          source: 'hand',
          minTotal: 1,
          maxTotal: 1,
        },
        timeout: 20,
      });
      const discardCardId = ctx.state.localVars[DISCARD_KEY] as string | undefined;
      delete ctx.state.localVars[DISCARD_KEY];
      if (!discardCardId || !self.hand.includes(discardCardId)) return;

      // 弃置
      await applyAtom(ctx.state, {
        type: '弃置',
        player: ownerId,
        cardIds: [discardCardId],
      });

      // 步骤 3:选源玩家(有场上牌的任意存活角色)
      const playersWithCards = ctx.state.players.filter(
        (p) => p.alive && fieldCardIds(ctx.state, p.index).length > 0,
      );
      if (playersWithCards.length === 0) return;

      delete ctx.state.localVars[SOURCE_PLAYER_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: SOURCE_PLAYER_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '解围:选择源玩家(从其场上选一张牌移动)',
          min: 1,
          max: 1,
          filter: (_view, t: number) =>
            ctx.state.players[t]?.alive === true && fieldCardIds(ctx.state, t).length > 0,
        },
        timeout: 15,
      });
      const srcPlayer = ctx.state.localVars[SOURCE_PLAYER_KEY] as number | undefined;
      delete ctx.state.localVars[SOURCE_PLAYER_KEY];
      if (typeof srcPlayer !== 'number') return;

      // 步骤 4:选源牌(pickTargetCard 显示源玩家的装备/判定/手牌)
      const srcPlayerState = ctx.state.players[srcPlayer];
      if (!srcPlayerState?.alive || fieldCardIds(ctx.state, srcPlayer).length === 0) return;

      const equipment = Object.entries(srcPlayerState.equipment)
        .filter(([, id]) => typeof id === 'string')
        .map(([slot, id]) => ({ slot, cardId: id, cardName: ctx.state.cardMap[id]?.name ?? '?' }));
      const judge = srcPlayerState.pendingTricks.map((t) => ({
        cardId: t.card.id,
        cardName: t.card.name,
      }));
      const handCount = srcPlayerState.hand.length;

      if (equipment.length === 0 && judge.length === 0 && handCount === 0) return;

      delete ctx.state.localVars[SOURCE_CARD_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: SOURCE_CARD_RT,
        target: ownerId,
        prompt: {
          type: 'pickTargetCard',
          title: '解围:选择要移动的场上牌',
          target: srcPlayer,
          equipment,
          judge,
          handCount,
        },
        timeout: 20,
      });

      // 解析源牌选择
      const sourceCardRaw = ctx.state.localVars[SOURCE_CARD_KEY] as string | undefined;
      delete ctx.state.localVars[SOURCE_CARD_KEY];
      let srcCardId: string | undefined;
      if (sourceCardRaw) {
        try {
          const parsed = JSON.parse(sourceCardRaw) as {
            zone?: string;
            cardId?: string;
            handIndex?: number;
          };
          if (parsed.zone === 'equipment' || parsed.zone === 'judge') {
            if (typeof parsed.cardId === 'string') srcCardId = parsed.cardId;
          } else if (parsed.zone === 'hand') {
            const idx = typeof parsed.handIndex === 'number' ? parsed.handIndex : 0;
            srcCardId = srcPlayerState.hand[idx] ?? srcPlayerState.hand[0];
          }
        } catch {
          // JSON 解析失败:忽略
        }
      }
      if (!srcCardId) return;
      // 验证源牌仍在源玩家场上
      if (!fieldCardIds(ctx.state, srcPlayer).includes(srcCardId)) return;

      // 步骤 5:选目标玩家
      delete ctx.state.localVars[DEST_PLAYER_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: DEST_PLAYER_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '解围:选择目标玩家(将牌移到其场上)',
          min: 1,
          max: 1,
          filter: (_view, t: number) =>
            ctx.state.players[t]?.alive === true && t !== srcPlayer,
        },
        timeout: 15,
      });
      const destPlayer = ctx.state.localVars[DEST_PLAYER_KEY] as number | undefined;
      delete ctx.state.localVars[DEST_PLAYER_KEY];
      if (typeof destPlayer !== 'number') return;

      // 执行移动
      await moveFieldCard(ctx.state, srcPlayer, srcCardId, destPlayer);
    } finally {
      delete ctx.state.localVars[MOVING_FLAG];
    }
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  // 效果①:转化技 — 装备区牌当无懈可击
  api.defineAction('transform', {
    label: '解围',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张装备牌当无懈可击使用',
      cardFilter: { filter: (c: Card) => c.type === '装备牌', min: 1, max: 1 },
    },
    transform: (card: Card) => ({
      name: '无懈可击',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
    activeWhen: (ctx) => {
      const view = ctx.view;
      const pending = view.pending;
      if (!pending) return false;
      // 无懈可击广播窗口:requestType='无懈可击'
      const atom = pending.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应' || atom.requestType !== '无懈可击') return false;
      const p = view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 装备区有装备牌即可发动
      const equipIds = Object.values(p.equipment ?? {});
      return equipIds.some((id) => typeof id === 'string' && !!id);
    },
  });

  // 效果②:被动触发确认
  api.defineAction('respond', {
    label: '解围',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动解围?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
