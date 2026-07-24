// 界雷击(界张角·被动触发,OL 界限突破官方逐字):
//   当你使用或打出【闪】或使用【闪电】时,你可以判定。
//   当你判定后,若结果为:
//     黑桃,你可以对一名角色造成2点雷电伤害;
//     梅花,你回复1点体力并可以对一名角色造成1点雷电伤害。
//
// 界限突破(相对标雷击 src/engine/skills/雷击.ts):
//   1. 标雷击:触发仅限"使用或打出【闪】";界雷击新增"使用【闪电】"触发路径。
//   2. 标雷击:令"一名其他角色"判定(判定目标=伤害目标,判定前选定);
//      界雷击:自己判定(判定目标=自己),判定后根据结果选伤害目标(可选,含自己)。
//   3. 标雷击伤害目标固定为判定目标;界雷击解耦:判定目标始终是自己,
//      伤害目标在判定结果出来后选择(可选择任意存活角色,包括自己;也可放弃)。
//   4. 两个分支均用"可以"(可选):黑桃分支可放弃造伤;梅花分支必回血但可放弃造伤。
//
// 触发时机:
//   A. 「询问闪」atom 的 after hook —— 界张角(target=ownerId)被询问闪且实际打出了闪
//      (同标雷击路径)。
//   B. 「添加延时锦囊」atom 的 after hook —— 界张角对自己使用【闪电】
//      (atom.player===ownerId 且 atom.trick.name==='闪电' 且 atom.trick.source===ownerId)。
//      闪电传递(判定未命中后传给下家)时 source=当前判定者≠自己,不触发。
//
// 判定结果读取:判定 atom 的 afterHooks(含界鬼道替换)把最终判定牌移入弃牌堆顶后读取。
//
// 命名:文件名/loader key/character skill name 均为 '界雷击';
//   内部 Skill.name = '雷击'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { runJudgeFlow } from '../judge-flow';
import { runDamageFlow } from '../damage-flow';
import { registerAction, registerAfterHook } from '../skill';
import { isCancelled } from '../card-effect/registry';

const SKILL_ID = '界雷击';
const DISPLAY_NAME = '雷击';
/** 是否发动判定(yes/no) */
const JUDGE_RT = '界雷击/judge';
const JUDGE_KEY = '界雷击/judgeChoice';
/** 选择雷电伤害目标(或放弃) */
const TARGET_RT = '界雷击/target';
const TARGET_KEY = '界雷击/target';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '使用/打出【闪】或使用【闪电】时可判定;黑桃可对一名角色造成2点雷电伤害;梅花回复1点体力并可对一名角色造成1点雷电伤害',
  };
}

/** 询问界张角选择雷电伤害目标(或放弃)。返回目标座次,放弃返回 null。 */
async function chooseDamageTarget(state: GameState, ownerId: number): Promise<number | null> {
  delete state.localVars[TARGET_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '界雷击:选择雷电伤害目标(或放弃)',
      min: 1,
      max: 1,
      filter: (view, t) => view.players[t]?.alive === true,
    },
    timeout: 20,
  });

  const t = state.localVars[TARGET_KEY];
  delete state.localVars[TARGET_KEY];
  return typeof t === 'number' ? t : null;
}

