// 界樵拾(界夏侯氏·被动技,OL 界限突破官方逐字):
//   每个结束阶段，你可以与当前回合角色各摸一张牌。然后若其与你手牌数不相等，此技能本轮失效。
//
// 界限突破(相对标樵拾,标版未实现):
//   1. 标版:其他角色的结束阶段,若你与其手牌数相等,你可以与其各摸一张牌。
//   2. 界版:每个结束阶段(含自己),无前置条件;你可以与当前回合角色各摸一张牌。
//      摸完后若两者手牌数不相等,此技能本轮(本回合一圈)失效。
//
// 实现要点:
//   - 触发时机:阶段开始 after-hook(phase='回合结束' = 结束阶段)。
//     任意玩家的结束阶段都触发(官方"每个结束阶段"含自己;标版仅"其他角色")。
//   - 同一玩家(自己==当前回合角色):各摸一张 → 实际只摸一张(描述"各摸一张"在双方指
//     同一人时按一次计;且此时其后置"手牌数不相等"必为 false,自然不会失效)。
//   - 本轮失效:用 state.localVars[`界樵拾/disabledRound/${ownerId}`] 记录失效的轮次号,
//     与 state.turn.round 比对,同轮则跳过;新轮自动恢复(无需清理 localVars)。
//   - 非锁定技(描述以"你可以"开头):受 界铁骑/义绝 非锁定技压制影响。
//
// 命名:文件名/loader key/character skill name 均为 '界樵拾'(避开标版冲突);
//   内部 Skill.name = '樵拾'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界樵拾';
const DISPLAY_NAME = '樵拾';

/** 询问 requestType:是否发动樵拾 */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
/** localVars key:owner 是否确认发动(true/false) */
const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;
/** localVars key:owner 技能本轮失效的轮次号(number)。与 state.turn.round 比对。 */
const DISABLED_KEY = (ownerId: number) => `${SKILL_ID}/disabledRound/${ownerId}`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '每个结束阶段,你可以与当前回合角色各摸一张牌;然后若其与你手牌数不相等,此技能本轮失效',
  };
}

/** 本轮是否已失效(同轮返回 true,新轮自动恢复)。 */
function isDisabledThisRound(state: GameState, ownerId: number): boolean {
  return state.localVars[DISABLED_KEY(ownerId)] === state.turn.round;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:owner 在「樵拾/confirm」询问下的选择(choice=true/false) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CONFIRM_RT) return '当前不是樵拾确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 阶段开始(回合结束 = 结束阶段) after-hook:任意玩家的结束阶段都触发 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '回合结束') return; // 结束阶段 = engine phase '回合结束'
    const currentPlayer = atom.player;
    if (typeof currentPlayer !== 'number') return;

    const st = ctx.state;
    const self = st.players[ownerId];
    if (!self?.alive) return; // owner 死亡:不触发
    const turnPlayer = st.players[currentPlayer];
    if (!turnPlayer?.alive) return; // 当前回合角色死亡:不触发

    // 本轮失效校验
    if (isDisabledThisRound(st, ownerId)) return;

    // 询问是否发动(非锁定技,默认不发动)
    delete st.localVars[CONFIRMED_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动樵拾?(你与当前回合角色各摸一张牌;若手牌数不相等,本轮失效)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });

    if (!st.localVars[CONFIRMED_KEY]) return;
    delete st.localVars[CONFIRMED_KEY];

    // 各摸一张:owner + 当前回合角色(若同一人,只摸一张)
    await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
    if (currentPlayer !== ownerId) {
      // 期间可能死亡(无懈链/反馈等);逐 atom 后再校验存活
      if (st.players[currentPlayer]?.alive) {
        await applyAtom(st, { type: '摸牌', player: currentPlayer, count: 1 });
      }
    }

    // 后置:若两者手牌数不相等,本轮失效(此时若 owner 已死,直接置失效无副作用)
    const ownerHand = st.players[ownerId]?.hand.length ?? 0;
    const turnHand = st.players[currentPlayer]?.hand.length ?? 0;
    if (ownerHand !== turnHand) {
      st.localVars[DISABLED_KEY(ownerId)] = st.turn.round;
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动樵拾?(你与当前回合角色各摸一张牌;若手牌数不相等,本轮失效)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
