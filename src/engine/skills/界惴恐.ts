// 界惴恐(界伏皇后·群·被动技,OL 界限突破官方逐字):
//   其他角色的回合开始时，若你已受伤，你可以与其拼点：
//   若你赢，其本回合不能对除其以外的角色使用牌；
//   若你没赢，你获得其拼点牌，然后其视为对你使用一张【杀】。
//
// 与标版惴恐差异(标版未实现;基于官方描述对比):
//   - 标版:"若你没赢,其本回合与你的距离视为1。"——仅距离调整。
//   - 界版:"若你没赢,你获得其拼点牌,然后其视为对你使用一张【杀】。"——获得牌 + 虚拟杀。
//   两版"没赢"效果完全不同,界版必须独立文件。
//
// 实现要点:
//   - 触发: 回合开始 after-hook(atom.player !== ownerId)
//   - 条件: owner 存活、已受伤(health < maxHealth)、对方存活;拼点双方都需手牌。
//   - 询问链:
//       1) confirm: 是否发动惴恐?(owner)
//       2) useCard: owner 选一张拼点牌
//       3) useCard: 目标 选一张拼点牌(超时兜底 hand[0])
//   - 拼点: 移动两张拼点牌到处理区 → 拼点 atom(把两张牌移入弃牌堆)。
//   - 结算:
//       owner 赢 → 在目标 vars 上写 '惴恐/restricted/usedThisTurn'(后缀约定,回合结束自动清)
//                  + 回合用量 atom 同步 view(虽非 owner 主动技,但便于审计/调试)。
//       owner 没赢 → 移动 target 拼点牌(弃牌堆 → owner 手牌) + 虚拟杀(target → owner)。
//
//   - 限制实现:固定注册 指定目标 before-hook,内部读 source 玩家 vars[restrictedKey()]:
//       若 source 被限制 且 target !== source → cancel(阻止其对他人指定目标)。
//     覆盖所有走 指定目标 atom 的牌:杀/决斗(走成为目标)、借刀杀人/激将/挑衅 的虚拟杀等。
//     顺手牵羊/过河拆桥等单纯锦囊、AOE(南蛮/万箭)与火攻不走 指定目标 atom,本实现未覆盖
//     (规则边界;这些锦囊需另挂 询问无懈可击/造成伤害 hook,范围较大,暂略)。
//     标签 key 后缀 '/usedThisTurn' 由「回合结束」atom 自动清除,无需手动管理生命周期。
//
// 命名:文件名/loader key/character skill name = '界惴恐'(避标版冲突);
//   内部 Skill.name = '惴恐'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import {
  registerAction,
  registerAfterHook,
  registerBeforeHook,
  type SkillModule,
} from '../skill';

const SKILL_ID = '界惴恐';
const DISPLAY_NAME = '惴恐';

/** 询问 RT:是否发动惴恐(confirm) */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
/** 询问 RT:owner 选拼点牌 */
const OWNER_CARD_RT = `${SKILL_ID}/ownerCard`;
/** 询问 RT:目标 选拼点牌 */
const TARGET_CARD_RT = `${SKILL_ID}/targetCard`;

/** localVars key:confirm 结果 */
const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
/** localVars key:owner 拼点牌 cardId */
const OWNER_CARD_KEY = `${SKILL_ID}/ownerCardId`;
/** localVars key:目标拼点牌 cardId */
const TARGET_CARD_KEY = `${SKILL_ID}/targetCardId`;

/** 限制 key:写在被限制玩家 vars 上,'/usedThisTurn' 后缀由「回合结束」atom 自动清空。 */
const RESTRICTED_KEY = `${SKILL_ID}/restricted/usedThisTurn`;

/** 拼点牌点数:A=1, 2-10=面值, J=11, Q=12, K=13 */
function rankValue(rank: string): number {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '其他角色的回合开始时,若你已受伤,你可以与其拼点:赢则其本回合不能对除其以外的角色使用牌;没赢则你获得其拼点牌,然后其视为对你使用一张杀',
  };
}

