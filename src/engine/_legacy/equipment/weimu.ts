// @ts-nocheck
// engine/skills/weimu.ts — 帷幕（贾诩）v3 registerAtomHook 演示
//
// 锁定技：你不能成为黑色锦囊牌的目标。
//
// v3 路径：监听 `becomeTarget` 原子。目标 = 贾诩 + 牌是黑色锦囊（♠/♣）
// → 取消该 atom。

import type { HookRegistry } from '../skill-hook';
import type { Atom, SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '帷幕',
    name: '帷幕',
    description: '锁定技，你不能成为黑色锦囊牌的目标。',
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: '成为目标',
        filter: (state, atom) => {
          const a = atom as Atom & { type: '成为目标' };
          const target = a.target as string;
          const char = state.players[target]?.info.characterId;
          if (char !== '贾诩') return false;
          const card = state.cardMap[a.cardId as string];
          if (card?.type !== '锦囊牌') return false;
          return card.suit === '♠' || card.suit === '♣';
        },
        onBefore: () => ({ cancel: true }),
      });
    },
  },
];
