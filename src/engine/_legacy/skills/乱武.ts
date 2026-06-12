// @ts-nocheck
// engine/skills/乱武.ts — 乱武
import type { SkillDef } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';

export const def: SkillDef = 
  {
    id: '乱武',
    name: '乱武',
    description: '限定技，出牌阶段，你可以令所有其他角色依次对与其距离最近的另一名角色使用一张【杀】，无法如此做者失去1点体力。',
    handler(_ctx, _state) {
      return [];
    },
  },
