// 奋威(界甘宁·限定技):当一张锦囊牌指定多个目标后,
// 你可以令此牌对任意个目标无效。
//
// 官方文本(hero/305):"限定技,当一张锦囊牌指定多个目标后,你可以令此牌对任意个目标无效。"
//
// 实现策略:
//   全体锦囊(南蛮/万箭/桃园/五谷)在结算循环中对每个目标独立询问无懈可击。
//   无懈抵消机制按目标独立:localVars[`无懈/被抵消/${target}`]=true 时该目标被跳过。
//   奋威复用此机制——在被抵消目标的无懈窗口打开前(before-hook on 请求回应),
//   直接设抵消标记并取消无懈窗口,等价于"令此牌对该目标无效"。
//
// 触发时机:"当一张锦囊牌指定多个目标后" = 多目标锦囊的第一个无懈窗口打开前。
//   全体锦囊对第一个目标调用 询问无懈可击 时,本 hook 拦截,检测到 frame.skillId
//   属于多目标锦囊且目标数>1,弹出奋威确认+多选面板。
//   同一锦囊只触发一次(cardId 去重标记),后续目标仅检查是否在"无效集合"中。
//
// 限定技:player.vars['奋威/used'](整局一次,不被 回合结束 清理)。
//
// 局限:铁索连环采用"整卡一次无懈"(cancelTarget=使用者),不支持逐目标无效,
// 故奋威不支持铁索连环(标准全体锦囊场景已覆盖)。
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

const USED_KEY = '奋威/used';
const CONFIRM_RT = '奋威/confirm';
const CHOOSE_RT = '奋威/choose';
const CONFIRMED_KEY = '奋威/confirmed';
const CHOSEN_KEY = '奋威/chosenTargets';
const INVALID_PREFIX = '奋威/无效/';
const PROCESSED_PREFIX = '奋威/已处理/';

// 全体锦囊(多目标,逐目标询问无懈)。键=frame.skillId,值=目标计算模式。
const MULTI_TARGET_SCROLLS: Record<string, 'allOthers' | 'allAlive'> = {
  南蛮入侵: 'allOthers',
  万箭齐发: 'allOthers',
  桃园结义: 'allAlive',
  五谷丰登: 'allAlive',
};

function computeScrollTargets(
  state: GameState,
  mode: string,
  from: number,
): number[] {
  const alive = state.players.filter((p) => p.alive).map((p) => p.index);
  if (mode === 'allOthers') return alive.filter((i) => i !== from);
  return alive; // allAlive
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '奋威',
    description: '限定技,当一张锦囊牌指定多个目标后,你可以令此牌对任意个目标无效',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond action:处理 confirm/choose 询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== CHOOSE_RT) return '当前不是奋威询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === CHOOSE_RT) {
        const targets = params.targets as number[] | undefined;
        if (Array.isArray(targets)) st.localVars[CHOSEN_KEY] = targets;
      }
    },
  );

  // ── 请求回应 before-hook:拦截无懈窗口,触发奋威 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '请求回应',
    async (ctx: AtomBeforeContext): Promise<{ kind: 'cancel' } | void> => {
      const atom = ctx.atom as { requestType?: string; cancelTarget?: number };
      if (atom.requestType !== '无懈可击') return;

      const cancelTarget = atom.cancelTarget;
      if (typeof cancelTarget !== 'number') return;

      const st = ctx.state;
      const frame = topFrame(st);
      if (!frame) return;

      const mode = MULTI_TARGET_SCROLLS[frame.skillId];
      if (!mode) return; // 非支持的多目标锦囊

      const cardId = frame.params?.cardId as string | undefined;
      const invalidKey = cardId ? `${INVALID_PREFIX}${cardId}` : null;
      const invalidSet = invalidKey
        ? (st.localVars[invalidKey] as number[] | undefined)
        : undefined;

      // 当前目标已被奋威标记无效 → 设抵消标记 + 取消无懈窗口
      if (invalidSet && invalidSet.includes(cancelTarget)) {
        st.localVars[`无懈/被抵消/${cancelTarget}`] = true;
        return { kind: 'cancel' };
      }

      // 首次无懈查询 → 触发奋威面板(同一锦囊只触发一次)
      if (!cardId) return;
      if (st.localVars[`${PROCESSED_PREFIX}${cardId}`]) return;
      if (st.players[ownerId]?.vars[USED_KEY]) return; // 限定技已用
      if (!st.players[ownerId]?.alive) return;

      const targets = computeScrollTargets(st, mode, frame.from);
      if (targets.length <= 1) return; // 非多目标

      st.localVars[`${PROCESSED_PREFIX}${cardId}`] = true; // 标记已处理

      // 1) 询问是否发动奋威
      delete st.localVars[CONFIRMED_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动奋威?(限定技:令${frame.skillId}对任意个目标无效)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!st.localVars[CONFIRMED_KEY]) return; // 不发动

      // 2) 多选目标面板(选任意个令其无效)
      delete st.localVars[CHOSEN_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CHOOSE_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '奋威:选择要令其无效的目标(可多选)',
          min: 1,
          max: targets.length,
          filter: (_view: unknown, t: number) => targets.includes(t),
        },
        timeout: 30,
      });

      const chosen = st.localVars[CHOSEN_KEY] as number[] | undefined;
      delete st.localVars[CHOSEN_KEY];
      if (!chosen || chosen.length === 0) return;

      // 标记限定技已使用
      st.players[ownerId].vars[USED_KEY] = true;
      // 存储无效目标集合(供后续目标的 before-hook 检查)
      st.localVars[`${INVALID_PREFIX}${cardId}`] = chosen;

      // 当前目标若被选中 → 设抵消标记 + 取消无懈窗口
      if (chosen.includes(cancelTarget)) {
        st.localVars[`无懈/被抵消/${cancelTarget}`] = true;
        return { kind: 'cancel' };
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '奋威',
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '奋威',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
