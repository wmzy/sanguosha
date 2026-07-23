// 界仁德(界刘备):
//   出牌阶段,每名角色限一次,你可以交给一名其他角色任意张手牌。
//   当你本阶段以此法给出第二张牌时,你可以视为使用一张基本牌
//   (使用【杀】有次数限制)。
//
// OL 官方:
//   "出牌阶段,每名角色限一次,你可以交给一名其他角色任意张手牌。
//    当你本阶段以此法给出第二张牌时,你可以视为使用一张基本牌
//    (使用【杀】有次数限制)。"
//
// 与标仁德区别:
//   - 标仁德:以此法给出第二张时【回复1点体力】(回血),无限次给牌(每名角色无限制)。
//   - 界仁德:【不回血】,改为可"视为使用一张基本牌"(杀/桃/酒);每名角色每回合限一次。
//
// 实现要点:
//   - 给牌主流程沿用:每名角色每回合限一次(self.vars['仁德/givenTargets'],回合结束清空)。
//   - 累计给牌数 self.vars['仁德/givenCount'](回合结束清空)。
//   - 跨过第二张时触发"视为使用基本牌"询问:用 self.vars['仁德/basicUsed'] 防重入(每阶段一次)。
//   - 基本牌范围:杀/桃/酒(闪无主动使用场景,故不提供)。
//   · 杀:须尊重出杀次数限制(canSlash / incSlashUsed / slashUsed)。
//   · 桃:目标须已受伤(health<maxHealth),存活。
//   · 酒:仅对自己,标记下一张杀伤害+1。
//   - 转化卡:用 `仁德:杀:${source}:${target}:${seq}` 等虚拟卡 id,无实体;不入弃牌堆。
import type { GameState, FrontendAPI, GameView, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { inAttackRange } from '../distance';
import { canSlash, incSlashUsed, slashUsed } from '../slash-quota';
import { runUseFlow } from '../card-effect/use-card';

// localVars keys(界刘备视为使用基本牌流程)
const BASIC_CHOICE_VAR = '仁德/basicChoice';
const BASIC_TARGET_VAR = '仁德/basicTarget';
// 请求回应的 requestType(隔离 respond 路由)
const CHOICE_RT = '仁德/basicChoice';
const TARGET_RT = '仁德/basicTarget';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界仁德',
    description:
      '出牌阶段:每名角色限一次,将任意张手牌交给一名其他角色;本阶段给出第二张时,可视为使用一张基本牌',
  };
}

/** 创建一张虚拟卡(无实体,仅用于结算流程的 cardId 引用) */
function makeVirtualCard(kind: '杀' | '桃' | '酒', source: number, target: number, seq: number): string {
  return `仁德:${kind}:${source}:${target}:${seq}`;
}

/**
 * 执行一次"视为出杀"的完整结算（runUseFlow virtual 模式）。
 * 不消耗手牌；走完整时机 atom 序列（选择目标时/使用时/指定目标/成为目标/...），
 * 保证激昂/集智/界求援等技能事件一致。不计入出杀次数（onSettle 被 virtual 跳过）。
 */
async function virtualKill(state: GameState, source: number, target: number): Promise<void> {
  if (!state.players[target]?.alive) return;
  const cardId = makeVirtualCard('杀', source, target, state.seq);
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };
  await runUseFlow(state, source, cardId, [target], '杀', { virtual: true });
  delete state.cardMap[cardId];
}

/** 视为使用一张【桃】:走 runUseFlow virtual（resolve=回复体力） */
async function virtualPeach(state: GameState, source: number, target: number): Promise<void> {
  const t = state.players[target];
  if (!t?.alive) return;
  if (t.health >= t.maxHealth) return;
  const cardId = makeVirtualCard('桃', source, target, state.seq);
  state.cardMap[cardId] = { id: cardId, name: '桃', suit: '', color: '无色', rank: 'A', type: '基本牌' };
  await runUseFlow(state, source, cardId, [target], '桃', { virtual: true });
  delete state.cardMap[cardId];
}

