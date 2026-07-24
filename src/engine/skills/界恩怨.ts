// 界恩怨(界法正·蜀·被动技,OL 界限突破 hero/610 官方逐字):
//   当你获得一名其他角色至少两张牌后,你可以令其摸一张牌。
//   当你受到1点伤害后,你可以令伤害来源选择一项:
//     1.交给你一张红色手牌;2.失去1点体力。
//
// 与标版法正(标版未实现,此处为界版独立实现)差异:
//   - 标版 effect B 选项 1:交给你一张【手牌】(任意)
//   - 界版 effect B 选项 1:交给你一张【红色手牌】(颜色限定,加强索赔)
//   effect A 与标版一致(获 ≥2 张牌令其摸 1)。
//
// 实现:
//   effect A(获牌触发):
//     - after-hook on 获得/给予/移动牌:当 to=ownerId, from=其他玩家, 同批次累计≥2
//       → 询问法正是否发动 → 令来源摸一张牌
//     - 批次识别:按 settlementStack.depth 隔离(同一父帧内多次获得=同批次)。
//       depth 变化即视为新批次,计数重置(避免跨批次误累加)。
//     - 计数达到 2 触发并清零(同批次内多次达到仅触发一次)。
//   effect B(受伤触发):
//     - after-hook on 造成伤害(target=ownerId, source 存活, amount>0)
//     - 询问法正是否发动 → 询问来源 confirm(交红牌 vs 失体力)
//       · 来源无红色手牌 → 强制失去1点体力(无选择)
//       · 来源有红色手牌 → 来源选 1(交红牌,再 useCard 选具体卡)或 2(失体力)
//
// respond 路由: 法正询问走法正座次;来源询问走来源座次(需遍历所有座次注册)。
//
// 命名:文件名/loader key/character skill name 均为 '界恩怨'(避开与未来标版冲突);
//   内部 Skill.name = '恩怨'(OL 官方技能名,玩家可见)。
import type {
  AtomAfterContext,
  AtomOfName,
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, pushFrame, popFrame } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界恩怨';
const DISPLAY_NAME = '恩怨';

// localVars 键
const A_CONFIRM_KEY = `${SKILL_ID}/aConfirmed`; // 法正 confirm(effect A)
const B_CONFIRM_KEY = `${SKILL_ID}/bConfirmed`; // 法正 confirm(effect B)
const B_SOURCE_CHOICE_KEY = `${SKILL_ID}/bSourceChoice`; // 来源 confirm(effect B:'card'|'lose')
const B_CARD_KEY = `${SKILL_ID}/bCardId`; // 来源选的红牌 cardId

// 询问 requestType
const RT_A_CONFIRM = `${SKILL_ID}/aConfirm`; // 法正 confirm A
const RT_B_CONFIRM = `${SKILL_ID}/bConfirm`; // 法正 confirm B
const RT_B_SOURCE = `${SKILL_ID}/bSource`; // 来源 confirm 选交牌/失体力
const RT_B_CARD = `${SKILL_ID}/bCard`; // 来源 useCard 选红牌

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '获得一名其他角色≥2张牌后可令其摸1张;受到1点伤害后令来源选:交红色手牌或失去1点体力',
  };
}

/** 获得计数 key(per source) */
function gainCountKey(from: number): string {
  return `${SKILL_ID}/gainCount/${from}`;
}
/** 获得计数所在 depth key(per source) */
function gainDepthKey(from: number): string {
  return `${SKILL_ID}/gainDepth/${from}`;
}

/**
 * 记录一次"法正从 from 获得 1 张牌",返回是否触发 effect A(计数达 2)。
 * 同一 depth 内累计;跨 depth(新批次)重置。达 2 后清零(仅触发一次)。
 */
