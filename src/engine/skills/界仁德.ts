// 界仁德(界刘备):
//   出牌阶段,可以将任意张手牌交给一名其他角色,然后本回合不能再以此法交给其手牌
//   (每名角色每回合仅一次)。当本阶段给出的手牌首次达到两张后,回复 1 点体力
//   且可以视为使用一张【杀】(询问是否使用 + 选目标 → 虚拟杀结算)。
import type { GameState, FrontendAPI, GameView, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { inAttackRange } from '../distance';

// localVars keys(界刘备虚拟杀流程)
const USE_SLASH_VAR = '仁德/useSlash';
const SLASH_TARGET_VAR = '仁德/slashTarget';
const CONFIRM_RT = '仁德/virtualSlashConfirm';
const TARGET_RT = '仁德/virtualSlashTarget';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界仁德',
    description: '出牌阶段:将手牌交给一名其他角色(每名角色每回合一次);首次给出两张后回1血且可视为使用一张杀',
  };
}

/** 创建一张虚拟杀卡(无实体,仅用于结算流程的 cardId 引用) */
function makeVirtualKillCard(source: number, target: number, seq: number): string {
  return `仁德:杀:${source}:${target}:${seq}`;
}

/**
 * 执行一次"视为出杀"的完整结算(指定目标→成为目标→检测有效性→询问闪→伤害/抵消)。
 * 不消耗手牌;模型参考神速的 virtualKill。
 */
async function virtualKill(state: GameState, source: number, target: number): Promise<void> {
  if (!state.players[target]?.alive) return;
  const cardId = makeVirtualKillCard(source, target, state.seq);
  // 直接写 cardMap:虚拟杀无实体,但结算流程中 atoms/toViewEvents 需要 cardMap[id] 存在
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };

  await pushFrame(state, '仁德', source, { virtualKillCardId: cardId });
  try {
    await applyAtom(state, { type: '指定目标', source, target, cardId });
    await applyAtom(state, { type: '成为目标', source, target, cardId });
    const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
    if (!valid) return;
    await applyAtom(state, { type: '询问闪', target, source });
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length > 0) {
      await applyAtom(state, { type: '被抵消', source, target, cardId });
      // drain 闪
      for (const dId of dodgeIds) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: dId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    } else {
      await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId });
    }
  } finally {
    // 清理虚拟杀卡(无实体,不入弃牌堆)
    delete state.cardMap[cardId];
    await popFrame(state);
  }
}

