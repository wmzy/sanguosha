// 从谏(张绣·群·被动技,风林火山 hero/415 官方逐字):
//   "当你成为锦囊牌的目标时,若此牌的目标数大于1,你可以交给其中一名目标角色一张牌,
//    然后摸一张牌,若你给出的牌是装备牌,改为摸两张牌。"
//
// 模式 A(锁定/被动触发):registerAfterHook('成为目标')。
//   触发条件:atom.target===owner(张绣成为目标)+ 牌为锦囊牌 + 目标数>1 + 手牌非空。
//   流程:请求回应(useCardAndTarget:选一张手牌 + 选一名本牌目标)→ 给予 → 摸牌。
//   可选:玩家 pass/超时 = 不发动(无 cardId)。
//
// 摸牌数:给出装备牌 → 2 张;其他 → 1 张。
//   给出后牌的类型由 cardMap[cardId].type 判定('装备牌')。
//
// 目标角色:本张锦囊牌的全部目标(ctx.params.resolvedTargets)。
//   张绣自身也是目标之一,允许交给自己(描述未排除;交给自身=换牌+摸牌)。
//
// 跨 atom 通信:
//   localVars['从谏/给牌'] = { cardId, target } | null(respond 写,after-hook 读)
//   localVars['从谏/可选目标'] = number[](本牌目标列表,respond validate 读)
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';

const SKILL_NAME = '从谏';

/** requestType:给牌选择询问(前缀=skillId,见 T1) */
const GIVE_RT = '从谏/给牌';
/** localVars key:respond 写入的给牌选择 {cardId, target} | null */
const CHOICE_LV = '从谏/给牌';
/** localVars key:本牌目标列表(respond validate 校验目标合法性) */
const TARGETS_LV = '从谏/可选目标';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_NAME,
    description:
      '当你成为锦囊牌的目标时,若此牌的目标数大于1,你可以交给其中一名目标角色一张牌,然后摸一张牌,若你给出的是装备牌,改为摸两张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:张绣本人回应给牌询问 ──
  const unloadAction = registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== GIVE_RT) return '当前不是从谏询问';
      // 无 cardId = 放弃发动(pass/超时)
      const cardId = params.cardId as string | undefined;
      if (!cardId) return null;
      // 校验:牌在手牌中
      if (!st.players[ownerId]?.hand.includes(cardId)) return '牌不在手牌中';
      // 校验:目标在本牌目标列表内
      const validTargets = st.localVars[TARGETS_LV] as number[] | undefined;
      const target =
        (params.target as number | undefined) ??
        (Array.isArray(params.targets) ? (params.targets as number[])[0] : undefined);
      if (typeof target !== 'number') return '请选择一名目标角色';
      if (!Array.isArray(validTargets) || !validTargets.includes(target)) return '目标不在本牌目标中';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) {
        st.localVars[CHOICE_LV] = null;
        return;
      }
      const target =
        (params.target as number | undefined) ??
        (Array.isArray(params.targets) ? (params.targets as number[])[0] : undefined);
      if (typeof target !== 'number') {
        st.localVars[CHOICE_LV] = null;
        return;
      }
      st.localVars[CHOICE_LV] = { cardId, target } as unknown as Json;
    },
  );

  // ── 成为目标 after-hook:张绣成为多目标锦囊的目标时触发 ──
  const unloadHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '成为目标',
    async (ctx): Promise<void> => {
      const atom = ctx.atom as { target?: number; cardId?: string };
      if (atom.target !== ownerId) return;
      const st = ctx.state;
      const self = st.players[ownerId];
      if (!self?.alive) return;
      // 牌须为锦囊牌
      const card = atom.cardId ? st.cardMap[atom.cardId] : undefined;
      if (!card || card.type !== '锦囊牌') return;
      // 本牌目标数 > 1(读结算帧 resolvedTargets)
      const resolved = (ctx.params.resolvedTargets as number[] | undefined) ??
        (ctx.params.targets as number[] | undefined) ??
        [];
      if (resolved.length <= 1) return;
      // 无手牌 → 无法交给,跳过(描述"交给...一张牌"为必要动作)
      if (self.hand.length === 0) return;

      // 记录本牌目标列表,供 respond validate + prompt filter 使用
      const validTargets = resolved.filter((t) => st.players[t]?.alive);
      st.localVars[TARGETS_LV] = validTargets;

      // 发出给牌询问(可选:pass/超时 = 不发动)
      delete st.localVars[CHOICE_LV];
      await applyAtom(st, {
        type: '请求回应',
        requestType: GIVE_RT,
        target: ownerId,
        prompt: {
          type: 'useCardAndTarget',
          title: '从谏:交给一名目标角色一张牌(装备牌摸两张,其他摸一张);不交可放弃',
          cardFilter: { filter: () => true, min: 1, max: 1 },
          targetFilter: {
            min: 1,
            max: 1,
            filter: (_view, t) => validTargets.includes(t) && !!_view.players[t]?.alive,
          },
        },
        timeout: 30,
      });

      const choice = st.localVars[CHOICE_LV] as { cardId: string; target: number } | null | undefined;
      delete st.localVars[CHOICE_LV];
      delete st.localVars[TARGETS_LV];
      if (!choice) return; // 放弃发动

      // 给予牌(张绣手牌 → 目标手牌)
      await applyAtom(st, {
        type: '给予',
        cardId: choice.cardId,
        from: ownerId,
        to: choice.target,
      });

      // 摸牌:装备牌 → 2;其他 → 1
      const givenCard = st.cardMap[choice.cardId];
      const drawCount = givenCard?.type === '装备牌' ? 2 : 1;
      await applyAtom(st, { type: '摸牌', player: ownerId, count: drawCount });
    },
  );

  return () => {
    unloadAction();
    unloadHook();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动技:无主动 action,无前端按钮(由 after-hook 被动触发)
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
