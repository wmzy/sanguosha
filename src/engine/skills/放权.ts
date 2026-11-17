// 放权(刘禅·主动技):你可以跳过出牌阶段,然后在回合结束时弃置一张手牌,
// 令一名其他角色进行一个额外回合。
//
// 实现:
//   - before hook 挂在「阶段开始」(出牌):询问是否发动;发动则跳过出牌阶段 +
//     设 放权/active 标记(回合结束时消费)。
//   - before hook 挂在「回合结束」:额外回合的核心机制,处理两种情况——
//     情况1(刘禅回合结束 + active):弃一张手牌 → 选额外回合目标 → cancel 本回合结束
//       (阻止 回合管理 的 findNextAlive 路径,避免双重启动)→ 手动清理 per-turn 状态
//       → 亲自启动目标的额外回合(参考据守「亲自推进回合」先例)。
//     情况2(额外目标回合结束):cancel 本回合结束 → 手动清理 → 亲自启动正常下家(刘禅的正常下家)的回合,
//       恢复正常座次顺序。
//
//   额外回合机制完全在放权技能内部实现,不修改 回合管理.ts:
//   cancel 掉 回合结束 atom 后其 apply 与 after-hook(回合管理的 findNextAlive)都不执行,
//   故需手动复刻 回合结束 的 per-turn 清理(见 rules/turn-usage 的 clearPerTurnStateProjected)。
//
// 跳过出牌阶段手法同神速/巧变:applyAtom(阶段结束, 出牌) 推进到弃牌,
//   再 return {kind:'cancel'} 取消本次 阶段开始(出牌)。
//
// 本文件同时导出 createFangquanSkill 工厂(放权族共享实现),界放权 复用之:
//   标/界共享 respond 校验、跳过出牌、额外回合执行(情况2)与全部 localVars 键;
//   差异全部显式注入——requestType 前缀(=各自技能 id)/文案/代价与选目标时机
//   (标=回合结束时 / 界=弃牌阶段开始时)。
//   requestType 前缀必须等于技能 id('放权'/'界放权'):前端 resolvePendingRespond 按
//   requestType 前缀解析 skillId 后提交 respond,前缀≠技能 id 则 dispatch 找不到
//   respond handler(按钮不可点击)。
//   注:localVars key 两版均用 '放权/' 前缀(内部状态,不参与前端路由,保持与测试断言一致)。
import type {
  FrontendAPI,
  GameState,
  GameView,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { startTurn } from '../flows/turn';
import { registerAction, registerBeforeHook } from '../core/skill';
import { clearPerTurnStateProjected } from '../rules/turn-usage';
import { askConfirm, askResponse, defineConfirmAction, registerPhaseStartHook } from '../util/skillRuntime';
import type { SkillModule } from '../types';

// localVars keys(标/界共用 '放权/' 前缀,保持与测试断言一致)
const TRIGGERED_KEY = '放权/triggered';
const ACTIVE_KEY = '放权/active';
const DISCARD_CARD_KEY = '放权/discardCard';
const EXTRA_TARGET_KEY = '放权/extraTarget';
const ORIGINAL_NEXT_KEY = '放权/originalNext';

/** 放权族差异参数(标/界共享实现,差异全部显式注入)。 */
export interface FangquanOptions {
  /** 技能 id(= requestType 前缀;标 '放权' / 界 '界放权') */
  skillId: string;
  /** 玩家可见技能名(Skill.name + onMount 按钮 label) */
  displayName: string;
  description: string;
  /** 出牌阶段 askConfirm 标题(标/界文案逐字不同) */
  triggerTitle: string;
  /** onMount confirm 弹窗标题 */
  mountTitle: string;
  /** 界版:代价(弃一张手牌)+ 选额外回合目标在弃牌阶段开始时;标版在回合结束时 */
  costAtDiscardPhase: boolean;
}

/** 放权族共享实现:标放权与界放权仅 requestType 前缀/文案/代价时机 不同,
 *  respond 校验、跳过出牌、额外回合执行(情况2)与 atom 序列逐字一致。 */
export function createFangquanSkill(opts: FangquanOptions) {
  // requestType 前缀 = 技能 id,遵循 `${SKILL_ID}/…` 局部技能名模板约定。
  const SKILL_ID = opts.skillId;
  const TRIGGER_RT = `${SKILL_ID}/trigger`;
  const DISCARD_RT = `${SKILL_ID}/discard`;
  const CHOOSE_TARGET_RT = `${SKILL_ID}/chooseTarget`;

  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.displayName,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;

    // respond:处理 trigger(confirm)、discard(useCard)、chooseTarget(choosePlayer) 三类询问。
    // 三个 requestType 共用一个注册键 `${skillId}:${ownerId}:respond`(后注册覆盖前注册),
    // 不能拆成 registerConfirmRespond 等单询问注册——拆分会丢掉 discard/chooseTarget 分支。
    registerAction(
      state,
      skill.id,
      ownerId,
      'respond',
      (s: GameState, params: Record<string, Json>): string | null => {
        const slot = s.pendingSlots.get(ownerId);
        if (slot?.atom.type !== '请求回应') return '当前不需要回应';
        const rt = (slot.atom as unknown as { requestType?: string }).requestType;
        if (rt === TRIGGER_RT) return null;
        if (rt === DISCARD_RT) {
          const cardId = params.cardId as string | undefined;
          if (typeof cardId !== 'string') return '请选择一张手牌弃置';
          if (!s.players[ownerId].hand.includes(cardId)) return '牌不在手牌中';
          return null;
        }
        if (rt === CHOOSE_TARGET_RT) {
          const target = params.target as number | undefined;
          if (typeof target !== 'number') return '请选择一名其他角色';
          if (target === ownerId) return '不能选择自己';
          if (!s.players[target]?.alive) return '目标已死亡';
          return null;
        }
        return '当前不是放权回应';
      },
      async (s: GameState, params: Record<string, Json>) => {
        const slot = s.pendingSlots.get(ownerId);
        const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
        if (rt === TRIGGER_RT) {
          s.localVars[TRIGGERED_KEY] = params.choice === true || params.confirmed === true;
        } else if (rt === DISCARD_RT) {
          s.localVars[DISCARD_CARD_KEY] = params.cardId;
        } else if (rt === CHOOSE_TARGET_RT) {
          s.localVars[EXTRA_TARGET_KEY] = params.target;
        }
      },
    );

    // ── 阶段开始(出牌) before:询问是否放权(跳过出牌) ──
    registerPhaseStartHook(
      state,
      skill.id,
      ownerId,
      '出牌',
      async (ctx): Promise<HookResult | void> => {
        const self = ctx.state.players[ownerId];
        if (!self?.alive) return;

        // 询问是否发动放权(标/界标题逐字不同,经 opts.triggerTitle 注入)
        const triggered = await askConfirm(ctx.state, TRIGGER_RT, ownerId, {
          confirmedKey: TRIGGERED_KEY,
          title: opts.triggerTitle,
          confirmLabel: '发动',
          cancelLabel: '不发动',
          defaultChoice: false,
          timeout: 10,
        });
        if (!triggered) return; // 不发动 → 出牌阶段正常进行

        // 设标记:标版回合结束时消费 / 界版弃牌阶段开始时消费
        // (用 localVars 而非 turn.vars,因 回合结束 apply 会清空 turn.vars)
        ctx.state.localVars[ACTIVE_KEY] = true;

        // 跳过出牌阶段:推进到弃牌阶段,并 cancel 本次出牌阶段开始
        await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '出牌' });
        return { kind: 'cancel' };
      },
      { requireCurrentPlayer: true },
    );

    // ── 阶段开始(弃牌) before:界版放权代价(弃一张手牌)+ 选额外回合目标(对齐官方「弃牌阶段开始时」)──
    if (opts.costAtDiscardPhase) {
      registerPhaseStartHook(
        state,
        skill.id,
        ownerId,
        '弃牌',
        async (ctx): Promise<HookResult | void> => {
          const st = ctx.state;
          if (st.localVars[ACTIVE_KEY] !== true) return; // 未发动放权跳过出牌 → 不触发
          delete st.localVars[ACTIVE_KEY]; // 消费 active 标记
          const self = st.players[ownerId];
          if (!self?.alive) return;

          // 请求弃一张手牌(放权代价):必须支付,未支付(无手牌/超时/不回应)则不发动额外回合
          if (self.hand.length === 0) return; // 无手牌无法支付代价 → 不发动,放行正常弃牌阶段
          const discardCardId = await askResponse<string | undefined>(st, DISCARD_RT, ownerId, {
            prompt: {
              type: 'useCard',
              title: '放权:弃置一张手牌',
              cardFilter: { filter: () => true, min: 1, max: 1 },
            },
            timeout: 15,
            resultKey: DISCARD_CARD_KEY,
          });
          if (!discardCardId || !self.hand.includes(discardCardId)) {
            return; // 超时/不回应 → 未支付代价,不发动额外回合,放行正常弃牌阶段
          }
          await applyAtom(st, { type: '弃置', player: ownerId, cardIds: [discardCardId], voluntary: true });

          // 请求选额外回合目标(排除自己、排除死亡)。
          // askResponse 读后即删结果键,有效目标须重写 EXTRA_TARGET_KEY 供回合结束时消费。
          const extraTarget = await askResponse<number | undefined>(st, CHOOSE_TARGET_RT, ownerId, {
            prompt: {
              type: 'choosePlayer',
              title: '放权:选择一名其他角色进行一个额外回合',
              min: 1,
              max: 1,
              filter: (view: GameView, target: number) =>
                target !== ownerId && view.players[target]?.alive === true,
            },
            timeout: 15,
            resultKey: EXTRA_TARGET_KEY,
          });
          if (typeof extraTarget === 'number' && st.players[extraTarget]?.alive) {
            st.localVars[EXTRA_TARGET_KEY] = extraTarget;
          }
          // 无有效目标 → 不重写键,回合结束时不启动额外回合
          // 不 cancel:让正常弃牌阶段按手牌上限继续进行
        },
        { requireCurrentPlayer: true },
      );
    }

    // ── 回合结束 before:放权的额外回合机制 ──
    // 比 回合管理 的 after-hook(按座次+注册序)更早(before 先于 after),cancel 后其 after-hook 不执行。
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '回合结束',
      async (ctx): Promise<HookResult | void> => {
        const atom = ctx.atom;
        if (atom.type !== '回合结束') return;
        const st = ctx.state;
        const player = atom.player;
        if (typeof player !== 'number') return;

        // ── 情况1:刘禅主回合的回合结束 ──
        if (player === ownerId) {
          if (opts.costAtDiscardPhase) {
            // 界版:目标已在弃牌阶段选定(代价+选目标在弃牌阶段开始时完成)
            // (extraTarget≠ownerId 由 respond validate 保证,player===ownerId 仅可能是主回合结束)
            const extraTarget = st.localVars[EXTRA_TARGET_KEY] as number | undefined;
            if (typeof extraTarget !== 'number' || !st.players[extraTarget]?.alive) {
              return; // 弃牌阶段未选定有效目标 → 放行正常回合结束
            }
            if (!st.players[ownerId]?.alive) {
              delete st.localVars[EXTRA_TARGET_KEY]; // 刘禅已死亡 → 清标记放行
              return;
            }

            // 记录正常下家(currentPlayerIndex 已被 end action 的 下一玩家 推进到正常下家)
            const originalNext = st.currentPlayerIndex;
            st.localVars[ORIGINAL_NEXT_KEY] = originalNext;

            // cancel 回合结束 → 手动清理 per-turn 状态(否则 apply 不执行,状态残留);
            // 投影版顺带发 回合用量 null 清 turnUsage 视图键(与权威 回合结束 atom 对齐)
            await clearPerTurnStateProjected(st);

            // 亲自启动额外目标的回合(嵌套:其 end action → 回合结束(extraTarget) → 触发情况2)
            st.currentPlayerIndex = extraTarget;
            await startTurn(st, extraTarget);

            return { kind: 'cancel' };
          }

          // 标版:active 标记 → 回合结束时支付代价(弃一张手牌)并选额外回合目标
          if (st.localVars[ACTIVE_KEY] !== true) return;
          delete st.localVars[ACTIVE_KEY];
          const self = st.players[ownerId];
          if (!self?.alive) return; // 已死亡 → 不启动额外回合,放行正常回合结束

          // 请求弃一张手牌:必须支付,未支付(无手牌/超时/不回应)则不发动额外回合
          if (self.hand.length === 0) return; // 无手牌无法支付代价 → 不发动,放行正常回合结束
          const discardCardId = await askResponse<string | undefined>(st, DISCARD_RT, ownerId, {
            prompt: {
              type: 'useCard',
              title: '放权:弃置一张手牌',
              cardFilter: { filter: () => true, min: 1, max: 1 },
            },
            timeout: 15,
            resultKey: DISCARD_CARD_KEY,
          });
          if (!discardCardId || !self.hand.includes(discardCardId)) {
            return; // 超时/不回应 → 未支付代价,不发动额外回合,放行正常回合结束
          }
          await applyAtom(st, { type: '弃置', player: ownerId, cardIds: [discardCardId], voluntary: true });

          // 请求选额外回合目标(排除自己、排除死亡)
          const extraTarget = await askResponse<number | undefined>(st, CHOOSE_TARGET_RT, ownerId, {
            prompt: {
              type: 'choosePlayer',
              title: '放权:选择一名其他角色进行一个额外回合',
              min: 1,
              max: 1,
              filter: (view: GameView, target: number) =>
                target !== ownerId && view.players[target]?.alive === true,
            },
            timeout: 15,
            resultKey: EXTRA_TARGET_KEY,
          });
          if (
            typeof extraTarget !== 'number' ||
            extraTarget === ownerId ||
            !st.players[extraTarget]?.alive
          ) {
            // 无有效目标 → 不启动额外回合,放行正常回合结束
            return;
          }

          // 记录正常下家(currentPlayerIndex 已被 end action 的 下一玩家 推进到正常下家)。
          // askResponse 读后已删 EXTRA_TARGET_KEY,此处重写以供「情况2」识别额外目标。
          const originalNext = st.currentPlayerIndex;
          st.localVars[EXTRA_TARGET_KEY] = extraTarget;
          st.localVars[ORIGINAL_NEXT_KEY] = originalNext;

          // cancel 回合结束 → 手动清理 per-turn 状态(否则 apply 不执行,状态残留);
          // 逐 key 投影 null 清漏增量视图 turnUsage(见 clearPerTurnStateProjected)
          await clearPerTurnStateProjected(st);

          // 亲自启动额外目标的回合(嵌套:其 end action → 回合结束(extraTarget) → 触发情况2)
          st.currentPlayerIndex = extraTarget;
          await startTurn(st, extraTarget);

          return { kind: 'cancel' };
        }

        // ── 情况2:额外目标的回合结束 ──
        const extraTargetStored = st.localVars[EXTRA_TARGET_KEY];
        if (player === extraTargetStored) {
          const originalNext = st.localVars[ORIGINAL_NEXT_KEY] as number | undefined;
          delete st.localVars[EXTRA_TARGET_KEY];
          delete st.localVars[ORIGINAL_NEXT_KEY];

          if (typeof originalNext !== 'number' || !st.players[originalNext]?.alive) {
            return; // 异常:无正常下家,放行
          }

          // cancel 回合结束 → 手动清理 per-turn 状态(逐 key 投影,同情况1)
          await clearPerTurnStateProjected(st);

          // 亲自启动正常下家的回合(恢复正常座次顺序)。
          // originalNext 回合结束后,其 回合结束 before-hook 标记已清 → 放行 →
          // 回合管理 的 after-hook 经 findNextAlive 正常推进后续座次。
          st.currentPlayerIndex = originalNext;
          await startTurn(st, originalNext);

          return { kind: 'cancel' };
        }
      },
    );

    return () => {};
  }

  function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
    defineConfirmAction(api, 'respond', {
      label: opts.displayName,
      title: opts.mountTitle,
    });
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: FangquanOptions = {
  skillId: '放权',
  displayName: '放权',
  description: '跳过出牌阶段,回合结束时弃一张手牌,令一名其他角色进行一个额外回合',
  triggerTitle: '是否发动放权?(跳过出牌阶段,回合结束时弃一张手牌令其他角色额外回合)',
  mountTitle: '是否发动放权?',
  costAtDiscardPhase: false,
};

export const { createSkill, onInit, onMount } = createFangquanSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
