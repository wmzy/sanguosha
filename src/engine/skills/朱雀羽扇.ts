// 朱雀羽扇(武器,攻击范围 4):
//   你可以将一张普通【杀】当火【杀】使用;你可以将视为使用【杀】改为视为使用火【杀】。
//
// 两条发动路径:
//   A. 使用时询问(主路径,OL 式):owner 直接使用普通杀时,「使用时」after-hook 弹
//      confirm 询问"是否发动朱雀羽扇将此杀改为火杀"(与麒麟弓/雌雄双股剑同款模式)。
//      确认后原卡 damageType 临时改为 '火焰'——后续全部时机(藤甲检测有效性/
//      伤害属性/铁索传导)读 cardMap.damageType,天然生效。牌离开处理区或技能
//      卸载时还原原属性,防止牌堆真源被永久污染。火杀/雷杀/transform 影子不询问。
//   B. transform 组合 action(与疠火/丈八蛇矛同形):选普通杀 → 点朱雀羽扇 → 选目标,
//      提交 preceding=[朱雀羽扇.transform] + 主 action=杀.use。后端先创建火杀影子
//      (shadowOf 还原),再 杀.use。保留此路径供"使用前转化"场景
//      (如 界疠火+羽扇:先转火杀才可多指定一个目标)。
//
// 与疠火的关键差异:
//   1. 朱雀羽扇仅转化"普通杀"(damageType 为空/普通),不转化雷杀/火杀。
//   2. 朱雀羽扇是纯转化,无代价、无多目标。
//
// 影子卡模型与武圣一致:1 张原卡 → 1 张影子(suit/color 继承原卡,shadowOf 指向原卡),
// 引擎按 shadowOf 在影子离开结算区时自动还原原卡。
import type {
  Card,
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook, hasBlockingPending } from '../core/skill';
import { defaultPlayActive, viewCanSlash } from '../rules/action-active';

/** 是否为普通杀(damageType 为空或 '普通',即非火杀/雷杀) */
function isNormalSlash(
  card: { name: string; damageType?: string } | undefined,
): card is { name: string; damageType?: string } {
  return (
    !!card &&
    card.name === '杀' &&
    (!card.damageType || card.damageType === '普通')
  );
}

/** 影子卡 id:${原id}#朱雀羽扇 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#朱雀羽扇`;
}

/** owner 是否发动 confirm 询问的 requestType(客户端按首段路由回 skillId='朱雀羽扇') */
const CONFIRM_REQUEST = '朱雀羽扇/confirm';
/** localVars key:confirm 结果(true=发动) */
const CONFIRMED_VAR = '朱雀羽扇/confirmed';
/** localVars key 前缀:被羽扇临时改性的牌 → 原 damageType(null=原本无属性)。 */
const ORIG_PREFIX = '朱雀羽扇/origType:';
function origTypeKey(cardId: string): string {
  return `${ORIG_PREFIX}${cardId}`;
}

