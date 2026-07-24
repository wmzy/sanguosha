// 界补益(界吴国太·被动技,OL 界限突破官方逐字):
//   当一名角色进入濒死状态时,你可以选择其一张牌,
//   若此牌不为基本牌,则其弃置此牌,然后回复1点体力。
//
// 与标版吴国太 补益 的区别(标版未实现;基于官方描述对比):
//   - 标版:"当一名角色进入濒死状态时,你可以展示其一张手牌,
//     若为非基本牌,其弃置之并回复1点体力。"——仅手牌,且"展示"(公开)。
//   - 界版:"选择其一张牌"(手牌或装备区),不强调展示(直接选择→判定→弃回)。
//   界版与标版机制略有不同(可选装备牌),必须独立界版文件。
//
// 实现要点:
//   - 触发时机:进入濒死状态时 after-hook(模块 C 迁移自 陷入濒死;任意角色,含自己)。
//     进入濒死状态时 atom 由系统规则 runDyingFlow 在 陷入濒死 + 不屈检查 之后触发;
//     本 hook 在 runDyingFlow 进入求桃循环前运行,救活后 health>0 → 循环退出。
//   - 重入保护:hook 入口检查 target.health ≤ 0(若已被不屈/涅槃先救活,跳过)。
//   - 选牌:pickTargetCard 同构 UI(装备区明选 + 手牌盲选)。owner 选择目标一张牌。
//   - 判定:选中的牌若 type !== '基本牌',目标弃置此牌 + 回复1体力。
//     若为基本牌,无效果(选择本身是赌博——不展示,只对 owner 揭示后判定)。
//   - 自己濒死也能触发(没有"其他角色"限制),自己选自己的牌。
//   - 多人多补益:每人各自 hook;一旦 target.health > 0,后续 hook 跳过。
//
// 命名:文件名/loader key 为 '界补益';内部 Skill.name = '补益'(OL 官方技能名)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_NAME = '界补益';
const DISPLAY_NAME = '补益';
const CONFIRM_RT = '界补益/confirm'; // 是否发动
const PICK_RT = '界补益/pick'; // 选目标一张牌
const CONFIRM_KEY = '界补益/confirmed';
const PICK_KEY = '选牌/结果'; // 与选牌面板共用 key

const EQUIP_SLOTS = ['武器', '防具', '进攻马', '防御马', '宝物'] as const;

