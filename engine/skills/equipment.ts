import type { SkillDef } from '../types';
import { registerSkill } from '../skill';

registerSkill({
  id: 'unlimitedKills',
  name: '诸葛连弩',
  description: '武器技：你使用【杀】无次数限制。',
  trigger: {
    event: 'killHit',
    source: 'equipment',
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: 'ignoreArmor',
  name: '青釭剑',
  description: '武器技：你使用【杀】时无视目标防具。',
  trigger: {
    event: 'killHit',
    source: 'equipment',
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: 'chaseDodge',
  name: '青龙偃月刀',
  description: '武器技：当你使用的【杀】被【闪】抵消时，你可以对目标再使用一张【杀】。',
  trigger: {
    event: 'killDodged',
    source: 'equipment',
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '青龙偃月刀：是否对目标再使用一张【杀】？',
        options: [
          { label: '不使用', value: false },
          { type: 'selectCard', from: 'hand', min: 1, max: 1 },
        ],
        defaultChoice: false,
      },
      // TODO: 若选择手牌，再对目标使用一张杀
    ];
  },
});

registerSkill({
  id: 'forceHit',
  name: '贯石斧',
  description: '武器技：当你使用的【杀】被【闪】抵消时，你可以弃置两张牌，令此【杀】强制命中。',
  trigger: {
    event: 'killDodged',
    source: 'equipment',
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '贯石斧：是否弃置两张牌强制命中？',
        options: [
          { label: '不弃置', value: false },
          { type: 'selectCards', from: 'hand', min: 2, max: 2 },
        ],
        defaultChoice: false,
      },
      // TODO: 若选择弃牌，强制命中
    ];
  },
});

registerSkill({
  id: 'dualWeapon',
  name: '雌雄双股剑',
  description: '武器技：当你使用【杀】指定异性角色为目标后，你与其各弃置一张手牌。',
  trigger: {
    event: 'killHit',
    source: 'equipment',
  },
  handler(_ctx, _state) {
    // TODO: 检查目标性别是否不同，若不同则双方各弃置一张手牌
    return [];
  },
});

registerSkill({
  id: 'judgeDodge',
  name: '八卦阵',
  description: '防具技：当你需要使用或打出【闪】时，你可以进行判定：若结果为红色，视为你使用或打出了一张【闪】。',
  trigger: {
    event: 'killResponse',
    source: 'equipment',
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'judge', player: _ctx.self }] },
      // TODO: 检查判定结果颜色，若红色则视为出闪
    ];
  },
});

registerSkill({
  id: 'blockBlackKill',
  name: '仁王盾',
  description: '防具技：黑色【杀】对你无效。',
  trigger: {
    event: 'killResponse',
    source: 'equipment',
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: 'multiTarget',
  name: '方天画戟',
  description: '武器技：若你的手牌数为0，你使用【杀】可以指定最多三名角色为目标。',
  trigger: {
    event: 'killHit',
    source: 'equipment',
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: 'twoCardsAsKill',
  name: '丈八蛇矛',
  description: '武器技：你可以将两张手牌当一张【杀】使用。',
  trigger: {
    event: 'killResponse',
    source: 'equipment',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
} satisfies SkillDef);
