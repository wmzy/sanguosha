// engine/skills/_fireKillDamageBonus.ts — 火杀 +1 伤害 v3 useCard 钩子
//
// 真 game rule：使用火【杀】（card.name='杀' + card.subtype ∈ {'火杀', 'fire'}）造成 2 点伤害，
// 普通【杀】1 点。
//
// v3 路径：监听 useCard 原子（[T-13] useCard 拆分后由 specifyTarget/becomeTarget/
// resolveCard 取代；hook 仍按 useCard 字面量注册，模式同 P2-T3 leiji.ts）。
// filter：card.name='杀' && card.subtype ∈ {'火杀', 'fire'}
// onAfter：emit 1 个 amount=2 damageType='fire' damage atom
//
// 当前 `useCard` atom 不在 Atom 联合里（被 [T-13] 决策下的 3 原子取代），
// hook 注册仍按 `useCard` 字面量走——等 useCard atom 上线后此钩子自动接入。
// 用本文件局部 type guard 把 `atom: Atom` 在 hook 闭包内收窄到 UseCardAtom。

import { registerAtomHook } from '../atom';
import type { Atom, GameState } from '../types';

interface UseCardAtom {
  type: 'useCard';
  source?: unknown;
  target?: unknown;
  cardId?: unknown;
}

function asUseCard(atom: Atom): UseCardAtom | null {
  const candidate = atom as unknown;
  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    (candidate as { type?: unknown }).type === 'useCard'
  ) {
    return candidate as UseCardAtom;
  }
  return null;
}

/** 卡牌 subtype 是否标记为"火杀"（中文 game term / 英文 future CardDef 命名都支持）。 */
function isFireKillSubtype(subtype: string): boolean {
  return subtype === '火杀' || subtype === 'fire';
}

export function register(): void {
  registerAtomHook({
    atomType: 'useCard',
    filter(state: GameState, atom: Atom): boolean {
      const useCard = asUseCard(atom);
      if (!useCard) return false;
      const cardId = typeof useCard.cardId === 'string' ? useCard.cardId : undefined;
      if (!cardId) return false;
      const card = state.cardMap[cardId];
      if (!card || card.name !== '杀') return false;
      return isFireKillSubtype(card.subtype);
    },
    onAfter({ atom, state }) {
      const useCard = asUseCard(atom);
      if (!useCard) return {};
      const target = typeof useCard.target === 'string' ? useCard.target : undefined;
      if (!target) return {};
      const source = typeof useCard.source === 'string' ? useCard.source : undefined;
      const cardId = typeof useCard.cardId === 'string' ? useCard.cardId : undefined;
      if (!source || !cardId) return {};
      // 校验 cardMap 仍能解析（防御性；filter 已判过）
      const card = state.cardMap[cardId];
      if (!card || !isFireKillSubtype(card.subtype)) return {};
      return {
        additionalAtoms: [
          {
            type: 'damage' as const,
            target,
            amount: 2,
            source,
            cardId,
            damageType: 'fire' as const,
          },
        ],
      };
    },
  });
}
