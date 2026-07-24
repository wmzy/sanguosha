// 界双雄(界颜良文丑·群雄·转化技,OL 界限突破官方逐字):
//   摸牌阶段结束时,你可以弃置一张牌,然后你本回合可以将一张与之颜色不同的牌
//   当【决斗】使用。结束阶段,你获得本回合对你造成伤害的牌。
//
// 与标版双雄( src/engine/skills/双雄.ts )区别(本界版独立实现):
//   1. 触发时机+动作:标版"摸牌阶段开始 → 改为进行一次判定 → 获得判定牌 + 记判定牌颜色";
//      界版"摸牌阶段结束 → 弃置一张手牌 + 记弃置牌颜色"(不跳过默认摸牌,不判定,
//      不获得额外牌)。故触发点完全不同:after-hook on 阶段结束(摸牌),而非 before-hook
//      on 阶段开始(摸牌)。
//   2. 转化条件:标版/界版措辞都是"与之颜色不同"——标版"判定牌颜色",界版"弃置牌颜色"。
//   3. 界版新增:结束阶段,获得本回合对界颜良文丑造成伤害的牌(标版无此效果)。
//
// 四部分组合:
//   A) 摸牌阶段结束(after-hook on 阶段结束, phase='摸牌'):
//        询问发动 → 选一张手牌弃置 → 记 turn.vars['界双雄/color']=弃置牌颜色
//        (镜像 界将驰/截辎:用 NORMAL_KEY 区分被跳过的摸牌阶段——兵粮寸断/神速/巧变/再起
//        在 before-hook cancel 阶段开始,after-hook 不执行 → NORMAL_KEY 不设置 → 本 hook 不触发)
//   B) 转化 action(transform,preceding 决斗.use,镜像标版双雄/武圣单卡转化):
//        把一张与弃置牌颜色不同的手牌当【决斗】(影子卡 outputName='决斗')
//   C) 造成伤害 after-hook:target=ownerId 且 amount>0 时,记 cardId 到
//      turn.vars['界双雄/damageCards'](若为影子卡,记录 shadowOf 原卡 id——
//      影子卡入弃牌堆时引擎用原卡替换,记原卡 id 才能在结束时正确找到)
//   D) 结束阶段(after-hook on 阶段开始, phase='回合结束'):
//        把 turn.vars['界双雄/damageCards'] 中的牌从弃牌堆移到界颜良文丑手牌
//        (此时所有伤害结算已完成、伤害牌均已入弃牌堆,直接 移动牌 弃牌堆→手牌 即可)
//
// 颜色状态同步:turn.vars['界双雄/color'] 由 after-hook 写入 state(后端 transform
// validate 读)。view 侧经「回合用量」atom 同步到 players[me].turnUsage['界双雄/color'],
// 供前端 transform 的 activeWhen/cardFilter 读取(processedView 不增量维护 turn.vars)。
//
// 伤害牌时序:造成伤害 atom 触发时 cardId 在 frame.cards(处理区),父 execute 收尾会
// applyAtom(移动牌, 处理区→弃牌堆) 将其入弃牌堆。本技能不在造成伤害时拿取(可能有多张,
// 且父 execute 尚未完成),而是在结束阶段一次性批量拿取——此时所有伤害牌均已在弃牌堆。
// 若中途有其他技能(反馈/奸雄等)已拿走,该 cardId 不在弃牌堆 → 跳过(不重复获取)。
//
// 命名:文件名/loader key/character skill name 均为 '界双雄'(避开标双雄冲突);
//   内部 Skill.name = '双雄'(OL 官方技能名,玩家可见)。
import type {
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import {
  registerAction,
  registerAfterHook,
  hasBlockingPending,
  type SkillModule,
} from '../skill';
import { defaultPlayActive } from '../action-active';

const SKILL_ID = '界双雄';
const DISPLAY_NAME = '双雄';

/** localVars key:正常开始的摸牌阶段所属玩家(被跳过时不设,镜像 界将驰/截辎) */
const NORMAL_KEY = '界双雄/normalDrawPhase';
/** localVars key:是否发动(true=发动) */
const ACTIVATE_KEY = '界双雄/activate';
/** localVars key:玩家选择弃置的手牌 cardId */
const DISCARD_KEY = '界双雄/discardCard';
/** turn.vars key:弃置牌的颜色(红/黑),供后端 transform validate + 前端 activeWhen 读 */
const COLOR_KEY = '界双雄/color';
/** turn.vars key:本回合对界颜良文丑造成伤害的牌 cardId 数组 */
const DAMAGE_KEY = '界双雄/damageCards';

/** 询问 requestType(独立前缀避免与标版双雄 RT 冲突) */
const ACTIVATE_RT = '界双雄/activate';
const PICK_RT = '界双雄/pick';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '摸牌阶段结束时弃置一张牌,本回合可将与之颜色不同的牌当决斗使用;结束阶段获得本回合对你造成伤害的牌',
  };
}

