// 朱雀羽扇(武器,攻击范围 4):
//   你可以将一张普通【杀】当火【杀】使用;你可以将视为使用【杀】改为视为使用火【杀】。
//
// 模型(组合 action,与疠火/丈八蛇矛同形):前端两步 UI(选普通杀 → 点朱雀羽扇 → 选目标),
// 提交时一个 ClientMessage:preceding=[朱雀羽扇.transform] + 主 action=杀.use。
// 后端 dispatch 先执行 朱雀羽扇.transform(用 当作 atom 创建一张火杀影子),
// 再 杀.use validate 看到"杀"通过。杀技能零感知朱雀羽扇——
// 它看到的永远是 cardMap 里的一张"杀"(damageType='火焰')。
//
// 与疠火的关键差异:
//   1. 朱雀羽扇仅转化"普通杀"(damageType 为空/普通),不转化雷杀/火杀。
//   2. 朱雀羽扇是纯转化,无代价、无多目标、无额外 hook。
//
// 影子卡模型与武圣一致:1 张原卡 → 1 张影子(suit/color 继承原卡,shadowOf 指向原卡),
// 引擎按 shadowOf 在影子离开结算区时自动还原原卡。
import type {
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../index';
import { registerAction, hasBlockingPending } from '../skill';
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

  // ── transform action(preceding,主 action=杀.use 之前执行):普通杀 → 火杀影子 ──
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
  );

  return () => {};
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
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
