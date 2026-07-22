// 界刚烈(界夏侯惇·被动技):
//   当一名角色对你造成1点伤害后,你可以判定,若结果为:
//   红色,你对其造成1点伤害;黑色,你弃置其一张牌。
//   受到 N 点伤害时触发 N 次,每次独立询问 + 独立判定。
//
// 模式 A(被动触发):after hook 挂在「造成伤害」。
//   造成伤害(target=自己, source 存活, amount=N) → 循环 N 次:
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

const CONFIRM_REQUEST = '界刚烈/confirm';
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
      const requestType = atom['requestType'] as string;
      if (requestType === CONFIRM_REQUEST) return null; // 是否发动
      if (requestType !== PICK_REQUEST) return '当前不是界刚烈回应';
      // 选牌:校验 zone + cardId/handIndex(同过河拆桥/反馈)
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
      const slot = st.pendingSlots.get(ownerId);
      const requestType = (slot?.atom as Record<string, unknown> | undefined)?.['requestType'] as
        | string
        | undefined;
      if (requestType === CONFIRM_REQUEST) {
        st.localVars['界刚烈/confirmed'] = params.choice === true;
        return;
      }
      // PICK_REQUEST: 由 选牌面板.ts 的 runPickTargetCardPanel 读取
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
  // 规则:"当一名角色对你造成1点伤害后" —— 受到 N 点伤害时触发 N 次,
  // 每次独立询问是否发动 + 独立判定。来源中途死亡则停止后续触发。
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; source?: number; amount?: number };
    if (atom.target !== ownerId) return;
    const times = atom.amount ?? 0;
    if (times <= 0) return;
    if (atom.source === undefined || atom.source === ownerId) return;
    const sourceIdx = atom.source;

    for (let i = 0; i < times; i++) {
      const sourcePlayer = ctx.state.players[sourceIdx];
      if (!sourcePlayer?.alive) break; // 来源死亡,后续不再触发
      // 牌堆空则无法判定,跳过
      if (ctx.state.zones.deck.length === 0) break;

      // 询问是否发动界刚烈(不是锁定技,可选择不发动)
      delete ctx.state.localVars['界刚烈/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动界刚烈?(第 ${i + 1}/${times} 点伤害)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars['界刚烈/confirmed']) continue; // 本次不发动,继续下一次

      delete ctx.state.localVars[JUDGE_COLOR_KEY];
      await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '界刚烈' });
      const color = ctx.state.localVars[JUDGE_COLOR_KEY] as string | undefined;
      delete ctx.state.localVars[JUDGE_COLOR_KEY];
      if (color === undefined) continue; // 判定未产出牌

      if (color === '红') {
        // 红色:对来源造成 1 点伤害(来源为界夏侯惇本人)
        await applyAtom(ctx.state, {
          type: '造成伤害',
          target: sourceIdx,
          amount: 1,
          source: ownerId,
        });
        continue;
      }

      // 黑色:界夏侯惇弃置来源一张牌。来源无牌可弃则跳过本轮。
      const source = ctx.state.players[sourceIdx];
      if (!source?.alive) break;
      const hasCards =
        source.hand.length > 0 ||
        Object.keys(source.equipment).length > 0 ||
        source.pendingTricks.length > 0;
      if (!hasCards) continue;
      await runPickTargetCardPanel(ctx.state, ownerId, sourceIdx, source, {
        mode: 'discard',
        requestType: PICK_REQUEST,
        title: '界刚烈:选择弃置来源的一张牌',
      });
    }
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
