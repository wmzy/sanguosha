// 界除疠(界华佗·群雄·主动技,OL 界限突破官方逐字):
//   出牌阶段限一次,你可以选择任意名势力各不相同的其他角色,
//   弃置你和这些角色的各一张牌,然后被弃置黑桃牌的角色各摸一张牌。
//
// 界限突破(相对标版青囊 src/engine/skills/青囊.ts):
//   标版华佗副技能为青囊(弃一牌令一角色回1血);界华佗用除疠替换青囊,
//   改为多目标弃牌+黑桃补偿摸牌机制。
//
// 实现要点:
//   - 限一次:player.vars['界除疠/usedThisTurn'](后端,沿用 /usedThisTurn 后缀由「回合结束」
//     atom 自动清空)+ 回合用量 atom 投影 view.turnUsage(三件套 usedThisTurn/markOncePerTurn/
//     activeUnlessUsedThisTurn)。
//   - 目标校验:1+ 名其他存活角色,势力各不相同(player.faction 字段)。"势力各不相同"
//     约束仅在选定目标之间(self 不参与——"其他角色"已排除 self)。
//   - 自身弃牌:ownerId 手牌或装备区一张(任意花色,由 active player 选择)。
//   - 目标弃牌:engine 用 state.rngSeed 派生 RNG 从目标区域(手牌+装备+判定)等概率抽一张,
//     推进后写回,保证重放确定性。等价于"使用者盲选"(目标手牌对使用者不可见,数字实现用
//     随机替代盲选;装备/判定区虽对使用者可见,本实现不区分明/暗选,统一等概率抽)。
//   - 黑桃补偿:遍历所有被弃的牌(自身+目标),若 suit==='♠',其所有者摸 1 张。
//     owner 由弃置来源确定:自身弃的牌 owner=from,目标弃的牌 owner=该目标。
//   - 时序:所有弃置先发生,然后摸牌补偿——与描述"然后...摸一张牌"一致。
//     反馈/奸雄等"失去牌后"触发型技能会因目标被弃牌而正常触发(个体 弃置 atom 顺序触发)。
//
// 命名:文件名/loader key/character skill name 均为 '界除疠'(避开标版可能的除疠冲突);
//   内部 Skill.name = '除疠'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { createRng } from '../../shared/rng';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

const SKILL_ID = '界除疠';
const DISPLAY_NAME = '除疠';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次,选择任意名势力各不相同的其他角色,弃置你和这些角色的各一张牌,被弃置黑桃牌的角色各摸一张牌',
  };
}

/** 列出玩家区域内所有可弃置的 cardId(手牌 + 装备 + 判定区)。 */
function listDiscardable(state: GameState, player: number): string[] {
  const p = state.players[player];
  if (!p) return [];
  const cards: string[] = [...p.hand];
  for (const id of Object.values(p.equipment)) {
    if (id) cards.push(id);
  }
  if (p.judgeZone) {
    for (const id of p.judgeZone) cards.push(id);
  }
  return cards;
}

/** 用 state.rngSeed 派生 RNG 等概率抽目标区域一张可弃置的牌,推进后写回(保证重放确定性)。 */
function pickRandomCard(state: GameState, player: number): string | null {
  const cards = listDiscardable(state, player);
  if (cards.length === 0) return null;
  const rng = createRng(state.rngSeed);
  const idx = rng.nextInt(cards.length);
  state.rngSeed = rng.getState();
  return cards[idx];
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过除疠';
      const self = st.players[ownerId];
      if (!self?.alive) return '角色不可用';

      // 自身弃一张:任意手牌或装备区
      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string') return 'cardId required';
      const inHand = self.hand.includes(cardId);
      const inEquip = Object.values(self.equipment).includes(cardId);
      if (!inHand && !inEquip) return '牌不在手牌或装备区中';

      // 目标列表:1+ 名其他存活角色,势力各不相同
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets)) return 'targets required';
      if (targets.length === 0) return '至少选择一名目标';

      const seenFactions = new Set<string>();
      for (const t of targets) {
        if (typeof t !== 'number') return '目标必须是数字';
        if (t === ownerId) return '不能以自己为目标';
        const tp = st.players[t];
        if (!tp?.alive) return '目标已死亡';
        if (listDiscardable(st, t).length === 0) return '目标无可弃置的牌';
        const faction = tp.faction ?? '群';
        if (seenFactions.has(faction)) return `势力 ${faction} 已有目标,势力必须各不相同`;
        seenFactions.add(faction);
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const targets = (params.targets as number[]) ?? [];

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入,见制衡.ts)
      await markOncePerTurn(st, from, SKILL_ID);

      await pushFrame(st, SKILL_ID, from, { ...params });

      // 记录所有被弃的牌及其所有者(用于黑桃补偿)
      const discarded: Array<{ cardId: string; owner: number }> = [];

      // 弃置自身一张牌
      await applyAtom(st, { type: '弃置', player: from, cardIds: [cardId] });
      discarded.push({ cardId, owner: from });

      // 对每个目标:随机选一张牌弃置
      for (const t of targets) {
        const picked = pickRandomCard(st, t);
        if (picked === null) continue; // validate 已保证有牌,防御性处理
        await applyAtom(st, { type: '弃置', player: t, cardIds: [picked] });
        discarded.push({ cardId: picked, owner: t });
      }

      // 黑桃补偿:被弃黑桃牌的所有者各摸一张牌
      for (const { cardId: cid, owner } of discarded) {
        const card = st.cardMap[cid];
        if (card?.suit === '♠') {
          await applyAtom(st, { type: '摸牌', player: owner, count: 1 });
        }
      }

      await popFrame(st);
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '除疠:弃你和势力各不相同的其他角色各一张牌,被弃黑桃者各摸一张',
      cardFilter: { min: 1, max: 1 },
      // 前端只过滤"其他存活角色";势力各不相同由后端 validate 强制(UI 提示无法跨选项目校验)
      targetFilter: {
        min: 1,
        max: 99,
        filter: (view, target) => {
          if (target === view.currentPlayerIndex) return false;
          const tp = view.players.find((p) => p.index === target);
          if (!tp || tp.alive === false) return false;
          return true;
        },
      },
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn(SKILL_ID)(ctx),
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
