// 仁德(刘备) — 标准版/国战版:
//   出牌阶段,可以将任意数量手牌交给其他角色;以此法失去第二张牌时,回复 1 点体力。
//   无发动次数限制(可多次使用,但回血每回合仅一次)。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '仁德',
    description: '出牌阶段:将任意张手牌交给其他角色;以此法失去第二张牌时回复1点体力',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0;
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      // 仁德有三种调用格式:
      // 1. 分配格式(distribute UI 提交): params.allocation = [{target, cardIds}](多牌多目标)
      // 2. 分配格式(旧): params.targets = [{target, cardIds}]
      // 3. 简单格式(前端 handlePlayCard): params.cardId + params.targets=[idx](单牌单目标)
      const allocParam = params.allocation as Array<{ target: number; cardIds: string[] }> | undefined;
      const allocTargets = params.targets as Array<{ target: number; cardIds: string[] }> | undefined;
      const simpleCardId = params.cardId as string | undefined;
      const simpleTargets = params.targets as number[] | undefined;
      // 统一为分配格式
      let normalized: Array<{ target: number; cardIds: string[] }>;
      if (Array.isArray(allocParam) && allocParam.length > 0 && Array.isArray(allocParam[0].cardIds)) {
        normalized = allocParam;
      } else if (Array.isArray(allocTargets) && allocTargets.length > 0 && Array.isArray(allocTargets[0].cardIds)) {
        normalized = allocTargets;
      } else if (simpleCardId && Array.isArray(simpleTargets) && simpleTargets.length > 0) {
        normalized = [{ target: simpleTargets[0], cardIds: [simpleCardId] }];
      } else {
        return '需要指定牌和目标';
      }
      const hasCards = normalized.reduce((n, t) => n + t.cardIds.length, 0) > 0;
      // 收集所有 cardId 检查重复 + 都在手牌
      const allCardIds: string[] = [];
      let noDuplicates = true;
      let allInHand = true;
      if (hasCards) {
        for (const t of normalized) {
          if (!Array.isArray(t.cardIds)) { allInHand = false; continue; }
          for (const cardId of t.cardIds) {
            if (allCardIds.includes(cardId)) { noDuplicates = false; }
            allCardIds.push(cardId);
            if (!self?.hand.includes(cardId)) { allInHand = false; }
          }
        }
      }
      // 目标合法:不是自己 + 存活
      const targetsLegal = hasCards && normalized.every(t => t.target !== ownerId && state.players[t.target]?.alive === true);
      const ok = myTurn && inActPhase && free && selfAlive && hasCards && noDuplicates && allInHand && targetsLegal;
      return ok ? null : '现在不能使用仁德';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      pushFrame(state, '仁德', from, { ...params });
      // 规范化分配格式(兼容 allocation / targets 分配数组 / 简单格式)
      const allocParam = params.allocation as Array<{ target: number; cardIds: string[] }> | undefined;
      const rawTargets = params.targets as Array<{ target: number; cardIds: string[] }> | number[] | undefined;
      let targets: Array<{ target: number; cardIds: string[] }>;
      if (Array.isArray(allocParam) && allocParam.length > 0 && Array.isArray((allocParam[0] as { cardIds?: unknown }).cardIds)) {
        targets = allocParam;
      } else if (Array.isArray(rawTargets) && rawTargets.length > 0 && Array.isArray((rawTargets[0] as { cardIds?: unknown }).cardIds)) {
        targets = rawTargets as Array<{ target: number; cardIds: string[] }>;
      } else {
        targets = [{ target: (rawTargets as number[])[0], cardIds: [params.cardId as string] }];
      }
      // 计算本次给牌数,判断是否触发回血:
      // 规则"以此法失去第二张牌时回复1点体力"——按本回合累计给出数,首次跨过 2 张时回血。
      // 回血每回合仅 1 次(用 仁德/healed 标记,回合结束 atom 统一清理 /usedThisTurn、/healed 不在此列)。
      const self = state.players[from];
      const beforeCount = typeof self.vars['仁德/givenCount'] === 'number' ? self.vars['仁德/givenCount'] as number : 0;
      const thisCount = targets.reduce((n, t) => n + t.cardIds.length, 0);
      const afterCount = beforeCount + thisCount;
      const shouldHeal = afterCount >= 2 && !self.vars['仁德/healed'];
      // 移动牌(逐张 applyAtom)
      for (const t of targets) {
        for (const cardId of t.cardIds) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '手牌', player: t.target } });
        }
      }
      // 更新累计计数 + 回血
      self.vars['仁德/givenCount'] = afterCount;
      if (shouldHeal) {
        await applyAtom(state, { type: '回复体力', target: from, amount: 1 });
        self.vars['仁德/healed'] = true;
      }
      popFrame(state);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '仁德',
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'allocate',
      title: '仁德：选择要送出的手牌和目标角色',
      source: 'hand',
      minPerTarget: 1,
      maxPerTarget: 99,
      minTotal: 1,
      maxTotal: 99,
      allowSelf: false,
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
