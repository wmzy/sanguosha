// 界刚烈(界夏侯惇·被动技):
//   当一名角色对你造成1点伤害后,你可以判定,若结果为:
//   红色,你对其造成1点伤害;黑色,你弃置其一张牌。
//
// 模式 A(被动触发):after hook 挂在「造成伤害」。
//   造成伤害(target=自己, source 存活) → 判定 →
//     红色(♥/♦) → 界夏侯惇对来源造成 1 点伤害
//     黑色(♠/♣) → 界夏侯惇弃置来源一张牌(手牌/装备/判定区,选牌面板)
//
// 关键点:
//   - 颜色分支用 card.color(红/黑);红色=♥/♦,黑色=♠/♣。与判定花色无关,只看颜色。
//   - 判定结果通过「判定」after hook 在判定牌进弃牌堆前捕获颜色,存 localVars。
//   - 黑色分支:界夏侯惇从来源区域选一张牌弃置,复用 runPickTargetCardPanel
//     (mode='discard',与过河拆桥同款;含判定区)。
//   - 选牌 respond 注册在界夏侯惇座次(ownerId):弃牌发起方是界夏侯惇,
//     dispatch 按 (skillId, ownerId, actionType) 查。
//   - 来源无任何可弃置的牌时跳过(规则:无法弃置则无事发生)。
//   - judgeType='界刚烈' 与标版 '刚烈' 区分(日志/调试用,不影响机制)。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';
import { runPickTargetCardPanel } from './选牌面板';

const PICK_REQUEST = '界刚烈/选牌';
const JUDGE_COLOR_KEY = '界刚烈/judgeColor';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界刚烈',
    description: '受到伤害后判定,红色对其造成1点伤害,黑色弃置其一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 选牌 respond:界夏侯惇从来源区域(手牌/装备/判定)选一张牌弃置 ──
  // 注册在界夏侯惇座次(弃牌发起方);dispatch 按 (skillId, ownerId, actionType) 查。
  const u = registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== PICK_REQUEST) return '当前不是界刚烈选牌';
      // 校验 zone + cardId/handIndex(同过河拆桥/反馈)
      const zone = params.zone;
      if (zone === 'equipment') {
        if (typeof params.cardId !== 'string') return 'cardId required';
      } else if (zone === 'hand') {
        if (typeof params.handIndex !== 'number') return 'handIndex required';
      } else if (zone === 'judge') {
        if (typeof params.cardId !== 'string') return 'cardId required';
      } else {
        return 'zone required (equipment|hand|judge)';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      // 由 选牌面板.ts 的 runPickTargetCardPanel 读取
      st.localVars['选牌/结果'] = {
        zone: params.zone,
        cardId: params.cardId ?? null,
        handIndex: params.handIndex ?? null,
      };
    },
  );

  // ── 判定 after hook:捕获判定牌颜色(判定牌进弃牌堆前)──
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; judgeType?: string; player?: number };
    if (atom.type !== '判定') return;
    if (atom.judgeType !== '界刚烈') return;
    if (atom.player !== ownerId) return;
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;
    ctx.state.localVars[JUDGE_COLOR_KEY] = judgeCard.color;
  });

  // ── 造成伤害 after hook:界刚烈主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; source?: number; amount?: number };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.source === undefined || atom.source === ownerId) return;
    const sourceIdx = atom.source;
    const sourcePlayer = ctx.state.players[sourceIdx];
    if (!sourcePlayer?.alive) return; // 来源必须存活(FAQ)

    // 判定(牌堆空则跳过——无法判定则界刚烈不触发)
    if (ctx.state.zones.deck.length === 0) return;
    delete ctx.state.localVars[JUDGE_COLOR_KEY];
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '界刚烈' });
    const color = ctx.state.localVars[JUDGE_COLOR_KEY] as string | undefined;
    delete ctx.state.localVars[JUDGE_COLOR_KEY];
    if (color === undefined) return; // 判定未产出牌

    if (color === '红') {
      // 红色:对来源造成 1 点伤害(来源为界夏侯惇本人)
      await applyAtom(ctx.state, {
        type: '造成伤害',
        target: sourceIdx,
        amount: 1,
        source: ownerId,
      });
      return;
    }

    // 黑色:界夏侯惇弃置来源一张牌。来源无牌可弃则跳过。
    const source = ctx.state.players[sourceIdx];
    if (!source?.alive) return;
    const hasCards =
      source.hand.length > 0 ||
      Object.keys(source.equipment).length > 0 ||
      source.pendingTricks.length > 0;
    if (!hasCards) return;
    await runPickTargetCardPanel(ctx.state, ownerId, sourceIdx, source, {
      mode: 'discard',
      requestType: PICK_REQUEST,
      title: '界刚烈:选择弃置来源的一张牌',
    });
  });

  return () => {
    u();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  // 实际 prompt(target/equipment/judge/handCount)由运行时 请求回应 atom 提供,
  // 此处仅声明 action 元数据(label/style)供前端按钮渲染与 harness 路由。
  api.defineAction('respond', {
    label: '界刚烈',
    style: 'danger',
    prompt: {
      type: 'pickTargetCard',
      title: '界刚烈:选择弃置来源的一张牌',
      target: -1,
      equipment: [],
      judge: [],
      handCount: 0,
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