/** 影子卡 id:${原id}#界双雄('界双雄' 后缀避免与标版影子卡冲突) */
function shadowIdOf(cardId: string): string {
  return `${cardId}#界双雄`;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理发动确认(ACTIVATE_RT)+ 选弃牌(PICK_RT)两类询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== ACTIVATE_RT && rt !== PICK_RT) return '当前不是双雄询问';
      // PICK_RT:必须提供合法手牌 cardId
      if (rt === PICK_RT) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张手牌';
        if (!st.players[ownerId].hand.includes(cardId)) return '牌不在手牌中';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === ACTIVATE_RT) {
        st.localVars[ACTIVATE_KEY] = params.choice === true;
      } else if (rt === PICK_RT) {
        if (typeof params.cardId === 'string') {
          st.localVars[DISCARD_KEY] = params.cardId;
        }
      }
    },
  );

  // ── 阶段开始(摸牌) after-hook:标记正常开始的摸牌阶段 ──
  //   skipPhase 在 before-hook cancel 阶段开始 → 本 after-hook 不执行 → 标记不设置
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '摸牌') return;
    if (atom.player !== ownerId) return;
    ctx.state.localVars[NORMAL_KEY] = ownerId;
  });

  // ── 阶段结束(摸牌) after-hook:核心触发 A —— 询问发动 → 弃牌 → 记色 ──
  registerAfterHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段结束') return;
    if (atom.phase !== '摸牌') return;
    if (atom.player !== ownerId) return;
    // 跳过情形:阶段开始 after-hook 未执行 → 标记缺失 → 不触发
    if (ctx.state.localVars[NORMAL_KEY] !== ownerId) return;
    delete ctx.state.localVars[NORMAL_KEY];

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 无手牌不可弃,跳过发动
    if (self.hand.length === 0) return;

    // 询问是否发动双雄
    delete ctx.state.localVars[ACTIVATE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: ACTIVATE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动双雄?(弃置一张牌,本回合可将与之颜色不同的牌当决斗使用)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (ctx.state.localVars[ACTIVATE_KEY] !== true) return;

    // 询问选一张手牌弃置
    delete ctx.state.localVars[DISCARD_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: PICK_RT,
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: '双雄:选择一张手牌弃置(本回合与之颜色不同的牌当决斗)',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      timeout: 15,
    });
    const cardId = ctx.state.localVars[DISCARD_KEY] as string | undefined;
    delete ctx.state.localVars[DISCARD_KEY];
    if (!cardId || !self.hand.includes(cardId)) return; // 超时/无效 → 不发动

    const card = ctx.state.cardMap[cardId];
    if (!card) return;

    // 弃置代价(手牌→弃牌堆)
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [cardId] });

    // 记录弃置牌颜色(后端 transform validate 读)
    const color = card.color;
    ctx.state.turn.vars[COLOR_KEY] = color;
    // 投影到 view.turnUsage,供前端 activeWhen 读取
    await applyAtom(ctx.state, {
      type: '回合用量',
      player: ownerId,
      key: COLOR_KEY,
      value: color,
    });
  });

  // ── 造成伤害 after-hook:target=ownerId 且 amount>0 → 记伤害牌 id ──
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const cardId = atom.cardId;
    if (!cardId) return; // 无来源伤害(闪电等)无牌可获得
    const card = ctx.state.cardMap[cardId];
    if (!card) return;
    // 转化影子卡(武圣红牌当杀等):记录 shadowOf 原卡 id——
    // 影子卡入弃牌堆时引擎用原卡替换,记原卡 id 才能在结束时找到
    const effectiveId = card.shadowOf ?? cardId;

    const list = (ctx.state.turn.vars[DAMAGE_KEY] as string[] | undefined) ?? [];
    if (!list.includes(effectiveId)) {
      list.push(effectiveId);
      ctx.state.turn.vars[DAMAGE_KEY] = list;
    }
  });

  // ── 阶段开始(回合结束) after-hook:核心触发 D —— 获得本回合伤害牌 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '回合结束') return;
    if (atom.player !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    const list = (ctx.state.turn.vars[DAMAGE_KEY] as string[] | undefined) ?? [];
    if (list.length === 0) return;

    // 逐张从弃牌堆移到界颜良文丑手牌
    // (有些牌可能已被其他技能拿走 → 不在弃牌堆 → 跳过,不强行获取避免状态损坏)
    for (const cardId of list) {
      if (!ctx.state.zones.discardPile.includes(cardId)) continue;
      if (!ctx.state.cardMap[cardId]) continue;
      await applyAtom(ctx.state, {
        type: '移动牌',
        cardId,
        from: { zone: '弃牌堆' },
        to: { zone: '手牌', player: ownerId },
      });
    }
    // 清空伤害牌记录(已处理完毕)
    delete ctx.state.turn.vars[DAMAGE_KEY];
  });

  // ── transform action:把一张与弃置牌颜色不同的手牌转化为影子"决斗" ──
  // 作为 preceding 在 决斗.use 之前执行。决斗.use validate 读 cardMap[影子id] 看到"决斗"通过。
  // 决斗技能零感知双雄——它看到的永远是 cardMap 里的一张"决斗"。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (s: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending + 存活
      const myTurn = s.currentPlayerIndex === ownerId;
      const inActPhase = s.phase === '出牌';
      const free = !hasBlockingPending(s);
      const self = s.players[ownerId];
      const selfAlive = self.alive === true;
      // 本回合必须已发动过双雄(弃置牌颜色已记)
      const discardColor = s.turn.vars[COLOR_KEY] as string | undefined;
      const colorSet = typeof discardColor === 'string' && discardColor !== '';
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const card = cardIdOk ? s.cardMap[cardId] : undefined;
      const cardExists = !!card;
      // 核心:手牌颜色与弃置牌颜色不同(红 vs 黑)
      const colorDiff = !!card && !!discardColor && card.color !== discardColor;
      const ok =
        myTurn && inActPhase && free && selfAlive && colorSet && cardInHand && cardExists && colorDiff;
      return ok ? null : '双雄:需要一张与本回合弃置牌颜色不同的手牌';
    },
    async (s: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      // 通过「当作」atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(s, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '决斗',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (s: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete s.cardMap[sId];
      const self = s.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动双雄?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });

  // 转化技 transform:把一张异色手牌当【决斗】。前端两步 UI(选牌+目标),
  // 提交时 preceding=[界双雄.transform] + 主 action=决斗.use。
  // cardFilter 放宽为任意手牌(颜色匹配由后端 validate 兜底),
  // activeWhen 仅在已发动双雄且存在异色手牌时激活按钮。
  api.defineAction('transform', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张与本回合弃置牌颜色不同的手牌当决斗使用',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
    transform: (card: Card) => ({
      name: '决斗',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.hand) return false;
      const discardColor = p.turnUsage?.[COLOR_KEY];
      if (typeof discardColor !== 'string' || discardColor === '') return false;
      // 存在颜色不同的手牌时激活
      return p.hand.some((c) => c.color !== discardColor);
    },
  });
  return;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
