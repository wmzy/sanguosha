// src/engine/skills/武圣.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/武将技能/蜀国/关羽.md):
//   武圣(关羽·转化技):
//     - 触发时机:需要使用或打出【杀】时
//     - 发动条件:有红色牌(**手牌或装备区的牌**)
//     - 效果:将一张红色牌当【杀】使用或打出
//     - 限制:无次数限制(但受每回合出杀次数限制)
//     - 备注:
//       - 红色牌包括红桃(♥)和方块(♦)
//       - **可以使用装备区的红色牌**
//       - 使用后原牌进入弃牌堆
//       - 仍受每回合只能使用 1 张【杀】的限制
//
// 关键原子操作:
//   transform 路径(由 杀.ts 的 use/respond action 路由处理 wrapper):
//     杀使用前:wrapAsKill(cardId)——mutate cardMap[cardId].name='杀',保留原 name/suit 到 _wrapper
//   after 钩子(移动牌):
//     当 atom.from.zone==='处理区' 时调用 unwrap → 恢复原 name/suit,删除 _wrapper
//
// 关键时机:
//   - 适用范围:杀的使用(出牌阶段)与打出(响应决斗/南蛮入侵等)
//   - 牌源:**手牌或装备区**——规则明确允许装备区红色牌
//   - 还原时机:牌离开处理区时(进弃牌堆/装备区/其他玩家手牌)
//
// 已知问题/不完整实现:
//   1. **cardMap 全局 mutate 严重问题**:cardMap 是所有玩家共享的引用,
//      mutate card.name 会让"任何正在读这张牌的代码"看到错误的 name/suit
//      (例如:判定 / 拼点 / 洛神在同帧内读此牌时会读到 '杀' + 原 suit,
//      或被 _wrapper 标记影响)。应通过 CardWrapper 机制(types.ts 已定义)走 fromSkill 协议,
//      而非直接 mutate cardMap。
//   2. **还原时机不稳健**:仅依赖 "from.zone === '处理区'" 触发还原,
//      若杀被无懈可击/中断而未进入处理区→其他区的常规移动,wrapper 残留;
//      下一次该卡使用时会被认为"已包装",可能导致状态泄漏。
//   3. **类型擅自扩展**:在 wrapAsKill/unwrap 内强制写入 card._wrapper,
//      但 Card 类型(types.ts)没有 _wrapper 字段——TypeScript 通过 cast 绕过,
//      运行时正确但破坏了类型契约。
//   4. **isRedSuit 未与 useAndRespond 路径协同**:onMount 端的 cardFilter 限制了红色,
//      但 onInit 服务端验证不存在(由杀.ts 的 use/respond 接管)——
//      若客户端绕过 UI 直接构造 use 消息,服务端不会拦截非红色牌的武圣转化。
//   5. **没有适配响应路径的"打出"语义**:transform action 名字暗示 use,
//      respond 场景的转化由 杀.ts 接管,但 fromSkill 协议未充分文档化。
// ============================================================
import type { AtomAfterContext, FrontendAPI, Skill } from '../types';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
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

export function onInit(skill: Skill, ownerId: number): () => void {
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