/** 规范化分配格式(兼容 allocation / targets 分配数组 / 简单格式) */
function normalizeAllocation(
  params: Record<string, Json>,
  ownerId: number,
): Array<{ target: number; cardIds: string[] }> | null {
  const allocParam = params.allocation as
    | Array<{ target: number; cardIds: string[] }>
    | undefined;
  const allocTargets = params.targets as
    | Array<{ target: number; cardIds: string[] }>
    | undefined;
  const simpleCardId = params.cardId as string | undefined;
  const simpleTargets = params.targets as number[] | undefined;
  if (
    Array.isArray(allocParam) &&
    allocParam.length > 0 &&
    Array.isArray(allocParam[0].cardIds)
  ) {
    return allocParam;
  }
  if (
    Array.isArray(allocTargets) &&
    allocTargets.length > 0 &&
    Array.isArray(allocTargets[0].cardIds)
  ) {
    return allocTargets;
  }
  if (simpleCardId && Array.isArray(simpleTargets) && simpleTargets.length > 0) {
    return [{ target: simpleTargets[0], cardIds: [simpleCardId] }];
  }
  return null;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── use:出牌阶段给牌(单目标,每名角色每回合仅一次) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;

      const normalized = normalizeAllocation(params, ownerId);
      if (!normalized) return '需要指定牌和目标';

      const hasCards = normalized.reduce((n, t) => n + t.cardIds.length, 0) > 0;
      // 收集所有 cardId 检查重复 + 都在手牌
      const allCardIds: string[] = [];
      let noDuplicates = true;
      let allInHand = true;
      if (hasCards) {
        for (const t of normalized) {
          if (!Array.isArray(t.cardIds)) {
            allInHand = false;
            continue;
          }
          for (const cardId of t.cardIds) {
            if (allCardIds.includes(cardId)) {
              noDuplicates = false;
            }
            allCardIds.push(cardId);
            if (!self.hand.includes(cardId)) {
              allInHand = false;
            }
          }
        }
      }
      // 目标合法:不是自己 + 存活
      const targetsLegal =
        hasCards &&
        normalized.every(
          (t) => t.target !== ownerId && state.players[t.target]?.alive === true,
        );
      // 界仁德:每次只能交给一名角色 + 本回合未交给过该角色
      const distinctTargets = new Set(normalized.map((t) => t.target));
      const singleTarget = distinctTargets.size === 1;
      const givenTargets = Array.isArray(self.vars['仁德/givenTargets'])
        ? (self.vars['仁德/givenTargets'] as number[])
        : [];
      const notGivenBefore = !givenTargets.includes(normalized[0].target);
      const ok =
        myTurn &&
        inActPhase &&
        free &&
        selfAlive &&
        hasCards &&
        noDuplicates &&
        allInHand &&
        targetsLegal &&
        singleTarget &&
        notGivenBefore;
      return ok ? null : '现在不能使用仁德';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const self = state.players[from];
      await pushFrame(state, '仁德', from, { ...params });

      const targets = normalizeAllocation(params, from)!;

      // 计算本次给牌数,判断是否触发回血:
      // 规则"以此法失去第二张牌时回复1点体力"——按本回合累计给出数,首次跨过 2 张时回血。
      // 回血每回合仅 1 次(用 仁德/healed 标记,回合结束 atom 统一清理)。
      const beforeCount =
        typeof self.vars['仁德/givenCount'] === 'number' ? self.vars['仁德/givenCount'] : 0;
      const thisCount = targets.reduce((n, t) => n + t.cardIds.length, 0);
      const afterCount = beforeCount + thisCount;
      const shouldHeal = afterCount >= 2 && !self.vars['仁德/healed'];
      // 移动牌(逐张 applyAtom)
      for (const t of targets) {
        for (const cardId of t.cardIds) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '手牌', player: from },
            to: { zone: '手牌', player: t.target },
          });
        }
      }
      // 更新累计计数 + 回血
      self.vars['仁德/givenCount'] = afterCount;
      // 界仁德:记录已给目标(本回合不能再给)
      const givenTargets = Array.isArray(self.vars['仁德/givenTargets'])
        ? (self.vars['仁德/givenTargets'] as number[])
        : [];
      for (const t of targets) {
        if (!givenTargets.includes(t.target)) givenTargets.push(t.target);
      }
      self.vars['仁德/givenTargets'] = givenTargets;
      if (shouldHeal) {
        await applyAtom(state, { type: '回复体力', target: from, amount: 1 });
        self.vars['仁德/healed'] = true;
        // 界仁德:回血后可以视为使用一张杀
        // 询问是否使用虚拟杀
        delete state.localVars[USE_SLASH_VAR];
        await applyAtom(state, {
          type: '请求回应',
          requestType: CONFIRM_RT,
          target: from,
          prompt: {
            type: 'confirm',
            title: '仁德:是否视为使用一张【杀】?',
            confirmLabel: '使用杀',
            cancelLabel: '不使用',
          },
          defaultChoice: false,
          timeout: 15,
        });
        if (state.localVars[USE_SLASH_VAR] === true) {
          // 选目标(攻击范围内一名其他角色)
          delete state.localVars[SLASH_TARGET_VAR];
          await applyAtom(state, {
            type: '请求回应',
            requestType: TARGET_RT,
            target: from,
            prompt: {
              type: 'choosePlayer',
              title: '仁德:选择【杀】的目标(攻击范围内一名其他角色)',
              min: 1,
              max: 1,
              filter: (_view: GameView, t: number) =>
                t !== from &&
                state.players[t]?.alive === true &&
                inAttackRange(state, from, t),
            },
            timeout: 15,
          });
          const slashTarget = state.localVars[SLASH_TARGET_VAR] as number | undefined;
          delete state.localVars[SLASH_TARGET_VAR];
          if (typeof slashTarget === 'number' && state.players[slashTarget]?.alive) {
            await virtualKill(state, from, slashTarget);
          }
        }
        delete state.localVars[USE_SLASH_VAR];
      }
      await popFrame(state);
    },
  );

  // ── respond:处理界仁德虚拟杀的 confirm/target 询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType ?? '';
      if (rt !== CONFIRM_RT && rt !== TARGET_RT) {
        return '当前不是仁德询问';
      }
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType ?? '';
      if (rt === CONFIRM_RT) {
        s.localVars[USE_SLASH_VAR] = params.choice === true;
      } else if (rt === TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') s.localVars[SLASH_TARGET_VAR] = t;
      }
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
  api.defineAction('respond', {
    label: '仁德',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '仁德',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
