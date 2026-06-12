// @ts-nocheck
// engine/skills/断肠.ts — 断肠
import type { SkillDef, SkillPhase } from '../types';
import { getPlayer } from '../state';

export const def: SkillDef = 
  {
    id: '断肠',
    name: '断肠',
    description: '锁定技，杀死你的角色立即失去所有技能直到游戏结束。',
    handler(_ctx, _state) {
      return [];
    },
  },
