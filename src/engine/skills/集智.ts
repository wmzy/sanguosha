// 集智(黄月英·被动技):每当你使用一张非延时锦囊牌时,你可以摸一张牌。
//
// 实现机制:
//   afterHook 挂在「移动牌」:检测 owner 把一张非延时锦囊从手牌打出
//   (→ 处理区:常规锦囊;→ 弃牌堆:无懈可击)。
//
//   为什么挂「移动牌」而非「结算帧入栈」:无懈可击是 respond,不 pushFrame,
//   但会 移动牌(手牌→弃牌堆)。挂移动牌可覆盖全部 10 张非延时锦囊(含无懈可击)。
//   过滤条件严格限定 from.zone=手牌 + from.player=owner + 卡牌为非延时锦囊,
//   避免误触(弃置/摸牌/装备/延时锦囊/基本牌均被排除)。
//
//   触发后询问是否摸牌(请求回应 confirm,faithful to "可以"),确认则 摸牌 1 张。
//
// 非延时锦囊(10):过河拆桥/顺手牵羊/无中生有/无懈可击/借刀杀人/桃园结义/
//                 五谷丰登/南蛮入侵/万箭齐发/决斗
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

/** 非延时锦囊牌名集合 */
const NON_DELAY_TRICKS = new Set([
  '过河拆桥',
  '顺手牵羊',
  '无中生有',
  '无懈可击',
  '借刀杀人',
  '桃园结义',
  '五谷丰登',
  '南蛮入侵',
  '万箭齐发',
  '决斗',
]);

const CONFIRM_REQUEST = '集智/confirm';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '集智',
    description: '被动技:使用非延时锦囊牌时,你可以摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── confirm respond:黄月英本人回应是否摸牌 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是集智确认窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== CONFIRM_REQUEST) return '当前不是集智确认窗口';
      return null;
    },
    async (st: GameState, params) => {
      st.localVars['集智/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 移动牌 after hook:打出非延时锦囊时询问摸牌 ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (!atom.cardId) return;
    const from = atom.from;
    const to = atom.to;
    // 只关心 owner 从自己手牌打出(→ 处理区 或 → 弃牌堆)
    if (from?.zone !== '手牌' || from.player !== ownerId) return;
    if (!to || (to.zone !== '处理区' && to.zone !== '弃牌堆')) return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!card) return;
    if (card.type !== '锦囊牌') return;
    if (!NON_DELAY_TRICKS.has(card.name)) return;
    if (!ctx.state.players[ownerId]?.alive) return;

    // 询问是否摸牌(faithful to "你可以摸一张牌")
    delete ctx.state.localVars['集智/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动集智摸一张牌?',
        confirmLabel: '摸牌',
        cancelLabel: '不摸',
      },
      defaultChoice: true,
      timeout: 15,
    });
    if (!ctx.state.localVars['集智/confirmed']) return;
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '集智',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动集智摸一张牌?',
      confirmLabel: '摸牌',
      cancelLabel: '不摸',
    },
  });
}
