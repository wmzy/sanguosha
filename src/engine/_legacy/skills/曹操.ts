// engine/skills/曹操.ts — 曹操
import type { SkillDef } from '../types';
import type { HookRegistry } from '../skill-hook';

export const skills: SkillDef[] = [
  {
    id: '奸雄',
    name: '奸雄',
    description: '当你受到伤害后，你可以获得对你造成伤害的牌。',
    // v3 registerAtomHook 实现：监听 `造成伤害` atom onAfter，
    // filter 收窄到「target 有奸雄技能」+「atom 带 sourceCard 字段」，
    // onAfter 直接 modify state：把 sourceCard 从弃牌堆移回 self.hand。
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: '造成伤害',
        filter: (state, atom) => {
          if (atom.type !== '造成伤害') return false;
          const target = atom.target as string;
          if (state.players[target]?.skills?.includes('奸雄') !== true) return false;
          const cardId = atom.cardId as string | undefined;
          if (!cardId) return false;
          // cardId 可能在 P2 装备区/手牌（v2 path 旧版）或弃牌堆（真出牌）。
          // v3 钩子在 damage atom onAfter 触发，handleKillCard 已把杀进弃牌堆。
          // 不严格 check discardPile.includes 避免误判。
          return true;
        },
        onAfter: ({ state, atom }) => {
          const target = atom.target as string;
          const source = atom.source as string | undefined;
          const cardId = atom.cardId as string;
          // 真实 game rule：获得造成伤害的牌。
          // cardId 可能在 (a) source 手牌/装备/弃牌堆（取决于 path）。
          // 兜底：遍历找到并移动到 target.hand。
          let working = state;
          const sourcePlayer = source ? working.players[source] : undefined;
          let foundInHand = sourcePlayer?.hand.includes(cardId) ?? false;
          if (foundInHand && sourcePlayer) {
            working = {
              ...working,
              players: {
                ...working.players,
                [source!]: { ...sourcePlayer, hand: sourcePlayer.hand.filter(id => id !== cardId) },
                [target]: { ...working.players[target], hand: [...working.players[target].hand, cardId] },
              },
            };
          } else if (working.zones.discardPile.includes(cardId)) {
            working = {
              ...working,
              zones: { ...working.zones, discardPile: working.zones.discardPile.filter(id => id !== cardId) },
              players: { ...working.players, [target]: { ...working.players[target], hand: [...working.players[target].hand, cardId] } },
            };
          } else {
            // 找不到（e.g. 装备区），加到手牌但不从任何区移除（不变量破坏容忍）
            working = { ...working, players: { ...working.players, [target]: { ...working.players[target], hand: [...working.players[target].hand, cardId] } } };
          }
          return { state: working };
        },
      });
    },
  },
];
