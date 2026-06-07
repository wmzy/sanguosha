// engine/skills/renwang.ts — 仁王盾（防具）v3 registerAtomHook 实现
//
// 防具技（占位实现）：装备仁王盾的角色受到黑色【杀】造成的伤害时，防止此伤害。
//
// v3 路径：监听 `damage` 原子。target = 装备 .防具 === '仁王盾' +
// damage.cardId 指向一张黑色【杀】（♠/♣） → 取消该 atom（不 apply、不写 serverLog）。
//
// 注：本 Task 仅实现 v3 钩子骨架，装备注册（cardId 映射、装备区放置）由 P1-D 处理。
// 旧 stub handler 空壳保留在 engine/skills/equipment.ts（trigger 改为 v3HookOnly 占位）。
//
// 完整判定（黑杀识别）走 useCard 三原子钩子（specifyTarget/becomeTarget
// /resolveCard）实现，留 P2。当前占位：直接监听 damage，识别 cardId 对应卡牌为黑杀。
//
// 真实游戏逻辑：仁王盾在 useCard 阶段拦截黑杀，根本不会进 damage。
// 现阶段：v3 钩子在 damage onBefore 兜底 cancel。
// 一旦 useCard 钩子完整判定走通，可去掉此兜底——届时此文件退化为空或删除。
//
// TODO(P1-D): migrate to armorEffect — 当前 armorId 字面量 '仁王盾'
// 应当由 cardId '仁王盾' 经 P1-D 装备 barrel 解析得到，不再是裸字符串。
// TODO(P2): replace with useCard hook listening on becomeTarget / resolveCard.

import type { HookRegistry } from '../skill-hook';
import { getPlayer } from '../state';
import type { Atom, GameState, SkillDef } from '../types';

const RENWANG_ID = '仁王盾';

export const skills: SkillDef[] = [
  {
    id: RENWANG_ID,
    name: RENWANG_ID,
    description:
      '防具技：装备仁王盾的角色受到黑色【杀】造成的伤害时，防止此伤害。',
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
          const card = state.cardMap[cardId];
          if (card?.name !== '杀') return false;
          const isBlack = card.suit === '♠' || card.suit === '♣';
          if (!isBlack) return false;
          const target = atom.target as string;
          const p = getPlayer(state, target);
          if (!p) return false;
          return p.equipment.防具 === RENWANG_ID;
        },
        onBefore() {
          // 仁王盾：黑色【杀】对该角色无效 → 取消该 damage
          return { cancel: true };
        },
      });
    },
  },
];
