// 界趫猛(界公孙瓒·被动技,OL 界限突破官方逐字):
//   当你使用【杀】对一名角色造成伤害后,你可以弃置其区域里的一张牌。
//   若此牌为坐骑牌,你获得之。
//
// 标版公孙瓒无此技能(标版只有义从),趫猛是界版新增。
//
// 实现(被动 after-hook + 两步 respond,同狂骨/反馈/制霸模式):
//   造成伤害 after-hook(source===ownerId, amount>0, cardId 是 杀):
//     1. 检查目标区域(手牌/装备/判定)有牌;否则不触发
//     2. 询问是否发动趫猛(请求回应 requestType='趫猛/confirm',confirm prompt)
//        不发动 / 超时 → 结束(无效果)——「你可以」为可选触发,非锁定自动。
//     3. 发动 → 弹选牌面板(请求回应 requestType='趫猛/pick',pickTargetCard prompt):
//        使用者从目标区域(手牌/装备/判定)选一张
//     4. 检查选中牌:
//        - 坐骑牌(进攻马/防御马)→ 获得(从目标处获得到手牌)
//        - 装备牌(非坐骑)→ 弃置
//        - 手牌 → 弃置
//        - 判定区延时锦囊 → 移除延时锦囊 + 弃置
//
// 关键点:
//   - "使用【杀】造成伤害":严格 杀 造成的伤害。检查 atom.cardId 对应的卡牌 name === '杀'
//     (转化技如武圣的影子卡 name 也是 '杀',自动支持)。
//     非杀伤害(万箭齐发/南蛮入侵/决斗/ chains)不触发——cardId 是这些锦囊本身,name 不是 '杀'。
//   - 区域定义:手牌区 + 装备区 + 判定区,与过河拆桥/顺手牵羊/反馈 一致。
//   - 坐骑 = subtype '进攻马' 或 '防御马'(装备牌子类)。
//   - 选牌面板逻辑自实现,不复用 ./选牌面板.ts——选牌面板的 obtain/discard 是互斥的,
//     而趫猛需要"按选中牌类型动态决定 obtain 还是 discard",故独立实现。
//   - 一个技能实例只能注册一个 respond action(actionKey 冲突),
//     故 confirm 与选牌合并为单 respond 按 requestType 分支(同狂骨/反馈/制霸模式)。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

/** 是否发动趫猛的 requestType */
const CONFIRM_REQUEST = '趫猛/confirm';
/** 选牌面板 requestType */
const PICK_REQUEST = '趫猛/pick';
/** localVars key:是否发动(respond 写,hook 读) */
const CONFIRMED_KEY = '趫猛/confirmed';
/** localVars key:选牌结果(respond 写,hook 读) */
const PICK_RESULT_KEY = '趫猛/pickResult';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '趫猛',
    description:
      '当你使用【杀】对一名角色造成伤害后,你可以弃置其区域里的一张牌。若此牌为坐骑牌,你获得之',
  };
}

/** 是否是坐骑牌(进攻马/防御马) */
function isMountCard(card: { type?: string; subtype?: string } | undefined): boolean {
  return (
    !!card &&
    card.type === '装备牌' &&
    (card.subtype === '进攻马' || card.subtype === '防御马')
  );
}

/** 列出目标区域可被选的牌(用于 pickTargetCard prompt 的 equipment/judge/handCount) */
function buildPickOptions(
  state: GameState,
  target: number,
): {
  equipment: Array<{ slot: string; cardId: string; cardName: string }>;
  judge: Array<{ cardId: string; cardName: string }>;
  handCount: number;
  hasCards: boolean;
} {
  const tp = state.players[target];
  if (!tp) {
    return { equipment: [], judge: [], handCount: 0, hasCards: false };
  }
  const equipment = Object.entries(tp.equipment)
    .filter(([, id]) => typeof id === 'string')
    .map(([slot, id]) => ({
      slot,
      cardId: id as string,
      cardName: state.cardMap[id as string]?.name ?? '?',
    }));
  const judge = tp.pendingTricks.map((t) => ({
    cardId: t.card.id,
    cardName: t.card.name,
  }));
  const handCount = tp.hand.length;
  const hasCards = equipment.length > 0 || judge.length > 0 || handCount > 0;
  return { equipment, judge, handCount, hasCards };
}

