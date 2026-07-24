// 界仁心(界曹冲·被动技,OL 界限突破官方逐字):
//   "当一名其他角色进入濒死时,你可以弃置一张装备牌并翻面,
//    然后令其回复至1点体力。"
//
// 与标版曹冲 仁心 的区别(标版未实现;基于官方描述对比):
//   - 标版:"当体力值为1的其他角色受到伤害时,你可以弃置一张装备牌并翻面,
//     然后防止此伤害。"——触发时机=体力1者受伤;效果=防止伤害。
//   - 界版:触发时机=其他角色进入濒死;效果=令其回复至1体力。机制完全不同,
//     必须独立界版文件。
//
// 实现要点:
//   - 触发时机:陷入濒死 after-hook(target ≠ ownerId, target.health ≤ 0)。
//     陷入濒死 atom 由系统规则 runDyingFlow 在 造成伤害/失去体力 后触发;
//     本 hook 在 runDyingFlow 进入求桃循环前运行,救活后 health>0 → 循环退出。
//   - 前置检查:仁心 owner 持有至少一张装备牌(手牌或装备区),否则跳过询问。
//   - 弃置装备牌:接受 cardId 参数,validate 校验 cardId 在 owner 手牌或装备区,
//     且 card.type==='装备牌'。弃置 atom 同时处理手牌/装备区移除与系统规则的卸技能副作用。
//   - 翻面:加 '仁心/翻面' 标签,与据守/放逐/悲歌同机制——下一回合 阶段开始(准备)
//     before-hook 消费标签 + 设 skipAll 标志 + cancel 阶段;阶段结束(准备) before-hook
//     亲自推进回合把回合交给下家。tag 名独立,与其他翻面技能互不干扰。
//   - 回复至1体力:applyAtom(回复体力, target, amount=1-target.health)。target.health 此刻 ≤0,
//     amount ≥ 1;回复后 runDyingFlow 的 health>0 检查命中,跳过求桃与击杀。
//   - 重入安全:hook 入口再次检查 target.health ≤ 0(若已被不屈/涅槃等先救活,则跳过)。
//   - 多人多仁心:每人各自 hook;一旦 target.health > 0,后续 hook 跳过。
//
// 命名:文件名/loader key 为 '界仁心';内部 Skill.name = '仁心'(OL 官方技能名)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { flipFaceDown, flipFaceUp, performSkipTurn } from '../face-down';
import { registerAction, registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';

const SKILL_ID = '界仁心';
const DISPLAY_NAME = '仁心';
/** localVars 键:玩家是否发动(confirm) */
const CONFIRMED_KEY = '仁心/confirmed';
/** localVars 键:玩家弃置的装备牌 cardId */
const CARD_CHOICE_KEY = '仁心/cardChoice';
/** player.tags 键:翻面标签(下一回合开始时消费) */
const FLIP_TAG = '仁心/翻面';
/** localVars 键:skip-all 标志(值为玩家座次) */
const SKIP_FLAG = '仁心/skipAll';

/** 装备牌判定 */
function isEquipmentCard(card: { type?: string } | undefined): boolean {
  return !!card && card.type === '装备牌';
}

/** 列出 owner 所有可弃置的装备牌 cardId(手牌 + 装备区) */
function listEquipmentChoices(state: GameState, ownerId: number): string[] {
  const result: string[] = [];
  const player = state.players[ownerId];
  if (!player) return result;
  for (const cid of player.hand) {
    if (isEquipmentCard(state.cardMap[cid])) result.push(cid);
  }
  for (const slot of ['武器', '防具', '进攻马', '防御马', '宝物'] as const) {
    const cid = player.equipment[slot];
    if (cid && isEquipmentCard(state.cardMap[cid])) result.push(cid);
  }
  return result;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '其他角色进入濒死时,可弃置一张装备牌并翻面,令其回复至1点体力',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:处理 确认发动 + 选装备牌 两种询问 ──
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
      if (rt !== '仁心/confirm' && rt !== '仁心/selectCard') return '当前不是仁心询问';

      if (rt === '仁心/selectCard') {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张装备牌';
        const valid = listEquipmentChoices(st, ownerId);
        if (!valid.includes(cardId)) return '该牌不是你可弃置的装备牌';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as Record<string, unknown>)?.requestType as string;
      if (rt === '仁心/confirm') {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === '仁心/selectCard') {
        const cid = params.cardId as string | undefined;
        if (typeof cid === 'string') st.localVars[CARD_CHOICE_KEY] = cid;
      }
    },
  );

  // ── 陷入濒死 after:其他角色濒死,询问是否发动仁心 ──
  registerAfterHook(state, skill.id, ownerId, '陷入濒死', async (ctx) => {
    const atom = ctx.atom;
    if (typeof atom.target !== 'number') return;
    const target = atom.target;
    if (target === ownerId) return; // 自己濒死不触发
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive) return;
    // 重入保护:若其他技能已把 target 救活(不屈/涅槃),则跳过
    if (targetPlayer.health > 0) return;
    // owner 必须存活
    if (!ctx.state.players[ownerId]?.alive) return;
    // 必须持有装备牌
    const choices = listEquipmentChoices(ctx.state, ownerId);
    if (choices.length === 0) return;

    // 询问是否发动
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '仁心/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `仁心:是否弃置一张装备牌并翻面,令 ${targetPlayer.name} 回复至1点体力?`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    const confirmed = ctx.state.localVars[CONFIRMED_KEY] === true;
    delete ctx.state.localVars[CONFIRMED_KEY];
    if (!confirmed) return;

    // 二次检查:target 仍在濒死(owner 在等待期间未被改命)
    if (ctx.state.players[target]?.health > 0) return;
    // 二次检查:owner 仍有装备牌可弃
    const choicesAfter = listEquipmentChoices(ctx.state, ownerId);
    if (choicesAfter.length === 0) return;

    // 询问选装备牌(若有多个候选)
    let chosenId: string | undefined;
    if (choicesAfter.length === 1) {
      chosenId = choicesAfter[0];
    } else {
      delete ctx.state.localVars[CARD_CHOICE_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: '仁心/selectCard',
        target: ownerId,
        prompt: {
          type: 'pickProcessingCard',
          title: '仁心:选择一张装备牌弃置',
          cards: choicesAfter.map((cid) => {
            const c = ctx.state.cardMap[cid];
            return {
              cardId: cid,
              cardName: c?.name ?? cid,
              suit: (c?.suit ?? '') as never,
              rank: c?.rank ?? '',
            };
          }),
        },
        defaultChoice: choicesAfter[0],
        timeout: 20,
      });
      chosenId = ctx.state.localVars[CARD_CHOICE_KEY] as string | undefined;
      delete ctx.state.localVars[CARD_CHOICE_KEY];
      if (typeof chosenId !== 'string') chosenId = choicesAfter[0];
      // 最后校验
      if (!listEquipmentChoices(ctx.state, ownerId).includes(chosenId)) return;
    }

    // 1) 弃置该装备牌(同时清手牌/装备区,系统规则的弃置 after-hook 会移除装备技能)
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [chosenId] });

    // 2) 翻面:加标签(下一回合开始时消费)
    await flipFaceDown(ctx.state, ownerId, '仁心');

    // 3) 令 target 回复至 1 体力(此时 health ≤ 0,amount = 1 - health ≥ 1)
    const cur = ctx.state.players[target]?.health ?? 0;
    const amount = Math.max(1, 1 - cur);
    await applyAtom(ctx.state, { type: '回复体力', target, amount });
  });

  // ── 翻面:下一回合跳过(机制同据守/放逐/神速) ────────────────
  // 检测翻面标签 → 移除标签 + 设 skipAll 标志 + cancel(不进入准备阶段)
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    const self = ctx.state.players[ownerId];

    // 入口:准备阶段开始 + 翻面标签 → 启动跳过
    if (atom.phase === '准备' && self?.tags.includes(FLIP_TAG)) {
      await flipFaceUp(ctx.state, ownerId, '仁心');
      ctx.state.localVars[SKIP_FLAG] = ownerId;
      const result: HookResult = { kind: 'cancel' };
      return result;
    }

    // skipAll 标志存在时,取消所有其他阶段(防止 phase-end after-hook 推进产生副作用)
    if (ctx.state.localVars[SKIP_FLAG] === ownerId) {
      const result: HookResult = { kind: 'cancel' };
      return result;
    }
  });

  // ── 翻面:阶段结束(准备) before-hook,主动推进回合 ────────
  // skipAll 标志存在时:清除标志 + 亲自执行 end-turn 序列把回合交给下家。
  // (与据守/神速一致:cancel 阶段结束原子以防 phase-end after-hook 推进产生幻影阶段链)
  registerBeforeHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段结束') return;
    if (atom.player !== ownerId) return;
    if (ctx.state.localVars[SKIP_FLAG] !== ownerId) return;

    // 清除 skipAll 标志(后续不再 skip)
    delete ctx.state.localVars[SKIP_FLAG];

    // 亲自执行 end-turn 序列:清过期标记 → 下一玩家 → 回合结束
    await performSkipTurn(ctx.state, ownerId);

    const result: HookResult = { kind: 'cancel' };
    return result;
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动仁心?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
