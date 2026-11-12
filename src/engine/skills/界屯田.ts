// 界屯田(界邓艾·被动技):当你于回合外失去牌后,或于回合内弃置【杀】后,
//   你可以判定,若不为♥,将判定牌置于武将牌上称为"田";
//   每有一张田,你与其他角色的距离 -1。
//
// 与标版屯田唯一差异:触发条件。
//   标版邓艾:仅"回合外失去牌"触发
//   界邓艾:额外在"回合内弃置杀"时触发(仅弃置杀,其他牌型不触发)
//
// 实现复用标版(屯田.ts 导出的共享逻辑):respond 注册、「判定牌生效后」hook
//   (非红桃收牌+加田+距离修正)、询问+判定核心、回合外失去牌 hook(获得/移动牌/给予)。
//   本文件只保留界版差异:CONFIRM_RT 前缀、询问标题(无"回合外"字样)、弃置路径分支。
//
// 田的存储/距离修正等不变量见 屯田.ts 头注。
import type { FrontendAPI, GameState, Skill } from '../types';
import { registerAfterHook } from '../core/skill';
import {
  askAndJudgeTunTian,
  registerTianJudgeAfterHook,
  registerTunTianConfirmRespond,
  registerTunTianLossHooks,
  triggerTunTianOutOfTurn,
} from './屯田';

const CONFIRM_RT = '界屯田/confirm';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界屯田',
    description:
      '回合外失去牌或回合内弃置杀时判定,非红桃则置于武将牌上为田,每张田与其他角色距离 -1',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const title = (lossAtomType: string) => `是否发动屯田?(因${lossAtomType}失去牌,判定可能获得田)`;

  // ── respond:界邓艾回应是否发动屯田(标/界共用注册) ──
  registerTunTianConfirmRespond(state, skill.id, ownerId, CONFIRM_RT);

  // ── 判定牌生效后 hook(标/界共用):非红桃判定牌收作"田" + 距离修正 ──
  registerTianJudgeAfterHook(state, skill.id, ownerId);

  // ── 回合外失去牌路径(获得/移动牌/给予,标/界共用) ──
  registerTunTianLossHooks(state, skill.id, ownerId, CONFIRM_RT, title);

  // ── 弃置 after:界邓艾被弃牌 ──
  //   界版变化:回合内弃置杀时也触发(标版仅回合外)
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '弃置') return;
    if (atom.player !== ownerId) return;

    if (ctx.state.currentPlayerIndex === ownerId) {
      // 界版:回合内仅当弃置的牌含【杀】时触发
      const cardIds = atom.cardIds ?? [];
      const hasSha = cardIds.some((id) => ctx.state.cardMap[id]?.name === '杀');
      if (!hasSha) return;
      await askAndJudgeTunTian(ctx, ownerId, CONFIRM_RT, title('回合内弃置杀'));
    } else {
      // 标版:回合外任何弃置都触发
      await triggerTunTianOutOfTurn(ctx, ownerId, CONFIRM_RT, title('弃置'));
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界屯田',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动屯田?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
