// 界落英(界曹植·被动技,OL 界限突破官方逐字):
//   当其他角色的梅花牌因弃置或判定而置入弃牌堆后,你可以获得其中任意张牌。
//
// 与标版区别:标版曹植未实现;描述与界版完全一致。界版独立文件,以便承载界酒诗
//   的扩展效果(背面朝上时,"落英"牌无距离限制且不能被响应——引擎中落英只获取
//   不"使用",该效果无可观察行为,详见界酒诗注释)。
//
// 模式 A(被动触发):
//   - after hook 挂「弃置」:其他玩家弃置的梅花牌入弃牌堆后 → 询问曹植是否获得。
//   - after hook 挂「判定」:其他玩家判定的梅花牌入弃牌堆前 → 询问曹植。
//     (判定牌在 frame.cards 末尾;若曹植获取,需从 frame.cards 拿走以防
//      判定.afterHooks 把它误移入弃牌堆——参考 屯田/天妒 的手法)
//
// 选择任意张:由于引擎 UI 限制(useCard cardFilter 仅呈现手牌),简化为"全得/全不得"
//   的 confirm 询问。这偏离严格"任意张"语义,但满足"你可以获得"的触发选择;
//   未触发的牌保持原位(弃置路径:已入弃牌堆;判定路径:由判定.afterHooks 入弃)。
//
// 关键点:
//   - "其他角色": atom.player !== ownerId(判定/弃置的归属玩家不是曹植自己)
//   - 梅花牌: state.cardMap[cardId].suit === '♣'
//   - 回合外获得时,累加"英"计数(player.vars['落英/外得计数']),供界酒诗
//     的"翻回正面 2"触发器读取(累计 ≥ 体力上限时触发)。回合内获得不累加。
//   - 计数在曹植回合开始(准备阶段开始)时清零。
//   - 判定路径安全前提:判定触发时 frame.cards 末尾就是判定牌(典型场景:
//     判定阶段、独立判定技能)。若 frame 还有其他牌(如杀结算中八卦阵判定),
//     抽取判定牌会破坏判定.afterHooks 的 splice——本实现加 frame.cards.length === 1
//     防御:多牌场景下跳过获取(让判定牌正常入弃牌堆),避免状态损坏。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import {
  registerAction,
  registerAfterHook,
  registerBeforeHook,
  type SkillModule,
} from '../skill';

const SKILL_ID = '界落英';
const DISPLAY_NAME = '落英';
const CHOOSE_RT = '落英/choose';
const CHOICE_KEY = '落英/choice';
/** 回合外累计获得的"落英"牌数(供界酒诗翻回正面触发器读取)。在曹植回合开始时清零。 */
const OUTSIDE_GAIN_COUNT_KEY = '落英/外得计数';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '其他角色的梅花牌因弃置或判定而置入弃牌堆后,你可以获得其中任意张牌',
  };
}

/** 当前回合外累计获得的"落英"牌数 */
function outsideGainCount(state: GameState, ownerId: number): number {
  const v = state.players[ownerId]?.vars[OUTSIDE_GAIN_COUNT_KEY];
  return typeof v === 'number' ? v : 0;
}

/** 判断一张牌是否为梅花 */
function isClubCard(state: GameState, cardId: string): boolean {
  const card = state.cardMap[cardId];
  return !!card && card.suit === '♣';
}

/**
 * 询问并获取一组梅花牌(在弃牌堆或处理区)。每张经 移动牌 atom 入曹植手牌。
 * 返回实际获得的张数。
 *
 * 注:不 pushFrame——pushFrame 会令 frameCards() 返回新空帧而非判定牌所在区,
 *   导致后续 includes 校验失败。天妒/界奸雄 同样不 pushFrame。
 */
async function askAndGain(
  state: GameState,
  ownerId: number,
  clubCardIds: string[],
  fromZone: '弃牌堆' | '处理区',
): Promise<number> {
  if (clubCardIds.length === 0) return 0;
  const self = state.players[ownerId];
  if (!self?.alive) return 0;

  // 翻面增强:无距离限制且不能被响应(本实现无可观察行为,标版注释)
  // const flipped = self.tags.some((t) => t.endsWith('/翻面'));

  delete state.localVars[CHOICE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CHOOSE_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: `落英:是否获得 ${clubCardIds.length} 张梅花牌?`,
      confirmLabel: '获得',
      cancelLabel: '不获得',
    },
    defaultChoice: false,
    timeout: 10,
  });

  const want = state.localVars[CHOICE_KEY] === true;
  delete state.localVars[CHOICE_KEY];
  if (!want) return 0;

  let gained = 0;
  for (const cardId of clubCardIds) {
    // 卡可能在询问期间被其他技能移走(理论),再次校验仍在原区
    if (fromZone === '弃牌堆') {
      if (!state.zones.discardPile.includes(cardId)) continue;
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '弃牌堆' },
        to: { zone: '手牌', player: ownerId },
      });
    } else {
      // 处理区:frame.cards 顶(判定牌)
      if (!frameCards(state).includes(cardId)) continue;
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '手牌', player: ownerId },
      });
    }
    gained += 1;
  }
  return gained;
}

