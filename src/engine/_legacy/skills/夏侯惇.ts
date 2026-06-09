// engine/skills/夏侯惇.ts — 夏侯惇
import type { SkillDef } from '../types';
import type { HookRegistry } from '../skill-hook';

export const skills: SkillDef[] = [
  {
    id: '刚烈',
    name: '刚烈',
    description: '当你受到伤害后，你可以进行判定：若结果不为♥，伤害来源弃置两张手牌或受到1点伤害。',
    // v3 registerAtomHook 实现：监听 `造成伤害` atom onAfter，
    // filter 收窄到「target 有刚烈技能」+「有 source」，
    // onAfter 注入「判定 + 条件 + 1点伤害（不♥）」原子链。
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: '造成伤害',
        filter: (state, atom) => {
          if (atom.type !== '造成伤害') return false;
          const target = atom.target as string;
          if (state.players[target]?.skills?.includes('刚烈') !== true) return false;
          const source = atom.source as string | undefined;
          return !!source && source !== target;
        },
        onAfter: ({ atom }) => {
          const target = atom.target as string;
          const source = atom.source as string;
          return {
            additionalAtoms: [
              { type: '判定', player: target },
              // 真 game rule：判定结果不♥则来源受到1点伤害。
              // v3 没有条件原子能跨 atom 读 localVars；此处简化为
              // 「必定追加 1 点伤害」，原 v2 handler 内的 condition
              // 读 localVars.judgeSuit 逻辑留 follow-up 实现。
              { type: '造成伤害', target: source, amount: 1 },
            ],
          };
        },
      });
    },
  },
];
