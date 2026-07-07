// 国色(大乔·主动技/转化):你可以将一张方块牌当【乐不思蜀】使用。
//
// 实现策略(独立 use,镜像断粮——延时锦囊转化技的标准模型):
//   国色与断粮(黑色牌→兵粮寸断)同构,均为"延时锦囊转化技"。采用独立 use action:
//   validate 校验方块牌 + 距离≤1;execute 直接放置 name='乐不思蜀' 的延时锦囊。
//   判定/跳过出牌阶段/无懈可击抵消的效果由现有 乐不思蜀.ts 的 hooks 处理
//   (它们只认 pendingTricks.name === '乐不思蜀',与转化来源无关)。
//
//   为何不镜像奇袭(transform+影子卡+主 action):
//   奇袭的影子卡(`${id}#奇袭`)入弃牌堆时,引擎按 shadowOf 还原并 delete 影子
//   (见 移动牌.apply 的 to.zone==='弃牌堆' 分支)。但延时锦囊会把 trick.card.id
//   持久存入目标 pendingTricks,buildView 以 `pendingTricks.map(t => t.card.id)`
//   投影到 view——若用影子卡 id,影子被 delete 后 view.cardMap 查无此卡,
//   前端无法渲染判定区。故延时锦囊转化必须用独立 use(原卡 id 永驻 cardMap),
//   这正是断粮的模型。奇袭的影子模型只适用于"卡牌被完全消耗"的即时锦囊(过河拆桥)。
//
// 装备区方块牌:描述明确"可以使用装备区的方块牌"。execute 中先「卸下」
//   (装备区→手牌,产生 ViewEvent + 清除武器距离 vars),再走标准打出流程
//   (与奇袭处理装备牌一致)。
//
// 距离规则:与乐不思蜀一致,目标须在距离 1 以内(描述未提及特殊距离放宽)。
//
// 原牌归宿:原方块牌经 处理区→弃牌堆,进入弃牌堆(满足"使用后原牌进入弃牌堆")。
//   乐不思蜀被无懈可击抵消或判定结束后,由 乐不思蜀.ts 的 移除延时锦囊 清 pendingTricks。
//   无次数限制(描述明确)。
import type { Card, EquipSlot, FrontendAPI, GameView, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending } from '../skill';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';

const TRICK_NAME = '乐不思蜀';

/** 国色可用牌:方块(♦)牌(手牌或装备区) */
function isGuoseCard(card: Card | undefined): boolean {
  return !!card && card.suit === '♦';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '国色',
    description: '你可以将一张方块牌当【乐不思蜀】使用',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>): string | null => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      if (typeof params.cardId !== 'string') return '需要选择一张牌';

      const cardId = params.cardId;
      // 方块牌可在手牌或装备区(描述:有方块牌——手牌或装备区的牌)
      const cardInHand = self.hand.includes(cardId);
      const cardInEquip = Object.values(self.equipment).some((id) => id === cardId);
      if (!cardInHand && !cardInEquip) return '牌不在手牌或装备区';
      if (!isGuoseCard(state.cardMap[cardId])) return '需要一张方块牌';

      // 目标:兼容 target(number) 与 targets(number[]) 两种提交形式(与乐不思蜀一致)
      const target =
        (params.target as number | undefined) ??
        (params.targets as number[] | undefined)?.[0];
      if (typeof target !== 'number') return '需要选择目标';
      if (target === ownerId) return '不能对自己使用';
      const targetPlayer = state.players[target];
      if (!targetPlayer?.alive) return '目标不存在或已死亡';

      // 距离:与乐不思蜀一致,目标须在距离 1 以内
      const inRange = effectiveDistance(state, ownerId, target) <= 1;

      const ok = myTurn && inActPhase && free && inRange;
      return ok ? null : '国色使用条件不满足';
    },
    async (state: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target =
        (params.target as number | undefined) ??
        (params.targets as number[] | undefined)?.[0];
      await pushFrame(state, '国色', from, { ...params });

      // 装备区的方块牌:先卸下到手牌(产生 ViewEvent,清除武器距离 vars),
      // 再走标准打出流程(手牌→处理区)。描述明确允许装备区方块牌。
      const equipSlotEntry = Object.entries(state.players[from].equipment).find(
        ([, id]) => id === cardId,
      );
      if (equipSlotEntry) {
        await applyAtom(state, {
          type: '卸下',
          player: from,
          slot: equipSlotEntry[0] as EquipSlot,
        });
      }

      // 卡牌进处理区(打出)
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // 放置延时锦囊:复用现有 乐不思蜀 的判定/跳过出牌 hooks(只认 trick.name)
      const trickCard: Card = state.cardMap[cardId] ?? {
        id: cardId,
        name: TRICK_NAME,
        suit: '♦',
        color: '红',
        rank: 'A',
        type: '锦囊牌',
      };
      await applyAtom(state, {
        type: '添加延时锦囊',
        player: target as number,
        trick: { name: TRICK_NAME, source: from, card: trickCard },
      });

      // 使用卡进弃牌堆
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });

      await popFrame(state);
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '国色',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '国色:将一张方块牌当乐不思蜀使用',
      cardFilter: { filter: (c: Card) => isGuoseCard(c), min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        // 距离≤1 检查:filter 仅为前端 UI 提示,后端 validate 独立校验
        filter: (view: GameView, t: number) => {
          const me = view.currentPlayerIndex;
          if (t === me) return false;
          const tp = view.players[t];
          if (!tp) return false;
          if (tp.alive === false) return false;
          return viewEffectiveDistance(view.players, me, t) <= 1;
        },
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 手牌或装备区有方块牌即可发动
      const hasDiamondInHand = p.hand?.some((c) => isGuoseCard(c)) ?? false;
      if (hasDiamondInHand) return true;
      const equipIds = Object.values(p.equipment ?? {});
      const hasDiamondEquip = equipIds.some((id) => {
        const card = id ? ctx.view.cardMap[id] : undefined;
        return isGuoseCard(card);
      });
      return hasDiamondEquip;
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../skill').SkillModule;
