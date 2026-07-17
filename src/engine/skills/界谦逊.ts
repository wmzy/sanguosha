// 界谦逊(界陆逊·触发技):当一张延时锦囊牌或其他角色使用的普通锦囊牌对你生效时,
//   若你为唯一目标,你可以将所有手牌移出游戏,直到回合结束。
//
// 与标 谦逊 的区别:标版是锁定技(免疫顺手牵羊/乐不思蜀);OL 界谦逊是全新的触发型可选技
//   (移出手牌+回合结束归还),不免疫任何锦囊。二者机制完全不同,故新建本文件,标版保留不动。
//
// 实现(模式 A 触发型):
//   ① 触发钩点(两条路径):
//      - 「添加延时锦囊」after:延时锦囊(乐不思蜀/兵粮寸断/闪电)放置到陆逊判定区时触发。
//        延时锦囊天然单目标,无需额外唯一目标判定。
//      - 「成为目标」after:他人使用的普通锦囊以陆逊为唯一目标时触发。
//        判定:顶帧 from≠自己、顶帧处理区有「普通锦囊」牌(type==='锦囊牌' 且非延时/响应) 、
//        frame.params.targets 恰好 1 且为自己。(排除杀/多目标锦囊/自己使用的锦囊。)
//   ② 询问 confirm;确认后用「移出游戏」atom 把全部手牌暂存到 player.vars['界谦逊/移出']。
//   ③ 「回合结束」after-hook:检测到移出区非空 → 用「归还移出牌」atom 归还手牌。
//
// 联动:移出全部手牌会使手牌归零 → 触发「界连营」,X = 失去的手牌数 = 移出张数。
//   这是界陆逊的核心combo(谦逊搬空手牌 → 连营令多名角色摸牌)。
//
// 已知覆盖边界(诚实记录):
//   - 顺手牵羊/过河拆桥/火攻 等直接生效型普通锦囊不走「成为目标」atom,本实现未覆盖。
//     引擎无统一「锦囊生效」钩点,逐牌挂获得/弃置 before-hook 会破坏这些锦囊的选牌/结算流程,
//     风险高于收益,留作后续工作。当前覆盖:全部延时锦囊 + 经「成为目标」的单目标普通锦囊
//     (决斗,及未来任何走 成为目标 流程的单目标普通锦囊)。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CONFIRM_RT = '界谦逊/trigger';
const CONFIRMED_KEY = '界谦逊/confirmed';
// 移出区 vars 键名(与 atoms/移出游戏.ts 的 EXILE_VARS_KEY 保持一致)
const EXILE_VARS_KEY = '界谦逊/移出';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界谦逊',
    description:
      '当延时锦囊或他人普通锦囊对你生效且你为唯一目标时,你可以将所有手牌移出游戏直到回合结束',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 判断一张牌是否为「普通锦囊」(排除杀等基本牌、延时锦囊、响应锦囊)。
  // 真实牌堆中普通锦囊(决斗/顺手牵羊/铁索连环等)的 trickSubtype 为 undefined,
  // 仅延时锦囊(乐不思蜀等)与响应锦囊(无懈可击)显式设置 trickSubtype。
  function isNormalTrick(card: { type?: string; trickSubtype?: string } | undefined): boolean {
    if (!card) return false;
    if (card.type !== '锦囊牌') return false;
    return card.trickSubtype !== '延时锦囊' && card.trickSubtype !== '响应锦囊';
  }

  // 触发:询问是否发动谦逊;确认则把全部手牌移出游戏。
  // reason 仅用于 prompt 文案。
  async function maybeOfferExile(ctx: AtomAfterContext, reason: string): Promise<void> {
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (self.hand.length === 0) return; // 无手牌可移出,跳过

    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `是否发动谦逊?(${reason};将所有手牌移出游戏直到回合结束)`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (ctx.state.localVars[CONFIRMED_KEY] !== true) return;

    // 确认发动:把当前全部手牌移出游戏(重新读取,防御 pending 期间手牌变化)
    const player = ctx.state.players[ownerId];
    if (!player || player.hand.length === 0) return;
    const handIds = [...player.hand];
    await applyAtom(ctx.state, { type: '移出游戏', player: ownerId, cardIds: handIds });
  }

  // respond:回答谦逊确认
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是请求回应';
      if (atom.requestType !== CONFIRM_RT) return '当前不是谦逊确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 延时锦囊:放置到陆逊判定区 → 触发(天然唯一目标) ──
  registerAfterHook(state, skill.id, ownerId, '添加延时锦囊', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; trick?: { name?: string } };
    if (atom.type !== '添加延时锦囊') return;
    if (atom.player !== ownerId) return;
    await maybeOfferExile(ctx, `延时锦囊${atom.trick?.name ? '「' + atom.trick.name + '」' : ''}对你生效`);
  });

  // ── 普通锦囊(他人使用,陆逊为唯一目标):成为目标 after ──
  registerAfterHook(state, skill.id, ownerId, '成为目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; target?: number };
    if (atom.type !== '成为目标') return;
    if (atom.target !== ownerId) return;
    const frame = topFrame(ctx.state);
    if (!frame) return;
    if (frame.from === ownerId) return; // 自己使用的普通锦囊不触发
    // 顶帧处理区须有「普通锦囊」牌(排除杀等基本牌/延时锦囊/响应锦囊)
    const scrollCardId = frame.cards.find((id) =>
      isNormalTrick(ctx.state.cardMap[id] as { type?: string; trickSubtype?: string } | undefined),
    );
    if (!scrollCardId) return;
    // 唯一目标:frame.params.targets 恰好 1 且为自己
    const targets = frame.params.targets;
    if (!Array.isArray(targets) || targets.length !== 1 || targets[0] !== ownerId) return;
    const scrollName = ctx.state.cardMap[scrollCardId]?.name ?? '普通锦囊';
    await maybeOfferExile(ctx, `「${scrollName}」对你生效`);
  });

  // ── 回合结束:归还此前移出游戏的手牌 ──
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string };
    if (atom.type !== '回合结束') return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const exiled = self.vars[EXILE_VARS_KEY];
    if (!Array.isArray(exiled) || exiled.length === 0) return;
    await applyAtom(ctx.state, { type: '归还移出牌', player: ownerId });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '谦逊',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动谦逊?',
      confirmLabel: '发动(将所有手牌移出游戏)',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