/** 超时缺省选牌:明牌优先(装备第一张→判定第一张),否则 hand[0] */
function defaultPickZone(opts: {
  equipment: Array<{ cardId: string }>;
  judge: Array<{ cardId: string }>;
}): { zone: 'equipment' | 'judge' | 'hand'; cardId?: string; handIndex?: number } {
  if (opts.equipment.length > 0) {
    return { zone: 'equipment', cardId: opts.equipment[0].cardId };
  }
  if (opts.judge.length > 0) {
    return { zone: 'judge', cardId: opts.judge[0].cardId };
  }
  return { zone: 'hand', handIndex: 0 };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理「是否发动」与「选牌」两类询问(单 respond 按 requestType 分支)──
  // 选择者是公孙瓒本人(owner),故只注册到 ownerId 座次;以 skillId='界趫猛' 隔离路由。
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不需要回应';
      const rt = atom.requestType;
      if (rt !== CONFIRM_REQUEST && rt !== PICK_REQUEST) return '当前不是趫猛询问';
      // 选牌阶段的参数校验
      if (rt === PICK_REQUEST) {
        const zone = params.zone;
        if (zone === 'equipment' || zone === 'judge') {
          if (typeof params.cardId !== 'string') return 'cardId required';
        } else if (zone === 'hand') {
          if (typeof params.handIndex !== 'number') return 'handIndex required';
        } else {
          return 'zone required (equipment|judge|hand)';
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_REQUEST) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === PICK_REQUEST) {
        st.localVars[PICK_RESULT_KEY] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
      }
    },
  );

  // ── 造成伤害 after hook:趫猛主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as {
      source?: number;
      target?: number;
      amount?: number;
      cardId?: string;
    };
    if (atom.source !== ownerId) return; // 必须是自己造成的伤害
    if ((atom.amount ?? 0) <= 0) return; // 0 伤害不触发
    if (atom.target === undefined) return;
    const target = atom.target;
    if (target === ownerId) return; // 自伤不触发(描述是"对一名角色")
    if (!ctx.state.players[target]?.alive) return;

    // 必须是【杀】造成的伤害(cardId 对应卡 name === '杀',转化技影子卡也满足)
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    const damageCard = ctx.state.cardMap[cardId];
    if (!damageCard || damageCard.name !== '杀') return;

    // 自己必须存活(描述主体是"你")
    if (!ctx.state.players[ownerId]?.alive) return;

    // 目标区域必须有牌
    const pickOpts = buildPickOptions(ctx.state, target);
    if (!pickOpts.hasCards) return;

    // 1. 询问是否发动趫猛(可选触发:官方「你可以」)
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '趫猛:是否弃置目标一张牌?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (ctx.state.localVars[CONFIRMED_KEY] !== true) return; // 不发动 → 无效果

    // 2. 弹选牌面板:从目标区域选一张牌(明牌装备/判定 + 暗牌手牌)
    const defaultZone = defaultPickZone(pickOpts);
    delete ctx.state.localVars[PICK_RESULT_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: PICK_REQUEST,
      target: ownerId,
      prompt: {
        type: 'pickTargetCard',
        title: '趫猛:选择目标一张牌(若是坐骑,获得之)',
        target,
        equipment: pickOpts.equipment,
        judge: pickOpts.judge,
        handCount: pickOpts.handCount,
      },
      defaultChoice: defaultZone as unknown as Json,
      timeout: 20,
    });

    // 3. 读取选择并执行弃置/获得
    const result = ctx.state.localVars[PICK_RESULT_KEY] as
      | { zone: string; cardId: string | null; handIndex: number | null }
      | undefined;
    delete ctx.state.localVars[PICK_RESULT_KEY];

    const zone = (result?.zone ?? defaultZone.zone) as string;
    let pickedCardId: string | undefined;
    if (zone === 'equipment' || zone === 'judge') {
      pickedCardId = (result?.cardId ?? (defaultZone as { cardId?: string }).cardId) ?? undefined;
    } else {
      // hand:盲选第 K 张(超时或缺省→0)
      const handIndex = (result?.handIndex ?? (defaultZone.handIndex ?? 0)) as number;
      const tp = ctx.state.players[target];
      pickedCardId = tp?.hand[handIndex] ?? tp?.hand[0];
    }
    if (!pickedCardId) return;

    const pickedCard = ctx.state.cardMap[pickedCardId];
    const isMount = isMountCard(pickedCard);

    if (zone === 'judge') {
      // 判定区延时锦囊:先移除延时锦囊(清理判定区),再弃置(坐骑判定不可能)
      const tp = ctx.state.players[target];
      const trick = tp?.pendingTricks.find((t) => t.card.id === pickedCardId);
      if (trick) {
        await applyAtom(ctx.state, {
          type: '移除延时锦囊',
          player: target,
          trickName: trick.name,
        });
        await applyAtom(ctx.state, {
          type: '弃置',
          player: target,
          cardIds: [pickedCardId],
        });
      }
    } else if (isMount) {
      // 坐骑:获得之(从目标处获得到手牌)
      await applyAtom(ctx.state, {
        type: '获得',
        player: ownerId,
        cardId: pickedCardId,
        from: target,
      });
    } else {
      // 其他装备/手牌:弃置
      await applyAtom(ctx.state, {
        type: '弃置',
        player: target,
        cardIds: [pickedCardId],
      });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): void {
  // 被动技,无主动 action
  return;
}

const _skillModule: import('../types').SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
