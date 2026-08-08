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
import { applyAtom } from '../index';
import { runUseFlow } from '../core/card-effect/use-card';
import { registerAction, registerAfterHook, type SkillModule } from '../core/skill';

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
 * 执行一次【杀】的完整结算。走 runUseFlow('杀'),与 借刀杀人/乱武 强制出杀一致:
 * 覆盖全部时机(选择目标时→使用时→指定目标→成为目标→指定目标后→成为目标后→
 * 检测有效性→生效前[询问闪]→生效时→生效后[伤害]→使用结算结束时),保证 无双/贞烈/
 * 铁骑/肉林/贯石斧/谦逊 等横切技能正确交互。此前手写实现遗漏了 指定目标后/成为目标后/
 * 生效前/生效时/生效后 等时机,且 被抵消 后未重新检查 cancelled(贯石斧强命失效)。
 * 不计入出杀次数(runUseFlow 不累加 quota,仅 杀.use 主动出杀时累加);
 * 不受距离限制(距离由 杀.use validate 校验,诛害绕过主动出杀入口)。
 * 火杀/雷杀的 damageType 由 杀.resolve 自动传导。
 */
async function runSlashResolution(
  state: GameState,
  source: number,
  target: number,
  cardId: string,
): Promise<void> {
  if (!state.players[target]?.alive) return;
  await runUseFlow(state, source, cardId, [target], '杀');
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
        if (card?.name !== '杀') return '不是杀牌';
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
