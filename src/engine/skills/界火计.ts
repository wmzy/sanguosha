// 界火计(界卧龙诸葛·转化技):
//   ① 你可以将一张红色牌(手牌或装备区)当【火攻】使用。
//   ② 你的【火攻】改为令目标展示随机手牌,你弃置与展示牌颜色相同的牌以造成伤害。
//
// OL 官方(hero)逐字:
//   "你可以将一张红色牌当【火攻】使用。你的【火攻】改为令目标展示随机手牌,
//    你弃置与展示牌颜色相同的牌以造成伤害。"
//
// 与标版火计区别:
//   - 牌范围:界版"红色牌"(含装备区),标版限定"红色手牌"。
//   - 火攻结算改变:
//     · 目标"展示随机手牌"(标版为目标自选展示一张手牌)。
//     · 使用者弃"同颜色"牌造伤(标版为"同花色")。
//
// 模型:
//   ① transform action(preceding,界火计.transform):红色牌(手牌或装备)→
//        卸下(若装备)→ 当作 → 影子火攻。同标版火计 transform,但允许装备区。
//   ② use action(覆盖火攻.use,仅本座次):界版火攻结算。覆盖保证:
//        - 界卧龙诸葛以任何来源的【火攻】(界火计转化或实际火攻牌)均走界版结算。
//        - 其他座次的火攻仍走标版(由标版火攻 card skill 注册)。
//   ③ respond action(界火计/弃牌):使用者弃同颜色手牌回应。
//
// 覆盖机制:火攻在 DEFAULT_SKILLS 中,先实例化标版火攻.use;界火计.onInit 后实例化,
//   registerAction('火攻', ownerId, 'use', ...) 覆盖标版注册(state-bound 注册表 Map.set 覆盖)。
//   "你的【火攻】改为..." 为角色锁定属性,凡本座次使用火攻均走界版,符合官方语义。
//
// 界版火攻结算流程:
//   1. 移火攻牌到处理区
//   2. 询问无懈可击(单目标,抵消整个锦囊)
//   3. 未被抵消 → 随机选目标一张手牌 → 展示 atom 全员广播(牌不移动)
//   4. 读展示牌颜色 → 若使用者有同颜色手牌,询问其弃一张同颜色手牌
//      (requestType='界火计/弃牌',路由到本技能 respond)
//   5. 使用者弃了 → 造成 1 点火焰伤害;没弃 → 无事发生
//   6. 火攻牌移出处理区 → 弃牌堆
//
// 关键:界版的"随机展示"由本技能直接选牌 + 展示 atom 广播,不经 请求回应(目标无选择权)。
// "同颜色"判定用 card.color(红/黑);标版用 card.suit(花色)。
import type { Card, EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, hasBlockingPending } from '../skill';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { 询问无懈可击 } from '../无懈可击';
import { defaultPlayActive } from '../action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界火计',
    description:
      '你可以将一张红色牌当【火攻】使用;你的【火攻】改为目标展示随机手牌,你弃同颜色牌造伤',
  };
}

