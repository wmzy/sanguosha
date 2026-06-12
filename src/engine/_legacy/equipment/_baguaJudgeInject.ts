// @ts-nocheck
// engine/skills/_baguaJudgeInject.ts — 八卦阵 useCard 阶段判定注入钩子
//
// 真 game rule：装备八卦阵的角色被【杀】指定为目标的瞬间，触发判定；
// 红桃/方块（红）→ 视为成功打出【闪】（damage cancel）；
// 黑桃/梅花（黑）→ 需继续出闪（damage 不 cancel）。
//
// v3 路径：监听 becomeTarget 原子。
// filter：card.name === '杀' && target.equipment.armor === 'bagua'
// onAfter：读 deck 顶牌花色 → 写入 state.localVars.baguaJudgeResult
//
// 判定牌读取约定：deck 顶 = deck[length-1]（与 engine/atoms/judge.ts 一致）。
//
// 状态写入方式：onAfter 返回 { state }，直接写 state.localVars。
// 备选 additionalAtoms: setCtxVar 路径在本架构下无效——setCtxVar.apply 是 no-op，
// 不持久化到 state.localVars（仅在 SkillPhase 的 'atoms' 阶段处理器里写
// ctx.localVars，不写 state）。bagua.ts 读 ctx.state.localVars，所以必须
// 直接 return modified state。

import type { HookRegistry } from '../skill-hook';
import { getPlayer } from '../state';
import type { Atom, GameState, Json } from '../types';

const BAGUA_ID = '八卦阵';
const JUDGE_KEY = 'baguaJudgeResult';
const RED_SUITS: Record<string, true> = { '♥': true, '♦': true };

interface BecomeTargetLike {
  type: 'becomeTarget';
  cardId?: unknown;
  source?: unknown;
  target?: unknown;
}

function asBecomeTarget(atom: Atom): BecomeTargetLike | null {
  if (atom === null || typeof atom !== 'object') return null;
  if ((atom as { type?: unknown }).type !== '成为目标') return null;
  return atom as unknown as BecomeTargetLike;
}

function readTopDeckCard(state: GameState): { suit: string } | null {
  const deck = state.zones.deck;
  if (deck.length === 0) return null;
  const topCardId = deck[deck.length - 1];
  const topCard = state.cardMap[topCardId];
  if (!topCard) return null;
  return { suit: topCard.suit };
}

export function register(registry: HookRegistry): void {
  registry.register({
    atomType: '成为目标',
    filter(state: GameState, atom: Atom): boolean {
      const becomeTarget = asBecomeTarget(atom);
      if (!becomeTarget) return false;
      const target = typeof becomeTarget.target === 'string' ? becomeTarget.target : undefined;
      if (!target) return false;
      const player = getPlayer(state, target);
      if (!player) return false;
      if (player.equipment.防具 !== BAGUA_ID) return false;
      const cardId = typeof becomeTarget.cardId === 'string' ? becomeTarget.cardId : undefined;
      if (!cardId) return false;
      const card = state.cardMap[cardId];
      if (card?.name !== '杀') return false;
      return true;
    },
    onAfter({ state }) {
      const top = readTopDeckCard(state);
      if (!top) return {};
      const value: Json = RED_SUITS[top.suit] === true ? '红' : '黑';
      return {
        state: {
          ...state,
          localVars: { ...(state.localVars ?? {}), [JUDGE_KEY]: value },
        },
      };
    },
  });
}
