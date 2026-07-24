// 界诛害(界徐庶·蜀·被动技,OL 界限突破 hero/304 官方逐字):
//   其他角色的结束阶段，若其本回合造成过伤害，你可以对其使用一张【杀】。
//
// 实现要点:
//   - 触发: 阶段开始(phase='回合结束') after-hook, player !== ownerId
//     (官方"其他角色的结束阶段" = 其他玩家进入自己回合结束阶段的瞬间)
//   - 条件 1: 该 player 本回合造成过伤害
//     追踪方式: 造成伤害 after-hook 在 source 玩家上记录 turn.vars[`界诛害/source/${source}`]=true;
//     turn.vars 由「回合结束」atom 自动清空 → 自动按回合隔离。
//   - 条件 2: ownerId 手牌中有【杀】(否则无法发动)
//   - 询问链:
//       1) confirm: 是否发动诛害?
//       2) useCard: 选一张杀(cardFilter name='杀')
//   - 执行: 真实【杀】结算(指定目标→成为目标→检测有效性→询问闪→被抵消/造成伤害→收尾)
//     诛害的杀不计入出杀次数(回合外触发,与杀/quota 无关),也不受距离限制
//     (FAQ: 诛害作为强制触发对结束阶段玩家使用,无视距离)。
//
// 命名:文件名/loader key/character skill name 均为 '界诛害'(避开与未来标版冲突);
//   内部 Skill.name = '诛害'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { runDamageFlow } from '../damage-flow';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界诛害';
const DISPLAY_NAME = '诛害';

/** 询问 RT:是否发动诛害(confirm) */
const TRIGGER_RT = '界诛害/trigger';
/** 询问 RT:选一张杀(useCard) */
const PICK_RT = '界诛害/pickKill';
/** localVars key:confirm 结果(true/false) */
const CONFIRM_KEY = '界诛害/confirmed';
/** localVars key:玩家选择的杀 cardId */
const PICK_KEY = '界诛害/killCardId';

/** 在 turn.vars 上记录某座次本回合是否造成过伤害(key 后缀不含 /usedThisTurn,但 turn.vars 整体在
 *  「回合结束」atom apply 时清空,故仍按回合隔离)。 */
function damageDealtKey(player: number): string {
  return `${SKILL_ID}/source/${player}`;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '其他角色的结束阶段,若其本回合造成过伤害,你可以对其使用一张【杀】',
  };
}

/** 检查 ownerId 手牌中是否有【杀】 */
function hasKillInHand(state: GameState, ownerId: number): boolean {
  const hand = state.players[ownerId]?.hand ?? [];
  return hand.some((id) => state.cardMap[id]?.name === '杀');
}

/**
 * 执行一次【杀】的完整结算(指定目标→成为目标→检测有效性→询问闪→伤害/抵消)。
 * 真实杀牌:移动到处理区→结算末尾入弃牌堆。不计入出杀次数(回合外触发)。
 * 无距离限制(诛害特例)。
 */
async function runSlashResolution(
  state: GameState,
  source: number,
  target: number,
  cardId: string,
): Promise<void> {
  if (!state.players[target]?.alive) return;
  const damageType = state.cardMap[cardId]?.damageType;
  const frame = await pushFrame(state, '诛害', source, { target, cardId });
  try {
    // 杀牌进处理区
    await applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: source },
      to: { zone: '处理区' },
    });

    // 指定目标 + 成为目标
    await applyAtom(state, { type: '指定目标', source, target, cardId });
    const becameTarget = await applyAtom(state, { type: '成为目标', source, target, cardId });
    if (!becameTarget) {
      // 目标不合法(如空城):收尾,杀牌入弃牌堆
      return;
    }
    const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
    if (!valid) return;

    // 询问闪
    await applyAtom(state, { type: '询问闪', target, source });

    // 闪走 runUseFlow → resolve 设本帧 cancelled=true；闪牌已自动入弃牌堆。
    if (frame.cancelled) {
      await applyAtom(state, { type: '被抵消', source, target, cardId });
    } else if (state.players[target]?.alive) {
      await runDamageFlow(state, source, target, 1, cardId, damageType);
    }
  } finally {
    // 收尾:杀牌入弃牌堆(若仍滞留处理区)
    if (frameCards(state).includes(cardId)) {
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }
    void frame;
    await popFrame(state);
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:处理 confirm + 选杀 两种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== TRIGGER_RT && rt !== PICK_RT) return '当前不是诛害询问';
      if (rt === PICK_RT) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '需要选择一张杀';
        const card = st.cardMap[cardId];
        if (!card || card.name !== '杀') return '不是杀牌';
        if (!st.players[ownerId]?.hand.includes(cardId)) return '杀不在你的手牌中';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === TRIGGER_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true;
      } else if (rt === PICK_RT) {
        const cardId = params.cardId as string;
        st.localVars[PICK_KEY] = cardId;
      }
    },
  );

  // ── 造成伤害 after-hook:在 turn.vars 记录本回合造成过伤害的玩家 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
    const atom = ctx.atom;
    const source = atom.source;
    if (typeof source !== 'number') return;
    if ((atom.amount ?? 0) <= 0) return;
    ctx.state.turn.vars[damageDealtKey(source)] = true;
  });

  // ── 阶段开始(回合结束) after-hook:诛害主逻辑 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.phase !== '回合结束') return;
      const player = atom.player;
      if (typeof player !== 'number') return;
      if (player === ownerId) return; // 其他角色的结束阶段

      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 条件 1:该玩家本回合造成过伤害
      if (ctx.state.turn.vars[damageDealtKey(player)] !== true) return;

      // 条件 2:ownerId 手牌中有杀
      if (!hasKillInHand(ctx.state, ownerId)) return;

      // 询问 1:是否发动诛害
      delete ctx.state.localVars[CONFIRM_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `诛害:是否对 ${ctx.state.players[player]?.name ?? `P${player}`} 使用一张杀?`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[CONFIRM_KEY] !== true) {
        delete ctx.state.localVars[CONFIRM_KEY];
        return;
      }
      delete ctx.state.localVars[CONFIRM_KEY];

      // 再次检查目标存活(可能在 confirm 期间状态变化)
      if (!ctx.state.players[player]?.alive) return;

      // 询问 2:选一张杀
      delete ctx.state.localVars[PICK_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: PICK_RT,
        target: ownerId,
        prompt: {
          type: 'useCard',
          title: '诛害:选择一张杀',
          cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
        },
        timeout: 15,
      });
      const killCardId = ctx.state.localVars[PICK_KEY] as string | undefined;
      delete ctx.state.localVars[PICK_KEY];
      if (typeof killCardId !== 'string') return;
      // 最终校验:杀仍在手牌、目标仍存活
      if (!ctx.state.players[ownerId]?.hand.includes(killCardId)) return;
      if (!ctx.state.players[player]?.alive) return;

      // 执行杀结算
      await runSlashResolution(ctx.state, ownerId, player, killCardId);
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '是否发动诛害?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
