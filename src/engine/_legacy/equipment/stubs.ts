// @ts-nocheck
import type { Atom, SkillDef } from '../types';


export const skills: SkillDef[] = [
  {
   id: '诸葛连弩',
   name: '诸葛连弩',
   description: '武器技：你使用【杀】无次数限制。',
   trigger: {
     event: '杀命中',
     source: '装备',
   },
   handler(_ctx, _state) {
     return [];
   },
  },
  {
   id: '青釭剑',
   name: '青釭剑',
   description: '武器技：你使用【杀】时无视目标防具。',
   trigger: { event: 'v3HookOnly', source: '装备' }, // v3 实现走 qinggang.ts
   handler(_ctx, _state) {
     return []; // v3 占位
   },
  },
  {
   id: '青龙偃月刀',
   name: '青龙偃月刀',
   description: '武器技：当你使用的【杀】被【闪】抵消时，你可以对目标再使用一张【杀】。',
   trigger: {
     event: '杀被闪避',
     source: '装备',
     optional: true,
   },
   handler(_ctx, _state) {
     return [
       {
         type: 'prompt',
         text: '青龙偃月刀：是否对目标再使用一张【杀】？',
         options: [
           { label: '不使用', value: false },
           { type: '选择牌', from: '手牌', min: 1, max: 1 },
         ],
         defaultChoice: false,
       },
       {
         type: 'condition',
         check: { notEquals: [{ $: 'ctx', path: 'choice' }, false] },
         then: [
           {
             type: 'atoms',
             ops: [
               { type: '弃置', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice' } },
               { type: '造成伤害', target: _ctx.target!, amount: 1, source: _ctx.self },
             ],
           },
           { type: 'checkDying', player: _ctx.target! },
         ],
       },
     ];
   },
  },
  {
   id: '贯石斧',
   name: '贯石斧',
   description: '武器技：当你使用的【杀】被【闪】抵消时，你可以弃置两张牌，令此【杀】强制命中。',
   trigger: {
     event: '杀被闪避',
     source: '装备',
     optional: true,
   },
   handler(_ctx, _state) {
     return [
       {
         type: 'prompt',
         text: '贯石斧：是否弃置两张牌强制命中？',
         options: [
           { label: '不弃置', value: false },
           { type: 'selectCards', from: '手牌', min: 2, max: 2 },
         ],
         defaultChoice: false,
       },
       {
         type: 'condition',
         check: { notEquals: [{ $: 'ctx', path: 'choice' }, false] },
         then: [
           {
             type: 'atoms',
             ops: [
               { type: '弃置', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice' } },
               { type: '造成伤害', target: _ctx.target!, amount: 1, source: _ctx.self },
             ],
           },
           { type: 'checkDying', player: _ctx.target! },
         ],
       },
     ];
   },
  },
  {
   id: '雌雄双股剑',
   name: '雌雄双股剑',
   description: '武器技：当你使用【杀】指定异性角色为目标后，你与其各弃置一张手牌。',
   trigger: {
     event: '杀命中',
     source: '装备',
   },
   handler(_ctx, _state) {
     if (!_ctx.target) return [];
     const selfGender = _state.players[_ctx.self]?.info.gender;
     const targetGender = _state.players[_ctx.target]?.info.gender;
     if (!selfGender || !targetGender || selfGender === targetGender) return [];
     const targetHand = _state.players[_ctx.target].hand;
     const selfHand = _state.players[_ctx.self].hand;
     if (targetHand.length === 0 && selfHand.length === 0) return [];
     const ops: Atom[] = [];
     if (selfHand.length > 0) {
       ops.push({ type: '随机弃置', player: _ctx.self, count: 1, from: '手牌' });
     }
     if (targetHand.length > 0) {
       ops.push({ type: '随机弃置', player: _ctx.target, count: 1, from: '手牌' });
     }
     return [
       { type: 'atoms', ops },
     ];
   },
  },
  {
   id: '八卦阵',
   name: '八卦阵',
   description: '防具技：当你需要使用或打出【闪】时，你可以进行判定：若结果为红色，视为你使用或打出了一张【闪】。',
   trigger: { event: 'v3HookOnly', source: '装备' }, // v3 实现走 bagua.ts
   handler(_ctx, _state) {
     return []; // v3 占位
   },
  },
  {
   id: '仁王盾',
   name: '仁王盾',
   description: '防具技：黑色【杀】对你无效。',
   trigger: { event: 'v3HookOnly', source: '装备' }, // v3 实现走 renwang.ts
   handler(_ctx, _state) {
     return []; // v3 占位
   },
  },
  {
   id: '方天画戟',
   name: '方天画戟',
   description: '武器技：若你的手牌数为0，你使用【杀】可以指定最多三名角色为目标。',
   trigger: { event: 'v3HookOnly', source: '装备' }, // v3 实现走 fangtian.ts
   handler(_ctx, _state) {
     return []; // v3 占位
   },
  },
  {
   id: '丈八蛇矛',
   name: '丈八蛇矛',
   description: '武器技：你可以将两张手牌当一张【杀】使用。',
   trigger: { event: 'v3HookOnly', source: '装备' }, // v3 实现走 zhangba.ts
   handler(_ctx, _state) {
     return []; // v3 占位
   },
  },
];
