// engine/skills/司马懿.ts — 司马懿
import type { SkillDef } from '../types';
import type { HookRegistry } from '../skill-hook';

export const skills: SkillDef[] = [
  {
    id: '反馈',
    name: '反馈',
    description: '当你受到伤害后，你可以获得伤害来源的一张牌。',
    // v3 registerAtomHook 实现：监听 `造成伤害` atom onAfter，
    // filter 收窄到「自己是有反馈技能的角色」+「受到伤害（target===self）」，
    // onAfter 直接 modify state：从 source.hand 移第一张到 self.hand。
    // 确定性取第一张（原 v2 用随机弃置；v3 modify state 无 RNG 调用，避免重放不一致）。
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: '造成伤害',
        filter: (state, atom) => {
          if (atom.type !== '造成伤害') return false;
          const target = atom.target as string;
          if (state.players[target]?.skills?.includes('反馈') !== true) return false;
          const source = atom.source as string | undefined;
          if (!source || source === target) return false;
          const sourcePlayer = state.players[source];
          if (!sourcePlayer || sourcePlayer.hand.length === 0) return false;
          return true;
        },
        onAfter: ({ state, atom }) => {
          const target = atom.target as string;
          const source = atom.source as string;
          const sourcePlayer = state.players[source];
          if (!sourcePlayer || sourcePlayer.hand.length === 0) return {};
          const cardId = sourcePlayer.hand[0];
          const newSourceHand = sourcePlayer.hand.filter(id => id !== cardId);
          const targetPlayer = state.players[target];
          return {
            state: {
              ...state,
              players: {
                ...state.players,
                [source]: { ...sourcePlayer, hand: newSourceHand },
                [target]: { ...targetPlayer, hand: [...targetPlayer.hand, cardId] },
              },
            },
          };
        },
      });
    },
  },

  {
    id: '鬼才',
    name: '鬼才',
    description: '当一张判定牌生效前，你可以打出一张手牌代替之。',
    trigger: {
      event: '判定结果',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      return [
        {
          type: 'prompt',
          text: '鬼才：是否用手牌替换判定牌？',
          options: [
            { label: '不替换', value: false },
            { type: '选择牌', from: '手牌', min: 1, max: 1 },
          ],
          defaultChoice: false,
        },
        {
          type: 'condition',
          check: { notEquals: [{ $: 'ctx', path: 'choice' }, false] },
          then: [
            // 将原判定牌从弃牌堆移回牌堆
            {
              type: 'atoms',
              ops: [{
                type: '移动牌',
                cardId: _ctx.sourceCard!,
                from: { zone: '弃牌堆' },
                to: { zone: '牌堆' },
              }],
            },
            // 将选择的手牌移到弃牌堆作为新的判定结果
            {
              type: 'atoms',
              ops: [{
                type: '移动牌',
                cardId: { $: 'ctx', path: 'choice' },
                from: { zone: '手牌', player: _ctx.self },
                to: { zone: '弃牌堆' },
              }],
            },
          ],
        },
      ];
    },
  },
];