/** 还原一张被羽扇临时改性的牌的原属性(幂等;未被改性时无操作)。 */
function restoreOrigType(state: GameState, cardId: string): void {
  const key = origTypeKey(cardId);
  if (!(key in state.localVars)) return;
  const orig = state.localVars[key];
  delete state.localVars[key];
  const card = state.cardMap[cardId];
  if (!card) return; // 虚拟卡已被调用方清理
  if (orig === null) delete card.damageType;
  else card.damageType = orig as Card['damageType'];
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '朱雀羽扇',
    description: '你可将一张普通杀当火杀使用或打出。',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── transform action(preceding,主 action=杀.use 之前执行):普通杀 → 火杀影子 ──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'transform',
      (state: GameState, params: Record<string, Json>) => {
        // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending + 存活
        const myTurn = state.currentPlayerIndex === ownerId;
        const inActPhase = state.phase === '出牌';
        const free = !hasBlockingPending(state);
        const self = state.players[ownerId];
        const selfAlive = self?.alive === true;
        const cardId = params.cardId as string;
        const cardIdOk = typeof cardId === 'string';
        const card = cardIdOk ? state.cardMap[cardId] : undefined;
        const cardInHand = cardIdOk && !!self && self.hand.includes(cardId);
        // 仅普通杀可转化(非火杀、非雷杀)
        const ok =
          myTurn &&
          inActPhase &&
          free &&
          selfAlive &&
          cardInHand &&
          isNormalSlash(card);
        return ok ? null : '现在不能使用朱雀羽扇';
      },
      async (state: GameState, params: Record<string, Json>) => {
        const cardId = params.cardId as string;
        const shadowId = shadowIdOf(cardId);
        // 通过 当作 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
        // outputDamageType='火焰' 是朱雀羽扇核心:普通杀转化为火杀
        await applyAtom(state, {
          type: '当作',
          player: ownerId,
          cardIds: [cardId],
          shadowId,
          outputName: '杀',
          outputDamageType: '火焰',
        });
      },
      // rollback:主 action validate 失败时撤销转化(删影子、还原手牌)
      (state: GameState, params: Record<string, Json>) => {
        const cardId = params.cardId as string;
        const shadowId = shadowIdOf(cardId);
        delete state.cardMap[shadowId];
        state.players[ownerId].hand = state.players[ownerId].hand.map((id) =>
          id === shadowId ? cardId : id,
        );
      },
    ),
  );

  // ── respond action:owner 回应「使用普通杀时是否发动」的 confirm 询问 ──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'respond',
      (st: GameState, _params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(ownerId);
        if (slot?.atom.type !== '请求回应') return '当前不需要回应';
        if ((slot.atom as { requestType?: string }).requestType !== CONFIRM_REQUEST) {
          return '当前不是朱雀羽扇询问';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        st.localVars[CONFIRMED_VAR] = params.choice === true;
      },
    ),
  );

  // ── 使用时 after-hook(主路径):owner 使用普通杀时询问是否改为火杀 ──
  // 仅普通杀触发(火杀/雷杀/transform 影子已是属性杀,不询问)。
  // 借刀杀人/激将等 forced 使用同样走 runUseFlow → 照常询问(规则:你使用普通杀)。
  // 打出(决斗/南蛮回应)不走 runUseFlow,无 使用时 atom → 不询问(属性对打出无机制意义)。
  unloaders.push(
    registerAfterHook(state, skill.id, ownerId, '使用时', async (ctx) => {
      const atom = ctx.atom as { source: number; cardId?: string };
      if (atom.source !== ownerId) return;
      const cardId = atom.cardId;
      if (!cardId) return;
      const card = ctx.state.cardMap[cardId];
      if (!isNormalSlash(card)) return;
      const self = ctx.state.players[ownerId];
      if (!self) return;
      // 动态装备校核:owner 武器槽仍是朱雀羽扇(装备可能同帧被换下)
      const weaponId = self.equipment['武器'];
      if (!weaponId || ctx.state.cardMap[weaponId]?.name !== '朱雀羽扇') return;

      // 询问是否发动(默认不发动;超时不回应 → CONFIRMED_VAR 未设 → 不发动)
      delete ctx.state.localVars[CONFIRMED_VAR];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '朱雀羽扇:是否发动,将此【杀】改为火【杀】?',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      const confirmed = ctx.state.localVars[CONFIRMED_VAR] === true;
      delete ctx.state.localVars[CONFIRMED_VAR];
      if (!confirmed) return;

      // 转化:原卡属性改为火焰,仅本次使用有效(离开处理区时还原)。
      // 后续 检测有效性(藤甲)/伤害流程/铁索传导 均读 cardMap.damageType,天然生效。
      ctx.state.localVars[origTypeKey(cardId)] = card.damageType ?? null;
      card.damageType = '火焰';
    }),
  );

  // ── 移动牌 after-hook:改性的杀离开处理区(收尾进弃牌堆/被技能回收)时还原 ──
  unloaders.push(
    registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
      const atom = ctx.atom as { cardId?: string; from?: { zone?: string } };
      if (atom.from?.zone !== '处理区') return;
      const cardId = atom.cardId;
      if (typeof cardId !== 'string') return;
      restoreOrigType(ctx.state, cardId);
    }),
  );

  return () => {
    for (const fn of unloaders) fn();
    // 技能卸载兜底(装备被换下/owner 死亡):还原所有仍被临时改性的牌,防牌堆真源污染
    for (const key of Object.keys(state.localVars)) {
      if (key.startsWith(ORIG_PREFIX)) restoreOrigType(state, key.slice(ORIG_PREFIX.length));
    }
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  // transform:前端选普通杀 → 选目标 → 点朱雀羽扇按钮 → 提交 preceding=[朱雀羽扇.transform] + 主 action=杀.use
  api.defineAction('transform', {
    label: '朱雀羽扇',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '朱雀羽扇:将普通【杀】当火【杀】使用',
      // 仅选普通杀(非火杀/雷杀)
      cardFilter: {
        filter: (c) => c.name === '杀' && (!c.damageType || c.damageType === '普通'),
        min: 1,
        max: 1,
      },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) => {
          // 排除自己;具体距离校验由后端 杀.use validate 处理
          const cp = view.currentPlayerIndex;
          return t !== cp;
        },
      },
    },
    activeWhen: (ctx) =>
      defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx),
  });

  // respond:「是否发动朱雀羽扇」confirm 询问的 UI 定义(与 pending 槽 prompt 同文案)
  api.defineAction('respond', {
    label: '朱雀羽扇',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '朱雀羽扇:是否发动,将此【杀】改为火【杀】?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