/** 界雷击完整流程:询问判定 → 判定自己 → 读结果 → 按花色分支造伤/回血。 */
async function run雷击Flow(state: GameState, ownerId: number, triggerDesc: string): Promise<void> {
  const me = state.players[ownerId];
  if (!me?.alive) return;

  // ── 步骤 1:询问是否判定 ──────────────────────────────
  delete state.localVars[JUDGE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: JUDGE_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: `界雷击:是否判定?(${triggerDesc})`,
      confirmLabel: '判定',
      cancelLabel: '不判定',
    },
    defaultChoice: false,
    timeout: 20,
  });

  const judgeChoice = state.localVars[JUDGE_KEY];
  delete state.localVars[JUDGE_KEY];
  if (judgeChoice !== true) return; // 放弃发动

  // ── 步骤 2:判定自己(界鬼道可在判定改判阶段替换判定牌) ──
  await runJudgeFlow(state, ownerId, DISPLAY_NAME);

  // ── 步骤 3:读判定结果(弃牌堆顶=最终判定牌,经界鬼道替换即为替换牌) ──
  const dp = state.zones.discardPile;
  if (dp.length === 0) return;
  const judgeCardId = dp[dp.length - 1];
  const judgeCard = state.cardMap[judgeCardId];
  if (!judgeCard) return;

  // ── 步骤 4:按花色分支 ────────────────────────────────
  if (judgeCard.suit === '♠') {
    // 黑桃 → 可对一名角色造成2点雷电伤害
    const target = await chooseDamageTarget(state, ownerId);
    if (target === null) return; // 放弃造伤
    // 二次校验
    if (!state.players[target]?.alive) return;
    await runDamageFlow(state, ownerId, target, 2, undefined, '雷电');
  } else if (judgeCard.suit === '♣') {
    // 梅花 → 回复1点体力(满血不浪费),然后可对一名角色造成1点雷电伤害
    const self = state.players[ownerId];
    if (self && self.health < self.maxHealth) {
      await applyAtom(state, {
        type: '回复体力',
        target: ownerId,
        amount: 1,
      });
    }
    const target = await chooseDamageTarget(state, ownerId);
    if (target === null) return; // 放弃造伤(回血已生效)
    if (!state.players[target]?.alive) return;
    await runDamageFlow(state, ownerId, target, 1, undefined, '雷电');
  }
  // 其他花色 → 无效果
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── respond:处理两种询问(判定 yes/no + 选伤害目标) ───────
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as unknown as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;

      if (rt === JUDGE_RT) {
        // yes/no:confirmed true/false 均合法
        return null;
      }
      if (rt === TARGET_RT) {
        // 选择目标:存活角色(任意角色,可含自己);target 为 undefined = 放弃
        const target = params.target;
        if (typeof target === 'number') {
          const p = st.players[target];
          if (!p?.alive) return '目标不存在或已死亡';
        }
        return null;
      }
      return '当前不是界雷击询问';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return;
      const atom = slot.atom as unknown as { requestType?: string };
      if (atom.requestType === JUDGE_RT) {
        st.localVars[JUDGE_KEY] = params.confirmed === true;
      } else if (atom.requestType === TARGET_RT) {
        const target = params.target;
        st.localVars[TARGET_KEY] = typeof target === 'number' ? target : null;
      }
    },
  );

  // ─── 触发 A:询问闪 after hook(界张角打出闪后触发) ───────────
  registerAfterHook(state, skill.id, ownerId, '询问闪', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '询问闪') return;
    if (atom.target !== ownerId) return;

    const me = ctx.state.players[ownerId];
    if (!me?.alive) return;

    // 检查界张角是否实际打出了闪（闪走 runUseFlow 已入弃牌堆，杀帧 cancelled=true 表示出了闪）
    if (!isCancelled(ctx.state, (ctx.frame.params.cardId as string) ?? '', ownerId)) return;

    await run雷击Flow(ctx.state, ownerId, '已使用/打出闪');
  });

  // ─── 触发 B:添加延时锦囊 after hook(界张角使用闪电后触发) ────
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '添加延时锦囊',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '添加延时锦囊') return;
      // 仅当界张角对自己使用闪电(自己判定区放置闪电,且 source 是自己)
      if (atom.player !== ownerId) return;
      if (atom.trick?.name !== '闪电') return;
      if (atom.trick?.source !== ownerId) return;

      const me = ctx.state.players[ownerId];
      if (!me?.alive) return;

      await run雷击Flow(ctx.state, ownerId, '已使用闪电');
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'choosePlayer',
      title: '界雷击:选择雷电伤害目标(或放弃)',
      min: 1,
      max: 1,
      filter: (view, t) => view.players[t]?.alive === true,
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
