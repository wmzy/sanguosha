// @ts-nocheck
// engine/skills/荀彧.ts — 荀彧
import type { SkillDef } from '../types';
import type { HookRegistry } from '../skill-hook';

export const skills: SkillDef[] = [
  {
    id: '驱虎',
    name: '驱虎',
    description: '出牌阶段，你可以与一名角色拼点，若你赢，该角色对其攻击范围内另一名角色造成1点伤害；若你没赢，该角色对你造成1点伤害。',
    // [v2-only] C 类：含 prompt/pindian，需 v3 pendingAction 能力。
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      optional: true,
      manual: true,
    },
    handler(_ctx, _state) {
      return [
        {
          type: 'prompt',
          text: '驱虎：选择拼点目标',
          options: [
            { label: '不发动', value: false },
            { type: 'selectPlayer', filter: { handEmpty: _ctx.self } },
          ],
          defaultChoice: false,
        },
      ];
    },
  },

  {
    id: '节命',
    name: '节命',
    description: '当你受到1点伤害后，你可以令一名角色将手牌摸至X张（X为其体力上限且最多为5）。',
    // v3 registerAtomHook 实现：监听 `造成伤害` atom onAfter，
    // filter 收窄到「自己是有节命技能的角色」+「受到伤害」，
    // onAfter 注入「补手牌至 maxHealth（最多 5 张）」atom。
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: '造成伤害',
        filter: (state, atom) => {
          if (atom.type !== '造成伤害') return false;
          const target = atom.target as string;
          return state.players[target]?.skills?.includes('节命') ?? false;
        },
        onAfter: ({ state, atom }) => {
          const target = atom.target as string;
          const self = state.players[target];
          if (!self) return {};
          const target2 = Math.min(self.maxHealth, 5);
          const drawCount = Math.max(0, target2 - self.hand.length);
          if (drawCount <= 0) return {};
          return {
            additionalAtoms: [{ type: '摸牌', player: target, count: drawCount }],
          };
        },
      });
    },
  },
];