function trackGainAndCheck(state: GameState, from: number): boolean {
  const depth = state.settlementStack.length;
  const depthK = gainDepthKey(from);
  const countK = gainCountKey(from);
  const storedDepth = state.localVars[depthK] as number | undefined;
  let count: number;
  if (storedDepth !== depth) {
    count = 1;
    state.localVars[depthK] = depth;
  } else {
    count = ((state.localVars[countK] as number | undefined) ?? 0) + 1;
  }
  state.localVars[countK] = count;
  if (count >= 2) {
    state.localVars[countK] = 0; // 清零,避免同批次重复触发
    return true;
  }
  return false;
}

/** 来源手牌中是否有红色牌 */
function hasRedHandCard(state: GameState, player: number): boolean {
  const hand = state.players[player]?.hand ?? [];
  return hand.some((id) => state.cardMap[id]?.color === '红');
}

/** 检查 atom 是否为" transferring 1 card to ownerId from otherPlayer " */
function extractGainEvent(
  atom: AtomAfterContext['atom'],
  ownerId: number,
): { from: number } | null {
  const a = atom as Record<string, unknown>;
  // 获得 atom: { player, cardId, from? }
  if (a['type'] === '获得') {
    const player = a['player'] as number | undefined;
    const from = a['from'] as number | undefined;
    if (player === ownerId && typeof from === 'number' && from !== ownerId) {
      return { from };
    }
    return null;
  }
  // 给予 atom: { cardId, from, to }
  if (a['type'] === '给予') {
    const to = a['to'] as number | undefined;
    const from = a['from'] as number | undefined;
    if (to === ownerId && typeof from === 'number' && from !== ownerId) {
      return { from };
    }
    return null;
  }
  // 移动牌 atom: { cardId, from:{zone,player}, to:{zone,player} }
  if (a['type'] === '移动牌') {
    const to = a['to'] as { zone?: string; player?: number } | undefined;
    const from = a['from'] as { zone?: string; player?: number } | undefined;
    if (
      to?.zone === '手牌' &&
      to.player === ownerId &&
      typeof from?.player === 'number' &&
      from.player !== ownerId
    ) {
      return { from: from.player };
    }
    return null;
  }
  return null;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 所有座次统一注册一个 respond(同 (skillId, ownerId, actionType) 只能一个 entry)──
  //    · 法正座次:confirm A / confirm B(法正是否发动)
  //    · 所有座次(含法正):来源选交牌/失体力 + 选红牌(每个座次都可能成为来源)──
  for (const p of state.players) {
    const seatId = p.index;
    const isOwner = seatId === ownerId;
    registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (s) => {
        const slot = s.pendingSlots.get(seatId);
        if (!slot || slot.atom.type !== '请求回应') return '当前不需要回应';
        const rt = (slot.atom as unknown as { requestType?: string }).requestType ?? '';
        const ownerRTs = [RT_A_CONFIRM, RT_B_CONFIRM];
        const sourceRTs = [RT_B_SOURCE, RT_B_CARD];
        if (isOwner && ownerRTs.includes(rt)) return null;
        if (sourceRTs.includes(rt)) return null;
        return '当前不是恩怨询问';
      },
      async (s, params) => {
        const slot = s.pendingSlots.get(seatId);
        const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
        if (rt === RT_A_CONFIRM) {
          s.localVars[A_CONFIRM_KEY] = params.choice === true;
        } else if (rt === RT_B_CONFIRM) {
          s.localVars[B_CONFIRM_KEY] = params.choice === true;
        } else if (rt === RT_B_SOURCE) {
          // choice=true → 选项 1(交红色手牌);choice=false → 选项 2(失去 1 体力)
          s.localVars[B_SOURCE_CHOICE_KEY] = params.choice === true ? 'card' : 'lose';
        } else if (rt === RT_B_CARD) {
          const cardId = typeof params.cardId === 'string' ? params.cardId : '';
          s.localVars[B_CARD_KEY] = cardId;
        }
      },
    );
  }

  // ── effect A: 获得牌后 hook(获得/给予/移动牌) ──
  const gainHook = async (ctx: AtomAfterContext<AtomOfName<'获得' | '给予' | '移动牌'>>): Promise<void> => {
    // effect A 不限制回合——任何时候获得牌都触发
    const ev = extractGainEvent(ctx.atom, ownerId);
    if (!ev) return;
    const from = ev.from;
    if (!ctx.state.players[from]?.alive) return;
    const trigger = trackGainAndCheck(ctx.state, from);
    if (!trigger) return;

    // 询问法正是否发动(可选)
    delete ctx.state.localVars[A_CONFIRM_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: RT_A_CONFIRM,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `恩怨:获得 ${ctx.state.players[from].name ?? `P${from}`} 至少 2 张牌,是否令其摸 1 张?`,
        confirmLabel: '令其摸 1 张',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (ctx.state.localVars[A_CONFIRM_KEY] !== true) return;
    // 令来源摸 1 张牌
    if (ctx.state.players[from]?.alive) {
      await applyAtom(ctx.state, { type: '摸牌', player: from, count: 1 });
    }
  };
  registerAfterHook(state, skill.id, ownerId, '获得', gainHook);
  registerAfterHook(state, skill.id, ownerId, '给予', gainHook);
  registerAfterHook(state, skill.id, ownerId, '移动牌', gainHook);

  // ── effect B: 受到伤害后 hook ──
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.source === undefined || atom.source === ownerId) return;
    const sourceIdx = atom.source;
    const sourcePlayer = ctx.state.players[sourceIdx];
    if (!sourcePlayer?.alive) return;

    // 1. 询问法正是否发动(可选)
    delete ctx.state.localVars[B_CONFIRM_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: RT_B_CONFIRM,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '恩怨:受到伤害后,是否令来源选交红牌或失去 1 体力?',
        confirmLabel: '令来源选择',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (ctx.state.localVars[B_CONFIRM_KEY] !== true) return;
    if (!ctx.state.players[sourceIdx]?.alive) return; // 法正思考期间来源死亡

    await pushFrame(ctx.state, SKILL_ID, ownerId, { source: sourceIdx });
    try {
      // 2. 来源选 项(若有红色手牌则 confirm 选;否则强制失去 1 体力)
      const hasRed = hasRedHandCard(ctx.state, sourceIdx);
      let sourceChoseCard = false;
      if (hasRed) {
        delete ctx.state.localVars[B_SOURCE_CHOICE_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: RT_B_SOURCE,
          target: sourceIdx,
          prompt: {
            type: 'confirm',
            title: '恩怨:选择一项(确认=交给法正一张红色手牌,取消=失去 1 点体力)',
            confirmLabel: '交红色手牌',
            cancelLabel: '失去 1 点体力',
          },
          defaultChoice: false,
          timeout: 15,
        });
        sourceChoseCard = ctx.state.localVars[B_SOURCE_CHOICE_KEY] === 'card';
      }

      if (sourceChoseCard) {
        // 选具体红色手牌
        delete ctx.state.localVars[B_CARD_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: RT_B_CARD,
          target: sourceIdx,
          prompt: {
            type: 'useCard',
            title: '恩怨:选择一张红色手牌交给法正',
            cardFilter: {
              filter: (c: Card) => c.color === '红',
              min: 1,
              max: 1,
            },
          },
          timeout: 15,
        });
        const cardId = ctx.state.localVars[B_CARD_KEY] as string;
        if (
          typeof cardId === 'string' &&
          cardId &&
          ctx.state.players[sourceIdx]?.hand.includes(cardId) &&
          ctx.state.cardMap[cardId]?.color === '红'
        ) {
          await applyAtom(ctx.state, {
            type: '移动牌',
            cardId,
            from: { zone: '手牌', player: sourceIdx },
            to: { zone: '手牌', player: ownerId },
          });
        } else {
          // 来源给的牌不合法(超时默认 / 手牌变化) → 回退失去 1 体力
          await applyAtom(ctx.state, { type: '失去体力', target: sourceIdx, amount: 1 });
        }
      } else {
        // 失去 1 点体力(非伤害,不触发反馈/奸雄等)
        await applyAtom(ctx.state, { type: '失去体力', target: sourceIdx, amount: 1 });
      }
    } finally {
      await popFrame(ctx.state);
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动恩怨?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
