// engine/skills/bagua.ts — 八卦阵（防具）v3 registerAtomHook 实现
//
// 锁定技：装备八卦阵的角色受到【杀】造成的伤害时，若 ctx.localVars.baguaJudgeResult
// 指示为红，则视为已成功打出【闪】（damage cancel）；黑则不视为闪，damage 仍生效。
//
// v3 路径：监听 `damage` 原子。目标 = 装备.防具 === '八卦阵'
// + damage.cardId 指向一张【杀】 → 读 ctx.baguaJudgeResult 决定是否 cancel。
//
// 完整 useCard 阶段 inject 判定 prompt 留 P2 follow-up；本 Task 给定默认 red 占位。
// 一旦 useCard 钩子完整走通（注入 baguaJudgeResult 到 localVars），本实现即可生效。

import type { HookRegistry } from '../skill-hook';
import { getPlayer } from '../state';
import type { Atom, GameState, SkillDef } from '../types';

const BAGUA_ID = '八卦阵';

export const skills: SkillDef[] = [
  {
    id: BAGUA_ID,
    name: BAGUA_ID,
    description:
      '锁定技：装备八卦阵的角色受到【杀】造成的伤害时，若判定为红色，视为已成功打出【闪】（damage cancel）。',
    // v3-only skill：使用占位 trigger event 字符串 'v3HookOnly'。
    // 详见 wansha.ts 头部注释（保持 state.triggers 命中，v2 emitEvent 永不触发）
    trigger: { event: 'v3HookOnly', source: '装备' },
    handler() {
      return [];
    },
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: '造成伤害',
        filter(state: GameState, atom: Atom): boolean {
          if (atom.type !== '造成伤害') return false;
          const cardId = atom.cardId as string | undefined;
          if (!cardId) return false;
          if (state.cardMap[cardId]?.name !== '杀') return false;
          const target = atom.target as string;
          const p = getPlayer(state, target);
          if (!p) return false;
          return p.equipment.防具 === BAGUA_ID;
        },
        onBefore(ctx) {
          // 真 game rule：ctx.localVars.baguaJudgeResult 已被 useCard 阶段 hook 注入
          // 'red'  → cancel (视为闪); 'black' → 不 cancel (需继续出闪); 缺失 → 默认 'red'（占位）
          const judge =
            (ctx.state.localVars as Record<string, unknown> | undefined)?.baguaJudgeResult ?? '红';
          if (judge === '红') return { cancel: true };
          return {};
        },
      });
    },
  },
];
