// 界集智(界黄月英·被动技):当你使用一张锦囊牌时,你可以展示牌堆顶一张牌,
//   若为基本牌,你弃置此牌或将其交给一名角色;若不为基本牌,你获得之。
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
//   触发流程(多步询问):
//     1. 询问是否发动集智(confirm),确认 → 展示牌堆顶(展示 atom)。
//     2. 分类处理:
//          基本牌 → 询问是否交给一名角色(give confirm),确认则 choosePlayer 并 摸牌 给目标,
//                                                  否则 移动牌(牌堆→弃牌堆)。
//          非基本牌 → 摸牌 1 张(获得之)。
//
// 非延时锦囊(10):过河拆桥/顺手牵羊/无中生有/无懈可击/借刀杀人/桃园结义/
//                 五谷丰登/南蛮入侵/万箭齐发/决斗
import type { AtomAfterContext, FrontendAPI, GameState, Skill } from '../types';
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
const GIVE_REQUEST = '集智/give';
const TARGET_REQUEST = '集智/target';

/** 读取当前 pending 的 requestType(类型安全) */
function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as Record<string, unknown>).requestType as string | undefined;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界集智',
    description: '被动技:使用锦囊牌时,展示牌堆顶一张牌:基本牌弃置或交给一名角色,非基本牌获得之',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理界集智的多步询问(confirm / give / target) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState) => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_REQUEST && rt !== GIVE_REQUEST && rt !== TARGET_REQUEST)
        return '当前不是集智询问';
      return null;
    },
    async (st: GameState, params) => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_REQUEST) {
        st.localVars['集智/confirmed'] = params.choice === true || params.confirmed === true;
      } else if (rt === GIVE_REQUEST) {
        st.localVars['集智/giveChoice'] = params.choice === true || params.confirmed === true;
      } else if (rt === TARGET_REQUEST) {
        st.localVars['集智/target'] = params.target ?? null;
      }
    },
  );

  // ── 移动牌 after hook:打出非延时锦囊时触发界集智 ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as {
      cardId?: string;
      from?: { zone?: string; player?: number };
      to?: { zone?: string };
    };
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

    // ── 第一步:询问是否发动界集智 ──
    delete ctx.state.localVars['集智/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动集智展示牌堆顶牌?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: true,
      timeout: 15,
    });
    if (!ctx.state.localVars['集智/confirmed']) return;

    // ── 界集智:展示牌堆顶并分类处理 ──
    const deck = ctx.state.zones.deck;
    if (deck.length === 0) return;
    const topCardId = deck[deck.length - 1];
    const topCard = ctx.state.cardMap[topCardId];
    if (!topCard) return;

    // 展示牌堆顶牌(广播身份给所有人)
    await applyAtom(ctx.state, { type: '展示', player: ownerId, cardId: topCardId });

    if (topCard.type === '基本牌') {
      // 基本牌:弃置或交给一名角色
      delete ctx.state.localVars['集智/giveChoice'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: GIVE_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '集智:是否将此牌交给一名角色?(否则弃置)',
          confirmLabel: '交给',
          cancelLabel: '弃置',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (ctx.state.localVars['集智/giveChoice']) {
        // 选择交给哪名角色(含自己)
        delete ctx.state.localVars['集智/target'];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: TARGET_REQUEST,
          target: ownerId,
          prompt: {
            type: 'choosePlayer',
            title: '集智:将牌堆顶牌交给一名角色',
            min: 1,
            max: 1,
            filter: (_view: unknown, target: number) =>
              ctx.state.players[target]?.alive === true,
          },
          timeout: 15,
        });
        const giveTarget = ctx.state.localVars['集智/target'] as number | null;
        if (typeof giveTarget === 'number') {
          // 展示后牌堆未变,摸牌 count=1 必然抽出刚展示的 topCardId
          await applyAtom(ctx.state, { type: '摸牌', player: giveTarget, count: 1 });
        }
      } else {
        // 弃置:移动牌堆顶到弃牌堆
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: topCardId,
          from: { zone: '牌堆' },
          to: { zone: '弃牌堆' },
        });
      }
    } else {
      // 非基本牌(锦囊/装备):获得之(摸牌 count=1 抽出刚展示的牌)
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    }

    // 清理界集智 localVars
    delete ctx.state.localVars['集智/giveChoice'];
    delete ctx.state.localVars['集智/target'];
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '集智',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动集智?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
