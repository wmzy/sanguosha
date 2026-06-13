// src/engine/skills/武圣.ts
// 武圣(关羽·转化技):你可以将一张红色牌当【杀】使用或打出
import type { AtomAfterContext, FrontendAPI, Skill } from '../types';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '武圣',
    description: '你可以将一张红色牌当【杀】使用或打出',
  };
}

/** 包装:把原始牌属性存到 _wrapper,改为杀 */
function wrapAsKill(state: { cardMap: Record<string, { name: string; suit: string; _wrapper?: { origName: string; origSuit: string; fromSkill: string } }> }, cardId: string): void {
  const card = state.cardMap[cardId];
  if (!card || card._wrapper) return; // 已包装或不存在
  card._wrapper = { origName: card.name, origSuit: card.suit, fromSkill: '武圣' };
  card.name = '杀';
}

/** 还原:把 _wrapper 中的原始属性恢复 */
function unwrap(state: { cardMap: Record<string, { name: string; suit: string; _wrapper?: { origName: string; origSuit: string; fromSkill: string } }> }, cardId: string): void {
  const card = state.cardMap[cardId];
  if (!card?._wrapper || card._wrapper.fromSkill !== '武圣') return;
  card.name = card._wrapper.origName;
  card.suit = card._wrapper.origSuit;
  delete card._wrapper;
}

export function onInit(skill: Skill, ownerId: string): () => void {
  // 杀的 action 路由自动处理 fromSkill='武圣' 的牌包装(后端校验)
  // 武圣自身不注册 action,只注册 after 钩子:牌离开处理区时还原
  registerAfterHook(skill.id, ownerId, '移动牌', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { from?: { zone?: string }; to?: { zone?: string }; cardId?: string };
    if (atom.from?.zone === '处理区' && atom.cardId) {
      unwrap(ctx.state, atom.cardId);
    }
  });
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('transform', {
    label: '武圣',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张红色牌当杀使用',
      cardFilter: { filter: (c) => c.suit === '♥' || c.suit === '♦', min: 1, max: 1 },
    },
  });
  return () => {};
}

export function isRedSuit(suit: string): boolean {
  return suit === '♥' || suit === '♦';
}

export default { createSkill, onInit, onMount };