/** 视为使用一张【酒】:走 runUseFlow virtual（resolve=加增伤标记） */
async function virtualWine(state: GameState, source: number): Promise<void> {
  const cardId = makeVirtualCard('酒', source, source, state.seq);
  state.cardMap[cardId] = { id: cardId, name: '酒', suit: '', color: '无色', rank: 'A', type: '基本牌' };
  await runUseFlow(state, source, cardId, [], '酒', { virtual: true });
  delete state.cardMap[cardId];
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
  // owner 不使用,占位避免 unused 警告(签名保留以便未来扩展)
  void ownerId;
  return null;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
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
      // 界仁德:每次只能交给一名角色 + 本回合未交给过该角色(每名角色每回合限一次)
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
      return ok ? null : '现在不能使用界仁德';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const self = state.players[from];
      await pushFrame(state, '仁德', from, { ...params });

      const targets = normalizeAllocation(params, from)!;

      // 累计给牌数(本阶段给出第二张触发视为使用基本牌)
      const beforeCount =
        typeof self.vars['仁德/givenCount'] === 'number' ? self.vars['仁德/givenCount'] : 0;
      const thisCount = targets.reduce((n, t) => n + t.cardIds.length, 0);
      const afterCount = beforeCount + thisCount;
      // 仅当本阶段首次跨过第二张且本阶段未触发过 → 询问视为使用基本牌
      const shouldOfferBasic = afterCount >= 2 && !self.vars['仁德/basicUsed'];
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
      // 更新累计计数
      self.vars['仁德/givenCount'] = afterCount;
      // 记录已给目标(本回合不能再给)
      const givenTargets = Array.isArray(self.vars['仁德/givenTargets'])
        ? (self.vars['仁德/givenTargets'] as number[])
        : [];
      for (const t of targets) {
        if (!givenTargets.includes(t.target)) givenTargets.push(t.target);
      }
      self.vars['仁德/givenTargets'] = givenTargets;

      // 界仁德核心新增:本阶段首次给出第二张 → 询问视为使用基本牌
      if (shouldOfferBasic) {
        // 标记本阶段已触发(防重入;每名角色每回合限一次给牌 + 一次询问)
        self.vars['仁德/basicUsed'] = true;

        // 步骤1:询问选择基本牌类型(杀/桃/酒,或不使用)
        delete state.localVars[BASIC_CHOICE_VAR];
        await applyAtom(state, {
          type: '请求回应',
          requestType: CHOICE_RT,
          target: from,
          prompt: {
            type: 'confirm',
            title: '界仁德:是否视为使用一张基本牌?',
            confirmLabel: '使用基本牌',
            cancelLabel: '不使用',
          },
          defaultChoice: false,
          timeout: 30,
        });
        const choice = state.localVars[BASIC_CHOICE_VAR];
        delete state.localVars[BASIC_CHOICE_VAR];

        if (choice === '杀') {
          // 须尊重出杀次数限制:已达上限则不发起目标询问
          if (!canSlash(state, from)) {
            // 已达上限:不使用,直接结束(不计为已使用次数)
          } else {
            delete state.localVars[BASIC_TARGET_VAR];
            await applyAtom(state, {
              type: '请求回应',
              requestType: TARGET_RT,
              target: from,
              prompt: {
                type: 'choosePlayer',
                title: '界仁德:选择【杀】的目标(攻击范围内一名其他角色)',
                min: 1,
                max: 1,
                filter: (_view: GameView, t: number) =>
                  t !== from &&
                  state.players[t]?.alive === true &&
                  inAttackRange(state, from, t),
              },
              timeout: 30,
            });
            const slashTarget = state.localVars[BASIC_TARGET_VAR] as number | undefined;
            delete state.localVars[BASIC_TARGET_VAR];
            if (typeof slashTarget === 'number' && state.players[slashTarget]?.alive) {
              await virtualKill(state, from, slashTarget);
              // 视为出杀占出杀次数(incSlashUsed + 回合用量投影 view)
              incSlashUsed(state);
              await applyAtom(state, {
                type: '回合用量',
                player: from,
                key: '杀/usedCount',
                value: slashUsed(state),
              });
            }
          }
        } else if (choice === '桃') {
          // 桃:目标须已受伤(任意已受伤角色,含自己)
          delete state.localVars[BASIC_TARGET_VAR];
          await applyAtom(state, {
            type: '请求回应',
            requestType: TARGET_RT,
            target: from,
            prompt: {
              type: 'choosePlayer',
              title: '界仁德:选择【桃】的目标(一名已受伤角色,可对自己)',
              min: 1,
              max: 1,
              filter: (_view: GameView, t: number) => {
                const tp = state.players[t];
                return !!tp?.alive && tp.health < tp.maxHealth;
              },
            },
            timeout: 30,
          });
          const peachTarget = state.localVars[BASIC_TARGET_VAR] as number | undefined;
          delete state.localVars[BASIC_TARGET_VAR];
          if (typeof peachTarget === 'number' && state.players[peachTarget]?.alive) {
            await virtualPeach(state, from, peachTarget);
          }
        } else if (choice === '酒') {
          // 酒:仅对自己,标记下一张杀+1伤害
          await virtualWine(state, from);
        }
        // choice === false / undefined / 超时 → 不使用,直接结束
      }
      await popFrame(state);
    },
  );

  // ── respond:处理界仁德视为使用基本牌的 choice/target 询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType ?? '';
      if (rt !== CHOICE_RT && rt !== TARGET_RT) {
        return '当前不是仁德询问';
      }
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType ?? '';
      if (rt === CHOICE_RT) {
        // 选择基本牌类型:'杀'/'桃'/'酒'(string),或 false 表示不使用
        const c = params.choice;
        if (c === '杀' || c === '桃' || c === '酒') {
          s.localVars[BASIC_CHOICE_VAR] = c;
        } else if (params.confirmed === true) {
          // 默认选杀(UI 仅 confirm 时回退杀)
          s.localVars[BASIC_CHOICE_VAR] = '杀';
        } else {
          s.localVars[BASIC_CHOICE_VAR] = false;
        }
      } else if (rt === TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') s.localVars[BASIC_TARGET_VAR] = t;
      }
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '界仁德',
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'allocate',
      title: '界仁德：选择要送出的手牌和目标角色(每名角色每回合限一次)',
      source: 'hand',
      minPerTarget: 1,
      maxPerTarget: 99,
      minTotal: 1,
      maxTotal: 99,
      allowSelf: false,
    },
  });
  api.defineAction('respond', {
    label: '界仁德',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '界仁德',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
