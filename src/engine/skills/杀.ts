// 杀(基本牌):
//   use:出牌阶段对攻击范围内一名角色使用,目标须出闪抵消,否则受 1 点伤害。
//   respond:决斗/南蛮入侵等场景,目标"出杀抵消"——杀牌移到处理区供调用方结算。
//
// 多目标结算顺序(三阶段):
//   1. 声明:逐个 指定目标(触发"指定目标时"hook)
//   2. 结算:逐个 成为目标(触发"成为目标后"hook,如流离转移)
//      → 询问闪(防具如仁王盾/八卦阵在此 cancel 或放虚拟闪)
//      → 检查处理区有闪则 miss,无闪则造成伤害
//   3. 收尾:杀牌移出处理区→弃牌堆
//
// 流离/转移类技能:在 成为目标 after hook 修改帧 params.currentTarget,
// 杀在下轮结算时读帧上的 currentTarget 而非原始 targets[i]。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { inAttackRange } from '../distance';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '杀', description: '出牌阶段对攻击范围内一名角色使用' };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  // ── use:主动出杀 ──
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 手牌 + 牌名 + 目标合法
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardIdOk = typeof params.cardId === 'string';
      const cardInHand = cardIdOk && self?.hand.includes(params.cardId as string);
      const cardNameOk = cardIdOk && state.cardMap[params.cardId as string]?.name === '杀';
      const targets = params.targets as number[] | undefined;
      const targetsExist = Array.isArray(targets) && targets.length > 0;
      const targetsAlive = targetsExist && targets!.every(t => state.players[t]?.alive === true);
      const inRange = targetsExist && targets!.every(t => inAttackRange(state, ownerId, t));
      const quota = state.turn.vars['杀/quota'] as number | undefined;
      const remaining = typeof quota === 'number' ? quota : 1;
      const hasQuota = remaining > 0;
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && targetsAlive && inRange && hasQuota;
      return ok ? null : '现在不能出杀';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const targets = params.targets as number[];
      const frame = pushFrame(state, '杀', from, { ...params, resolvedTargets: [...targets] });

      try {
        // 杀牌进处理区
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '手牌', player: from },
          to: { zone: '处理区' },
        });

        // 第一阶段:逐个指定所有目标(触发"指定目标时"hook)
        for (const target of targets) {
          await applyAtom(state, { type: '指定目标', source: from, target, cardId });
        }

        // 第二阶段:逐个结算(成为目标 → 询问闪 → 检查处理区 → 伤害)
        // resolvedTargets 从帧上读取:流离等技能可能修改帧上的 resolvedTargets
        for (let i = 0; i < targets.length; i++) {
          // 从帧上读当前目标(可能被流离等技能修改)
          const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
          const target = resolved[i];

          // 成为目标:触发"成为目标后"hook(如流离转移),可被 cancel(空城等)
          await applyAtom(state, { type: '成为目标', source: from, target, cardId });

          // 询问闪(等待目标回应,防具如仁王盾/八卦阵在此 cancel 或放虚拟闪)
          await applyAtom(state, { type: '询问闪', target, source: from });

          // 检查处理区:有没有闪牌(目标出闪 / 防具放入的虚拟闪)——drain 所有闪
          const dodgeIds = state.zones.processing.filter(id => {
            const c = state.cardMap[id];
            return c && c.name === '闪';
          });
          if (dodgeIds.length > 0) {
            for (const dodgeCardId of dodgeIds) {
              await applyAtom(state, {
                type: '移动牌',
                cardId: dodgeCardId,
                from: { zone: '处理区' },
                to: { zone: '弃牌堆' },
              });
            }
          } else {
            // 没闪:造成伤害(触发藤甲/白银狮子/遗计/反馈等,濒死由引擎核心处理)
            await applyAtom(state, { type: '造成伤害', target, amount: 1, source: from, cardId });
          }
        }

        // 第三阶段:收尾——杀牌移出处理区→弃牌堆
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        // 异常安全:保证帧弹出 + 杀牌不滞留处理区(即使上面 await 抛错)
        const stillInProc = state.zones.processing.includes(cardId);
        if (stillInProc) {
          await applyAtom(state, {
            type: '移动牌', cardId,
            from: { zone: '处理区' }, to: { zone: '弃牌堆' },
          }).catch(() => {});
        }
        popFrame(state);
        // 扣减出杀次数(Infinity 时不变)
        const q = state.turn.vars['杀/quota'] as number | undefined;
        const cur = typeof q === 'number' ? q : 1;
        state.turn.vars['杀/quota'] = cur === Infinity ? Infinity : cur - 1;
      }
    },
  );

  // ── respond:被询问出杀(决斗/南蛮入侵等)——杀牌进处理区供调用方结算 ──
  registerAction(skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      // pending 必须是 询问杀 或 请求回应(借刀杀人/激将)
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      const atomType = slot.atom.type;
      const reqType = (slot.atom as { requestType?: string }).requestType;
      const pendingMatches =
        atomType === '询问杀' ||
        (atomType === '请求回应' && (reqType === '杀/forceKill' || reqType === '杀/respondKill'));
      if (!pendingMatches) return '当前不是出杀的窗口';
      const cardId = params.cardId as string | undefined;
      if (cardId) {
        const self = state.players[ownerId];
        if (!self?.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (!card || card.name !== '杀') return '只能打出杀';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return;
      // 杀牌进处理区,供调用方(决斗/南蛮入侵)检查处理区判断是否出了杀
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '处理区' },
      });
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '杀',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '出杀',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
      targetFilter: { min: 1, max: 3 },
    },
  });
  api.defineAction('respond', {
    label: '出杀',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '打出杀',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
    },
  });
}