/** 列出濒死目标可选的牌(装备区明牌 + 手牌张数)。 */
function listTargetCards(
  state: GameState,
  target: number,
): {
  equipment: Array<{ slot: string; cardId: string; cardName: string }>;
  handCount: number;
} {
  const tp = state.players[target];
  if (!tp) return { equipment: [], handCount: 0 };
  const equipment = EQUIP_SLOTS.filter((slot) => typeof tp.equipment[slot] === 'string').map(
    (slot) => {
      const cardId = tp.equipment[slot] as string;
      return {
        slot,
        cardId,
        cardName: state.cardMap[cardId]?.name ?? '?',
      };
    },
  );
  return { equipment, handCount: tp.hand.length };
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '当一名角色进入濒死状态时,可选其一张牌;若非基本牌,弃置之并回复1点体力',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理 确认发动 + 选目标牌 两种询问 ──
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
      if (rt !== CONFIRM_RT && rt !== PICK_RT) return '当前不是补益询问';

      if (rt === PICK_RT) {
        const pickAtom = atom as {
          prompt?: { target?: number };
        };
        // PICK 下 atom.target 是选牌者(ownerId),被选牌玩家在 prompt.target 中
        const target = pickAtom.prompt?.target;
        if (typeof target !== 'number') return '目标缺失';
        const tp = st.players[target];
        if (!tp) return '目标不存在';
        const zone = params.zone;
        if (zone === 'equipment') {
          const cid = params.cardId as string | undefined;
          if (typeof cid !== 'string') return 'cardId required';
          const inEquip = EQUIP_SLOTS.some((s) => tp.equipment[s] === cid);
          if (!inEquip) return '该牌不在目标装备区';
        } else if (zone === 'hand') {
          if (typeof params.handIndex !== 'number') return 'handIndex required';
          if (params.handIndex < 0 || params.handIndex >= tp.hand.length)
            return 'handIndex 越界';
        } else {
          return 'zone required (equipment|hand)';
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as Record<string, unknown>)?.requestType as string;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === PICK_RT) {
        st.localVars[PICK_KEY] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
      }
    },
  );

  // ── 进入濒死状态时 after:任一角色濒死,询问是否发动补益(模块 C 迁移自 陷入濒死) ──
  registerAfterHook(state, skill.id, ownerId, '进入濒死状态时', async (ctx) => {
    const atom = ctx.atom;
    if (typeof atom.target !== 'number') return;
    const target = atom.target;
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive) return;
    // 重入保护:若其他技能已把 target 救活(不屈/涅槃),则跳过
    if (targetPlayer.health > 0) return;
    // owner 必须存活
    if (!ctx.state.players[ownerId]?.alive) return;
    // 目标必须至少有一张牌(手牌或装备)
    const { equipment, handCount } = listTargetCards(ctx.state, target);
    if (equipment.length === 0 && handCount === 0) return;

    // 询问是否发动
    delete ctx.state.localVars[CONFIRM_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `补益:是否选择 ${targetPlayer.name} 的一张牌?若非基本牌,弃置之并回复1点体力`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    const confirmed = ctx.state.localVars[CONFIRM_KEY] === true;
    delete ctx.state.localVars[CONFIRM_KEY];
    if (!confirmed) return;

    // 二次检查:target 仍在濒死
    if (ctx.state.players[target]?.health > 0) return;
    // 二次检查:target 仍有牌
    const { equipment: equipmentAfter, handCount: handCountAfter } = listTargetCards(
      ctx.state,
      target,
    );
    if (equipmentAfter.length === 0 && handCountAfter === 0) return;

    // 询问选目标一张牌(装备区明选 + 手牌盲选)
    delete ctx.state.localVars[PICK_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: PICK_RT,
      target: ownerId,
      prompt: {
        type: 'pickTargetCard',
        title: '补益:选择目标一张牌(装备区明选,手牌盲选)',
        target,
        equipment: equipmentAfter,
        judge: [],
        handCount: handCountAfter,
      },
      defaultChoice:
        equipmentAfter.length > 0
          ? ({ zone: 'equipment', cardId: equipmentAfter[0].cardId } as unknown as Json)
          : ({ zone: 'hand', handIndex: 0 } as unknown as Json),
      timeout: 20,
    });

    const result = ctx.state.localVars[PICK_KEY] as
      | { zone: string; cardId: string | null; handIndex: number | null }
      | undefined;
    delete ctx.state.localVars[PICK_KEY];
    if (!result) return;

    // 解析选择 → 拿到具体 cardId
    let pickedCardId: string | undefined;
    if (result.zone === 'equipment') {
      pickedCardId = result.cardId ?? undefined;
    } else if (result.zone === 'hand') {
      const idx = result.handIndex ?? 0;
      pickedCardId = ctx.state.players[target]?.hand[idx];
    }
    if (!pickedCardId) return;

    // 最后校验:牌仍在目标区域
    const tp = ctx.state.players[target];
    const inEquip = EQUIP_SLOTS.some((s) => tp?.equipment[s] === pickedCardId);
    const inHand = tp?.hand.includes(pickedCardId) ?? false;
    if (!inEquip && !inHand) return;

    // 判定:若非基本牌,弃置 + 回复1体力
    const pickedCard = ctx.state.cardMap[pickedCardId];
    if (pickedCard?.type !== '基本牌') {
      await applyAtom(ctx.state, { type: '弃置', player: target, cardIds: [pickedCardId] });
      // 弃置可能触发其他死亡相关副作用,但回复体力本身要求 target.alive=true
      // 此时 target.health ≤ 0,alive 仍 true(击杀 atom 才设 false),回复有效
      await applyAtom(ctx.state, { type: '回复体力', target, amount: 1 });
    }
    // 若为基本牌:无效果(选择本身是公开的,owner 已看到牌型)
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 补益是被动技,没有主动 use action;前端 UI 由 pending prompt 驱动
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '补益',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
