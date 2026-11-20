// 界连营(界陆逊·被动技):当你失去所有手牌后,你可以令至多X名角色各摸一张牌
//   (X为你失去的手牌数)。
//
// 与标 连营 的区别:标版"自己摸一张" → 界版"令至多X名角色各摸一张"。
//   X 定义:OL 现行版为「失去的手牌数」(本次使手牌归零的那次失去事件中失去的手牌张数),
//   不是早期版本的体力值。配合界谦逊把整手牌移出时可触发超大 X 的连营,是这套技能联动的核心。
//
// 六对手牌减少路径 hook(移动牌/给予/装备/移出至暂存区/获得/弃置)与 respond 骨架
// 复用标版连营导出的 createLianyingSkill 工厂;本文件只写差异:
//   - 触发结算:确认后 choosePlayer(min=1,max=X) 选目标,对每个目标各 摸牌(count=1)。
//   - respond 增加选目标分支(SELECT_RT)。
//
// X 计数机制(关键):
//   - 工厂内每个 before-hook 在涉及界陆逊手牌时,写入 HAND_BEFORE_KEY = apply 前的手牌数。
//   - 对应 after-hook 读取并删除 HAND_BEFORE_KEY,作为 lostCount 传入 trigger(即 X)。
//   - 移出游戏(界谦逊)一次移走 N 张整手牌 → before 记 N、after 手牌归零 → X=N(联动核心)。
//   - 移动牌/给予/装备 单张移走 → X=1(失去最后一张的边界)。
//   - 获得/弃置 可能作用于装备/判定区(非手牌),before-hook 仅在涉及手牌时写入。
//
// 其他关键点:
//   - "角色"含自己 → 不排除自己(filter 仅校验存活)
//   - "至多X名"是硬规则:max 在引擎侧 clamp(防止越权客户端多选)
//   - 摸牌不减少手牌,不会自递归
//   - 牌堆+弃牌堆皆空 → 无法摸牌,跳过询问(工厂公共守卫)
import type { GameView, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { currentRequestType, askConfirm } from '../util/skillRuntime';
import { createLianyingSkill, type LianyingOptions } from './连营';

const TRIGGER_RT = '界连营/trigger';
const SELECT_RT = '界连营/select';
const CONFIRMED_KEY = '界连营/confirmed';
const TARGETS_KEY = '界连营/targets';
// before-hook 写入:本次 atom 涉及界陆逊手牌时,记录 apply 前的手牌数(>=1),作为 X
const HAND_BEFORE_KEY = '界连营/handBefore';

const OPTIONS: LianyingOptions = {
  skillName: '界连营',
  description: '被动技:当你失去所有手牌后,你可以令至多X名角色各摸一张牌(X为你失去的手牌数)',
  confirmRt: TRIGGER_RT,
  confirmedKey: CONFIRMED_KEY,
  handBeforeKey: HAND_BEFORE_KEY,
  respondRts: [TRIGGER_RT, SELECT_RT],
  mismatchError: '当前不是界连营回应',
  trigger: async (state, ownerId, lostCount) => {
    // X = 失去的手牌数;失去数 <1 视为非手牌归零事件,跳过
    const X = lostCount;
    if (X < 1) return;

    // 存活角色数(含自己),max 不超过存活数
    const aliveCount = state.players.filter((p) => p.alive).length;
    const maxTargets = Math.min(X, aliveCount);
    if (maxTargets < 1) return;

    // ① 是否发动界连营
    const confirmed = await askConfirm(state, TRIGGER_RT, ownerId, {
      confirmedKey: CONFIRMED_KEY,
      title: `是否发动界连营?(失去${X}张手牌,令至多${maxTargets}名角色各摸一张牌)`,
      confirmLabel: '发动',
      cancelLabel: '不发动',
      defaultChoice: false,
      timeout: 10,
    });
    if (confirmed !== true) return;

    // ② 选择 1~maxTargets 名角色(含自己)各摸一张
    delete state.localVars[TARGETS_KEY];
    await applyAtom(state, {
      type: '请求回应',
      requestType: SELECT_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: `界连营:选择至多${maxTargets}名角色(各摸一张牌)`,
        min: 1,
        max: maxTargets,
        filter: (view: GameView, target: number) => view.players[target]?.alive === true,
      },
      timeout: 20,
    });

    const rawTargets = state.localVars[TARGETS_KEY] as number[] | undefined;
    // 仅保留存活目标,去重(各摸一张牌 → 同一角色只摸一次),并按"至多X名"硬规则 clamp(防越权多选)
    const targets = (
      Array.isArray(rawTargets)
        ? rawTargets.filter(
            (t, i, arr) => state.players[t]?.alive === true && arr.indexOf(t) === i,
          )
        : []
    ).slice(0, maxTargets);

    // 各摸一张牌
    for (const target of targets) {
      await applyAtom(state, { type: '摸牌', player: target, count: 1 });
    }
  },
  respondExecute: (st, ownerId, params) => {
    const rt = currentRequestType(st, ownerId);
    if (rt === TRIGGER_RT) {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    } else if (rt === SELECT_RT) {
      // dispatch 入口已统一补齐 targets/target 两种形状,直接读 targets
      st.localVars[TARGETS_KEY] = (params.targets) ?? [];
    }
  },
  mount: {
    label: '界连营',
    title: '是否发动界连营?',
    confirmLabel: '发动(令角色摸牌)',
    style: 'default',
  },
};

export const { createSkill, onInit, onMount } = createLianyingSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