/** 虚拟杀结算(参考界仁德/界诛害):source → target,无实体卡,不计入出杀次数。 */
async function virtualKill(state: GameState, source: number, target: number): Promise<void> {
  if (!state.players[target]?.alive) return;
  const cardId = `${SKILL_ID}:杀:${source}:${target}:${state.seq}`;
  // 虚拟杀无实体,但结算流程中 atoms/toViewEvents 需要 cardMap[id] 存在
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };
  await pushFrame(state, SKILL_ID, source, { virtualKillCardId: cardId });
  try {
    await applyAtom(state, { type: '指定目标', source, target, cardId });
    const became = await applyAtom(state, { type: '成为目标', source, target, cardId });
    if (!became) return;
    const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
    if (!valid) return;
    await applyAtom(state, { type: '询问闪', target, source });
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length > 0) {
      await applyAtom(state, { type: '被抵消', source, target, cardId });
      for (const dId of dodgeIds) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: dId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    } else if (state.players[target]?.alive) {
      await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId });
    }
  } finally {
    // 清理虚拟杀卡(无实体,不入弃牌堆)
    delete state.cardMap[cardId];
    await popFrame(state);
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── respond:owner 处理 confirm + 自己的拼点牌 ──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(ownerId);
        if (!slot || slot.atom.type !== '请求回应') return '当前不需要回应';
        const rt = (slot.atom as unknown as { requestType?: string }).requestType;
        if (rt === CONFIRM_RT) return null;
        if (rt === OWNER_CARD_RT) {
          const cardId = params.cardId as string | undefined;
          if (typeof cardId !== 'string') return '请选择一张拼点牌';
          if (!st.players[ownerId]?.hand.includes(cardId)) return '拼点牌不在你的手牌中';
          return null;
        }
        return '当前不是惴恐询问';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(ownerId);
        const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
        if (rt === CONFIRM_RT) {
          st.localVars[CONFIRM_KEY] = params.choice === true;
        } else if (rt === OWNER_CARD_RT) {
          st.localVars[OWNER_CARD_KEY] = params.cardId;
        }
      },
    ),
  );

  // ── respond:目标拼点牌。为所有非 owner 座次注册(validate 严格校验 requestType) ──
  for (const p of state.players) {
    if (p.index === ownerId) continue;
    const pid = p.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        pid,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(pid);
          if (!slot || slot.atom.type !== '请求回应') return '当前不需要回应';
          const rt = (slot.atom as unknown as { requestType?: string }).requestType;
          if (rt !== TARGET_CARD_RT) return '当前不是惴恐拼点询问';
          const cardId = params.cardId as string | undefined;
          if (typeof cardId !== 'string') return '请选择一张拼点牌';
          if (!st.players[pid]?.hand.includes(cardId)) return '拼点牌不在你的手牌中';
          return null;
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(pid);
          const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
          if (rt === TARGET_CARD_RT) {
            st.localVars[TARGET_CARD_KEY] = params.cardId;
          }
        },
      ),
    );
  }

  // ── 指定目标 before-hook:被限制玩家不能对除己以外角色用牌 ──
  // 永久注册,内部按 source 的 vars[RESTRICTED_KEY] 判定;key 由「回合结束」atom 自动清。
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '指定目标',
      async (ctx): Promise<HookResult | void> => {
        const atom = ctx.atom;
        const source = atom.source;
        const target = atom.target;
        if (typeof source !== 'number' || typeof target !== 'number') return;
        if (source === target) return; // 对自己用牌(桃/酒)允许
        if (!ctx.state.players[source]?.vars[RESTRICTED_KEY]) return;
        return { kind: 'cancel' };
      },
    ),
  );

  // ── 回合开始 after-hook:惴恐主逻辑 ──
  unloaders.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '回合开始',
      async (ctx): Promise<void> => {
        const st = ctx.state;
        const atom = ctx.atom;
        const turnPlayer = atom.player;
        if (typeof turnPlayer !== 'number') return;
        if (turnPlayer === ownerId) return; // 自己回合不触发
        const self = st.players[ownerId];
        if (!self?.alive) return;
        // 已受伤
        if (self.health >= self.maxHealth) return;
        // 对方存活
        const target = st.players[turnPlayer];
        if (!target?.alive) return;
        // 自己有手牌(拼点需要)
        if (self.hand.length === 0) return;
        // 对方有手牌(拼点双方都需手牌;提前校验避免 confirm 后白问)
        if (target.hand.length === 0) return;

        // 1) confirm:是否发动惴恐
        delete st.localVars[CONFIRM_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: CONFIRM_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title: `惴恐:是否与 ${target.name} 拼点?`,
            confirmLabel: '发动',
            cancelLabel: '不发动',
          },
          defaultChoice: false,
          timeout: 15,
        });
        if (!st.localVars[CONFIRM_KEY]) return;
        delete st.localVars[CONFIRM_KEY];

        // confirm 后再次校验(target 可能在此期间失去手牌)
        if (target.hand.length === 0) return;

        // 2) owner 选拼点牌
        delete st.localVars[OWNER_CARD_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: OWNER_CARD_RT,
          target: ownerId,
          prompt: {
            type: 'useCard',
            title: '惴恐:选择一张拼点牌',
            cardFilter: { filter: () => true, min: 1, max: 1 },
          },
          timeout: 20,
        });
        const ownerCardId = st.localVars[OWNER_CARD_KEY] as string | undefined;
        delete st.localVars[OWNER_CARD_KEY];
        if (!ownerCardId || !self.hand.includes(ownerCardId)) return;

        // 3) 目标选拼点牌(超时兜底 hand[0])
        delete st.localVars[TARGET_CARD_KEY];
        const fallback = target.hand[0];
        await applyAtom(st, {
          type: '请求回应',
          requestType: TARGET_CARD_RT,
          target: turnPlayer,
          prompt: {
            type: 'useCard',
            title: `惴恐:与 ${self.name} 拼点,请出一张手牌`,
            cardFilter: { filter: () => true, min: 1, max: 1 },
          },
          timeout: 20,
        });
        let targetCardId = st.localVars[TARGET_CARD_KEY] as string | undefined;
        delete st.localVars[TARGET_CARD_KEY];
        if (!targetCardId || !target.hand.includes(targetCardId)) {
          targetCardId = fallback; // 超时兜底
        }
        if (!targetCardId || !target.hand.includes(targetCardId)) return;

        // 4) 移动两张拼点牌到处理区
        await applyAtom(st, {
          type: '移动牌',
          cardId: ownerCardId,
          from: { zone: '手牌', player: ownerId },
          to: { zone: '处理区' },
        });
        await applyAtom(st, {
          type: '移动牌',
          cardId: targetCardId,
          from: { zone: '手牌', player: turnPlayer },
          to: { zone: '处理区' },
        });

        // 5) 拼点 atom(apply 会把两张牌移入弃牌堆)
        const ownerRank = rankValue(st.cardMap[ownerCardId]?.rank ?? '');
        const targetRank = rankValue(st.cardMap[targetCardId]?.rank ?? '');
        await applyAtom(st, {
          type: '拼点',
          initiator: ownerId,
          target: turnPlayer,
          initiatorCard: ownerCardId,
          targetCard: targetCardId,
        });

        // 6) 结算
        const ownerWins = ownerRank > targetRank;
        if (ownerWins) {
          // owner 赢:目标本回合不能对除其以外角色用牌
          st.players[turnPlayer].vars[RESTRICTED_KEY] = true;
          await applyAtom(st, {
            type: '回合用量',
            player: turnPlayer,
            key: RESTRICTED_KEY,
            value: true,
          });
        } else {
          // owner 没赢:获得其拼点牌(从弃牌堆移到 owner 手牌)
          await applyAtom(st, {
            type: '移动牌',
            cardId: targetCardId,
            from: { zone: '弃牌堆' },
            to: { zone: '手牌', player: ownerId },
          });
          // 其视为对 owner 使用一张杀
          await virtualKill(st, turnPlayer, ownerId);
        }
      },
    ),
  );

  return () => unloaders.forEach((fn) => fn());
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: DISPLAY_NAME,
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