/**
 * 落英获得后:若在回合外,累加"英"计数;若达到体力上限且武将牌背面朝上,
 * 触发界酒诗的"翻回正面 2"询问。本函数内联翻回询问,避免界酒诗二次检测。
 */
async function recordGainAndMaybeFlipBack(
  state: GameState,
  ownerId: number,
  gainedCount: number,
): Promise<void> {
  if (gainedCount <= 0) return;
  // 仅"回合外"累计
  if (state.currentPlayerIndex === ownerId) return;

  const self = state.players[ownerId];
  if (!self?.alive) return;

  const newCount = outsideGainCount(state, ownerId) + gainedCount;
  self.vars[OUTSIDE_GAIN_COUNT_KEY] = newCount;

  // 触发"翻回正面 2":背面朝上 + 累计 ≥ 体力上限
  const flipped = self.tags.some((t) => t.endsWith('/翻面'));
  if (!flipped) return;
  if (newCount < self.maxHealth) return;

  // 询问是否翻回正面
  delete state.localVars['酒诗/flipChoice'];
  await applyAtom(state, {
    type: '请求回应',
    requestType: '酒诗/flipBack',
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: `酒诗:回合外累计获得 ${newCount} 张"落英"牌(≥体力上限 ${self.maxHealth}),是否翻至正面?`,
      confirmLabel: '翻至正面',
      cancelLabel: '保持背面',
    },
    defaultChoice: false,
    timeout: 10,
  });
  const flip = state.localVars['酒诗/flipChoice'] === true;
  delete state.localVars['酒诗/flipChoice'];
  if (!flip) return;

  // 翻回正面:清除所有 '/翻面' 后缀标签
  const flipTags = self.tags.filter((t) => t.endsWith('/翻面'));
  for (const tag of flipTags) {
    await applyAtom(state, { type: '去标签', player: ownerId, tag });
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:玩家在「落英/choose」询问下的选择 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== CHOOSE_RT) return '当前不是落英选择';
      return null;
    },
    async (s, params) => {
      s.localVars[CHOICE_KEY] = params.choice === true;
    },
  );

  // ── 弃置 after hook:其他玩家弃置的梅花牌入弃牌堆后 ──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '弃置') return;
    if (atom.player === ownerId) return; // 自己弃置不触发
    if (!atom.cardIds || atom.cardIds.length === 0) return;

    const clubCardIds = atom.cardIds.filter((id) => isClubCard(ctx.state, id));
    if (clubCardIds.length === 0) return;

    // 弃牌堆是公开信息,所有玩家可见;落英为公开触发
    const gained = await askAndGain(ctx.state, ownerId, clubCardIds, '弃牌堆');
    await recordGainAndMaybeFlipBack(ctx.state, ownerId, gained);
  });

  // ── 判定 after hook:其他玩家判定的梅花牌入弃牌堆前 ──
  //   判定牌在 frame.cards 末尾;若获取,需从 frame.cards 拿走。
  //   安全前提:frame.cards 仅含判定牌(典型场景:判定阶段/独立判定)。
  //   多牌场景(如杀结算中八卦阵)跳过获取,避免破坏 判定.afterHooks splice。
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.player === ownerId) return; // 自己的判定不触发

    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    // 安全检查:只在 frame.cards 末尾就是判定牌且无其他干扰时获取
    if (processing.length > 1) return;
    const judgeCardId = processing[processing.length - 1];
    if (!isClubCard(ctx.state, judgeCardId)) return;

    const gained = await askAndGain(ctx.state, ownerId, [judgeCardId], '处理区');
    await recordGainAndMaybeFlipBack(ctx.state, ownerId, gained);
  });

  // ── 阶段开始(准备) before hook:曹植回合开始时清零"外得计数" ──
  //   "回合外累计"语义:在曹植回合内不累计,回合外才累计;进入自己回合即清零。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '准备') return;
      const self = ctx.state.players[ownerId];
      if (!self) return;
      delete self.vars[OUTSIDE_GAIN_COUNT_KEY];
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动落英?',
      confirmLabel: '获得',
      cancelLabel: '不获得',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
