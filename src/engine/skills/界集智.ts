// 界集智(界黄月英·被动技):当你使用非转化锦囊牌时,你可以摸一张牌,
//   若此牌是基本牌,你可以弃置此牌令你本回合手牌上限+1。
//
// OL 官方(hero/442)逐字:
//   "当你使用非转化锦囊牌时,你可以摸一张牌,若此牌是基本牌,
//    你可以弃置此牌令你本回合手牌上限+1。"
//
// 实现机制:
//   afterHook 挂在「移动牌」:检测 owner 把一张【非转化】非延时锦囊从手牌打出
//   (→ 处理区:常规锦囊;→ 弃牌堆:无懈可击)。
//
//   为什么挂「移动牌」而非「结算帧入栈」:无懈可击是 respond,不 pushFrame,
//   但会 移动牌(手牌→弃牌堆)。挂移动牌可覆盖全部 10 张非延时锦囊(含无懈可击)。
//   过滤条件严格限定 from.zone=手牌 + from.player=owner + 卡牌为非延时锦囊,
//   避免误触(弃置/摸牌/装备/延时锦囊/基本牌均被排除)。
//
//   「非转化」判定(关键):
//     - 单卡转化(武圣/倾国/奇袭/火计 等):影子卡 shadowOf 指向原卡 → card.shadowOf 为真。
//     - 多卡转化(丈八蛇矛/乱击):影子卡 id 形如 `${id1}#${id2}#技能名`,shadowOf 为空
//       但 id 含 '#'。
//     故「非转化」= card.shadowOf 为空 且 card.id 不含 '#'。
//     转化出的锦囊(如乱击→万箭齐发、奇袭→过河拆桥)不触发集智。
//
//   触发流程(对齐官方):
//     1. confirm:是否摸一张牌?(对应官方"你可以摸一张牌")
//     2. 是 → 抽牌堆顶一张(若牌堆非空):peek 顶牌 → 摸牌 count=1(必抽出该顶牌)。
//     3. 若摸到的牌是基本牌 → confirm:是否弃置此牌令本回合手牌上限+1?
//          是 → 移动牌(手牌→弃牌堆)+ turn.vars['手牌上限/bonus:<owner>'] += 1
//          否 → 保留。
//     4. 非基本牌 → 保留(无需询问)。
//
//   手牌上限 bonus 经 hand-limit.ts 默认公式(health + turn.vars['手牌上限/bonus:<p>'])
//   生效;「回合结束」atom 自动清空 turn.vars → 本回合内有效,回合结束归零。
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

const CONFIRM_REQUEST = '界集智/confirm'; // 是否摸一张牌
const DISCARD_REQUEST = '界集智/discard'; // 是否弃置基本牌令本回合手牌上限+1

/** 手牌上限 bonus 的 turn.vars 键(与 hand-limit.ts 默认公式一致) */
function handLimitBonusKey(ownerId: number): string {
  return `手牌上限/bonus:${ownerId}`;
}

/** 读取当前 pending 的 requestType(类型安全) */
function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as Record<string, unknown>).requestType as string | undefined;
}

/** 判定打出牌是否为「转化牌」(单卡 shadowOf 或多卡 '#' 拼接 id) */
function isTransformedCard(card: { shadowOf?: string; id: string }): boolean {
  return Boolean(card.shadowOf) || card.id.includes('#');
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界集智',
    description:
      '被动技:使用非转化锦囊牌时你可以摸一张牌;若此牌是基本牌,可弃之令本回合手牌上限+1',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理界集智的两步询问(confirm / discard) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState) => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_REQUEST && rt !== DISCARD_REQUEST) return '当前不是集智询问';
      return null;
    },
    async (st: GameState, params) => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_REQUEST) {
        st.localVars['界集智/confirmed'] = params.choice === true || params.confirmed === true;
      } else if (rt === DISCARD_REQUEST) {
        st.localVars['界集智/discard'] = params.choice === true || params.confirmed === true;
      }
    },
  );

  // ── 移动牌 after hook:打出【非转化】非延时锦囊时触发界集智 ──
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
    // 关键:「非转化锦囊牌」过滤——转化出的锦囊不触发集智
    if (isTransformedCard(card)) return;
    if (!ctx.state.players[ownerId]?.alive) return;

    // ── 第一步:询问是否摸一张牌 ──
    delete ctx.state.localVars['界集智/confirmed'];
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
    if (!ctx.state.localVars['界集智/confirmed']) return;

    // ── 第二步:摸牌前 peek 牌堆顶(若牌堆非空),用于判断"是否基本牌" ──
    // 摸牌 count=1 在 deck.length>=1 时必抽出顶牌,无重洗,故 peek 与实际摸到一致。
    // 牌堆为空(仅弃牌堆有牌)时会触发重洗,无法预先 peek → 跳过"弃置换上限"分支。
    const deck = ctx.state.zones.deck;
    const peekedTopId = deck.length > 0 ? deck[deck.length - 1] : undefined;
    const peekedTopCard = peekedTopId ? ctx.state.cardMap[peekedTopId] : undefined;

    // 摸牌 1 张(对应官方"你可以摸一张牌")
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });

    // ── 第三步:若摸到的是基本牌,询问是否弃之换本回合手牌上限+1 ──
    if (!peekedTopCard || peekedTopCard.type !== '基本牌') return;

    delete ctx.state.localVars['界集智/discard'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: DISCARD_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '集智:是否弃置此基本牌令本回合手牌上限+1?',
        confirmLabel: '弃置',
        cancelLabel: '保留',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars['界集智/discard']) return;

    // 弃置此牌:从 owner 手牌移到弃牌堆
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const idx = self.hand.indexOf(peekedTopId!);
    if (idx < 0) return; // 卡不在手牌(已被其他效果移动),跳过
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: peekedTopId!,
      from: { zone: '手牌', player: ownerId },
      to: { zone: '弃牌堆' },
    });

    // 本回合手牌上限+1(turn.vars['手牌上限/bonus:<owner>'])
    const bonusKey = handLimitBonusKey(ownerId);
    const current = (ctx.state.turn.vars[bonusKey] as number | undefined) ?? 0;
    ctx.state.turn.vars[bonusKey] = current + 1;
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
      confirmLabel: '摸牌',
      cancelLabel: '不摸',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
