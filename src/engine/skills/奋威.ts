// 奋威(界甘宁·限定技):当一张锦囊牌指定多个目标后,
// 你可以令此牌对任意个目标无效。
//
// 官方文本(hero/305):"限定技,当一张锦囊牌指定多个目标后,你可以令此牌对任意个目标无效。"
//
// 实现策略(两类多目标锦囊):
//
//   A. 全体锦囊(南蛮/万箭/桃园/五谷):结算循环中对每个目标独立询问无懈可击。
//      无懈抵消机制按目标独立:localVars[`无懈/被抵消/${target}`]=true 时该目标被跳过。
//      奋威复用此机制——在被抵消目标的无懈窗口打开前(before-hook on 请求回应),
//      直接设抵消标记并取消无懈窗口,等价于"令此牌对该目标无效"。
//
//   B. 铁索连环(含界庞统的 3 目标版):整卡一次无懈(cancelTarget=使用者),
//      不逐目标询问无懈。奋威改用"设横置 before-hook 拦截":在唯一无懈窗口打开前
//      触发奋威面板,选定无效目标集合后,在 设横置 atom 的 before-hook 中对集合内
//      目标返回 cancel,等价于"令此牌对该目标无效"。不取消无懈窗口本身——无懈与奋威
//      互不干扰:无懈若打出则整卡取消(全体目标不受影响),奋威仅在卡生效时逐目标剔除。
//
// 触发时机:"当一张锦囊牌指定多个目标后" = 多目标锦囊的无懈窗口打开前。
//   同一锦囊只触发一次(cardId 去重标记 PROCESSED_PREFIX)。
//
// 限定技:player.vars['奋威/used'](整局一次,不被 回合结束 清理)。
import type {
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

/**
 * 运行奋威询问流程(确认 + 多选目标),返回被选中的无效目标集合。
 * - 返回 null:不发动(确认选否)或空选 → 限定技未消耗
 * - 返回 number[]:成功,限定技已标记 USED_KEY
 */
async function runFenweiPanel(
  st: GameState,
  ownerId: number,
  skillName: string,
  targets: number[],
): Promise<number[] | null> {
  // 1) 询问是否发动奋威
  delete st.localVars[CONFIRMED_KEY];
  await applyAtom(st, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: `是否发动奋威?(限定技:令${skillName}对任意个目标无效)`,
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 15,
  });
  if (!st.localVars[CONFIRMED_KEY]) return null; // 不发动

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
      candidates: targets,
      filter: (_view: unknown, t: number) => targets.includes(t),
    },
    timeout: 30,
  });

  const chosen = st.localVars[CHOSEN_KEY] as number[] | undefined;
  delete st.localVars[CHOSEN_KEY];
  if (!chosen || chosen.length === 0) return null;

  // 标记限定技已使用
  st.players[ownerId].vars[USED_KEY] = true;
  return chosen;
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
    async (ctx): Promise<{ kind: 'cancel' } | void> => {
      const atom = ctx.atom;
      if (atom.requestType !== '无懈可击') return;

      const cancelTarget = atom.cancelTarget;
      if (typeof cancelTarget !== 'number') return;

      const st = ctx.state;
      const frame = topFrame(st);
      if (!frame) return;

      const mode = MULTI_TARGET_SCROLLS[frame.skillId];
      const isChain = frame.skillId === '铁索连环';
      if (!mode && !isChain) return; // 非支持的多目标锦囊

      const cardId = frame.params?.cardId as string | undefined;
      const invalidKey = cardId ? `${INVALID_PREFIX}${cardId}` : null;
      const invalidSet = invalidKey
        ? (st.localVars[invalidKey] as number[] | undefined)
        : undefined;

      // Path A(全体锦囊):当前目标已被奋威标记无效 → 设抵消标记 + 取消无懈窗口
      // 铁索连环不做目标级无懈取消(整卡一次无懈),无效由 设横置 hook 处理。
      if (mode && invalidSet && invalidSet.includes(cancelTarget)) {
        st.localVars[`无懈/被抵消/${cancelTarget}`] = true;
        return { kind: 'cancel' };
      }

      // 首次触发判定(同一锦囊只触发一次)
      if (!cardId) return;
      if (st.localVars[`${PROCESSED_PREFIX}${cardId}`]) return;
      if (st.players[ownerId]?.vars[USED_KEY]) return; // 限定技已用
      if (!st.players[ownerId]?.alive) return;

      // 计算多目标锦囊的目标集合
      let targets: number[];
      if (mode) {
        targets = computeScrollTargets(st, mode, frame.from);
      } else {
        // 铁索连环:仅使用者的唯一无懈窗口触发(cancelTarget === from)
        if (cancelTarget !== frame.from) return;
        const t = (frame.params?.targets as number[] | undefined) ?? [];
        targets = t;
      }
      if (targets.length <= 1) return; // 非多目标

      st.localVars[`${PROCESSED_PREFIX}${cardId}`] = true; // 标记已处理

      const chosen = await runFenweiPanel(st, ownerId, frame.skillId, targets);
      if (!chosen) return; // 不发动或空选

      // 存储无效目标集合(供后续 before-hook 检查)
      st.localVars[`${INVALID_PREFIX}${cardId}`] = chosen;

      // Path A(全体锦囊):当前目标若被选中 → 设抵消标记 + 取消无懈窗口
      if (mode && chosen.includes(cancelTarget)) {
        st.localVars[`无懈/被抵消/${cancelTarget}`] = true;
        return { kind: 'cancel' };
      }
      // 铁索连环:不取消无懈窗口,无效由 设横置 hook 处理
    },
  );

  // ── 设横置 before-hook:铁索连环逐目标无效(Path B)──
  // 铁索连环结算循环中对每个目标 applyAtom(设横置);本 hook 对奋威选定无效的目标
  // 返回 cancel,跳过其横置切换,等价于"令此牌对该目标无效"。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '设横置',
    async (ctx): Promise<{ kind: 'cancel' } | void> => {
      const st = ctx.state;
      const frame = topFrame(st);
      if (!frame || frame.skillId !== '铁索连环') return;

      const atom = ctx.atom;
      if (typeof atom.player !== 'number') return;

      const cardId = frame.params?.cardId as string | undefined;
      if (!cardId) return;

      const invalidSet = st.localVars[`${INVALID_PREFIX}${cardId}`] as
        | number[]
        | undefined;
      if (!invalidSet || !invalidSet.includes(atom.player)) return;

      return { kind: 'cancel' };
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