/** 影子卡 id:${原id}#界火计 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#界火计`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── transform action:红色牌(手牌或装备)→ 影子火攻 ──────────────
  // 作为 preceding 在 火攻.use(本座次被覆盖为界版)之前执行。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending + 存活 + 红牌(手牌或装备)
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const cardInEquip =
        cardIdOk && Object.values(self.equipment).some((id) => id === cardId);
      const isRed = !!card && card.color === '红';
      const ok =
        myTurn && inActPhase && free && selfAlive && (cardInHand || cardInEquip) && isRed;
      return ok ? null : '现在不能使用界火计';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      const self = state.players[ownerId];
      // 装备区红色牌:先卸下到手牌(产生 ViewEvent,清除装备 vars),再走当作。
      // 镜像界武圣.ts / 奇袭.ts 的装备转化模式。
      const equipSlotEntry = Object.entries(self.equipment).find(([, id]) => id === cardId);
      if (equipSlotEntry) {
        const slot = equipSlotEntry[0] as EquipSlot;
        params['_origSlot'] = slot;
        await applyAtom(state, { type: '卸下', player: ownerId, slot });
      }
      // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '火攻',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      const self = state.players[ownerId];
      const origSlot = params['_origSlot'] as EquipSlot | undefined;
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

  // ─── use action:覆盖标版火攻.use,本座次走界版结算 ─────────────────
  // 火攻在 DEFAULT_SKILLS 中先实例化标版火攻.use;此处 registerAction 覆盖之(同 key 覆盖)。
  // 仅影响本座次(界卧龙诸葛),其他座次的火攻仍走标版。
  registerAction(
    state,
    '火攻',
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      // 校验同标版火攻.use:火攻 + 单目标 + 非自己 + 目标有手牌
      if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (state.phase !== '出牌') return '不是出牌阶段';
      if (hasBlockingPending(state)) return '当前有等待响应';
      const self = state.players[ownerId];
      if (!self.alive) return '你已死亡';
      const cardId = params.cardId as string;
      if (!cardId) return 'cardId required';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      if (state.cardMap[cardId]?.name !== '火攻') return '不是火攻';
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length !== 1) return '火攻只能指定一名目标';
      const target = targets[0];
      if (target === ownerId) return '不能对自己使用火攻';
      const targetPlayer = state.players[target];
      if (!targetPlayer?.alive) return '目标不合法';
      if (targetPlayer.hand.length === 0) return '目标必须有手牌';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = (params.targets as number[])[0];
      await pushFrame(state, '界火计', from, { ...params });

      // 火攻锦囊进处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      try {
        // 询问无懈可击(单目标锦囊:抵消整个锦囊)
        const cancelled = await 询问无懈可击(state, target);
        if (!cancelled) {
          const targetPlayer = state.players[target];
          // 目标必须有手牌(随机展示需要)
          if (targetPlayer && targetPlayer.hand.length > 0) {
            // 清理上轮残留
            delete state.localVars['界火计/展示'];
            delete state.localVars['界火计/展示颜色'];
            delete state.localVars['界火计/弃牌'];

            // ── 1) 随机展示目标一张手牌(界版:目标无选择权) ──
            const handLen = targetPlayer.hand.length;
            const randomIdx = Math.floor(Math.random() * handLen);
            const revealedCardId = targetPlayer.hand[randomIdx];
            const revealedCard = state.cardMap[revealedCardId];
            const revealedColor = revealedCard?.color ?? '无色';
            state.localVars['界火计/展示'] = {
              cardId: revealedCardId,
              color: revealedColor,
            };
            state.localVars['界火计/展示颜色'] = revealedColor;
            // 展示 atom:全员广播揭示(牌仍在目标手牌中,不移动)
            await applyAtom(state, {
              type: '展示',
              player: target,
              cardId: revealedCardId,
            });

            // ── 2) 请求使用者弃一张同颜色手牌(界版:同颜色,非同花色) ──
            const fromPlayer = state.players[from];
            if (fromPlayer?.alive) {
              const hasMatch = fromPlayer.hand.some(
                (id) => state.cardMap[id]?.color === revealedColor,
              );
              if (hasMatch) {
                delete state.localVars['界火计/弃牌'];
                await applyAtom(state, {
                  type: '请求回应',
                  requestType: '界火计/弃牌',
                  target: from,
                  prompt: {
                    type: 'useCard',
                    title: `界火计:弃置一张 ${revealedColor} 手牌对其造成1点火焰伤害(不弃则无效)`,
                    cardFilter: {
                      filter: (c) => c.color === revealedColor,
                      min: 1,
                      max: 1,
                    },
                  },
                  timeout: 15,
                });

                const discardId = state.localVars['界火计/弃牌'] as string | undefined;
                // 使用者弃了 → 造成 1 点火焰伤害;没弃(超时)→ 无事发生
                if (discardId && state.players[target]?.alive) {
                  await applyAtom(state, { type: '弃置', player: from, cardIds: [discardId] });
                  await applyAtom(state, {
                    type: '造成伤害',
                    target,
                    amount: 1,
                    source: from,
                    cardId,
                    damageType: '火焰',
                  });
                }
              }
            }
          }
        }
        // 火攻锦囊移出处理区 → 弃牌堆
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        if (frameCards(state).includes(cardId)) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
        await popFrame(state);
      }
    },
  );

  // ─── respond action:使用者弃同颜色手牌(界火计/弃牌) ──────────────
  // requestType='界火计/弃牌' 路由到本技能(skillId='界火计')。
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是界火计窗口';
      const reqType = (slot.atom as { requestType?: string }).requestType;
      if (reqType !== '界火计/弃牌') return '当前不是界火计窗口';
      const cardId = params.cardId as string;
      if (typeof cardId !== 'string') return 'cardId required';
      const self = state.players[ownerId];
      if (!self?.alive) return '你已死亡';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      // 界版:同颜色(红/黑),非同花色
      const revealedColor = state.localVars['界火计/展示颜色'] as string | undefined;
      const card = state.cardMap[cardId];
      if (!revealedColor || card?.color !== revealedColor)
        return '必须弃置与展示牌相同颜色的手牌';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      state.localVars['界火计/弃牌'] = cardId;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:界火计是转化技,defineAction 声明红牌(手牌+装备) + 目标(有手牌的其他角色)。
  // 前端 UI 流程:选红牌 → 选目标 → 提交 preceding=[界火计.transform] + 主 action=火攻.use。
  // (主 action skillId 由 transform.name='火攻' 决定,后端火攻.use 已被本座次界版覆盖。)
  api.defineAction('transform', {
    label: '界火计',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色牌(手牌或装备)当火攻使用',
      cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 目标须有手牌(前端 UI 提示用,后端 validate 独立校验)
        filter: (view, t) => {
          if (t === view.currentPlayerIndex) return false;
          return (view.players[t]?.handCount ?? 0) > 0;
        },
      },
    },
    transform: (card: Card) => ({ name: '火攻', sourceCardId: card.id, fromSkill: skill.id }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 界版:红色牌包括手牌和装备区
      const hasRedInHand = p.hand?.some((c) => c.color === '红') ?? false;
      const hasRedEquip = Object.values(p.equipment ?? {}).some((id) => {
        const card = id ? ctx.view.cardMap[id] : undefined;
        return card?.color === '红';
      });
      return hasRedInHand || hasRedEquip;
    },
  });

  // respond action:界火计弃牌回应(requestType='界火计/弃牌' 路由用)
  // cardFilter 放宽为任意手牌(同颜色校验由后端 validate 兜底,与标版火攻 respond 同模式)。
  api.defineAction('respond', {
    label: '界火计',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '界火计:弃置一张与展示牌同颜色的手牌',
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
  });

  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
