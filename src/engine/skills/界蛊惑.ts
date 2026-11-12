// src/engine/skills/界蛊惑.ts
// 界蛊惑(界于吉·群·转化技,OL 界限突破官方逐字):
//   每回合限一次,你可以扣置一张手牌当任意基本牌或普通锦囊牌使用或打出。
//   其他角色可以"同时"质疑并翻开此牌:
//     - 若为假(扣牌真身≠声明),此牌作废,质疑者摸一张牌。
//     - 若为真(扣牌真身=声明),质疑者获得"缠怨"标记,然后弃置一张牌或失去1点体力。
//
// 与标版蛊惑(src/engine/skills/蛊惑.ts)差异:
//   1. 质疑方式:标版"依次"(首个质疑者翻牌,后续不问);界版"同时"——
//      所有其他存活角色并行决定是否质疑,允许多个质疑者。
//   2. 假牌结果:标版质疑者获得此牌;界版质疑者摸一张牌(扣牌仍作废,留弃牌堆)。
//   3. 真牌结果:标版质疑者失去1点体力;界版质疑者获得缠怨标记 + 弃一张牌或失去1点体力。
//   4. 多质疑者:标版仅结算首个;界版每个质疑者都结算(并行问询的必然结果)。
//
// use×3(声明杀/桃/酒)/dodge(闪)/rescue(桃) 五个入口与 onMount 前端动作均复用
// 标版文件的共享实现(registerGuEntries / mountGuActions,见 蛊惑.ts);
// 本文件只保留界版差异:质疑流程 runQuestioning(全面收集)、真/假后果、respond 三分支。
//
// 注:"同时质疑"在引擎中用顺序询问+全面收集实现(不走多目标并行 slot):
//   1) 多目标并行 slot 的 toViewEvents.othersView 用 targets[0] 作为 target 标识,导致非 target
//      viewer 的 view.pending 跟踪 targets[0];当 targets[0] 的 slot resolve 时,
//      harness 的 pendingResolved 处理会误清所有非 target viewer 的 pending
//      (即使其他 slot 仍存活)——与 buildView 不一致。改用 请求回应 逐个问询避免此问题。
//   2) 顺序询问全面收集(不随首问者 break)与同时质疑在游戏状态结果上等价:
//      规则只依赖"最终质疑者集合",不依赖决策时序/信息暴露。
//      (唯一区别是 UX:顺序询问时后问者知道前问者的选择——可在 UI 层面优化为盲选)
//
// 实现差异/边界(相对官方描述):
//   - 简化:仅支持基本牌(杀/桃/酒 use,闪 dodge,桃 rescue);"普通锦囊牌"暂未实现,
//     与标版蛊惑同口径(docs/research/武将技能/群雄/于吉.md "实现要点"沿用)。
//   - 缠怨标记仅作为可见 mark 添加(docs 仅引用"缠怨"名称,未描述其效果——按"描述里
//     没写的不要加"原则不实现额外效果;缠怨作为锁定技需独立技能文件,不在本技能范围)。
//   - 弃牌选择:质疑者无手牌时强制失去1点体力(沿用刚烈 FAQ 模式)。
//   - 多质疑者结算顺序:按座次顺序逐个处理(保证视图可预测)。
import type { FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction } from '../core/skill';
import { registerGuEntries, mountGuActions } from './蛊惑';

const SKILL_ID = '界蛊惑';
const DISPLAY_NAME = '蛊惑'; // OL 官方技能名(不带"界"前缀)

/** 并行质疑 requestType(同时质疑窗口)。 */
const QUESTION_REQUEST = '界蛊惑/质疑';
/** 真牌后续选择 requestType(弃牌或失体力)。 */
const CHOOSE_REQUEST = '界蛊惑/choose';
/** 质疑者列表(Array<number>),由 respond 写入,runQuestioning 读取。 */
const QUESTIONERS_VAR = '界蛊惑/质疑者列表';
/** 弃牌/失体力选择(每个质疑者分别写入),key=`界蛊惑/choice/${seat}`。 */
const CHOOSE_VAR_PREFIX = '界蛊惑/choice/';
/** 扣牌 id(扣牌 atom 写入)。 */
const DOWNCARD_VAR = '蛊惑/扣牌'; // 复用标版 key(扣牌 atom 写此 key)

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '每回合限一次,扣置一张手牌声明为基本牌使用/打出;其他角色可同时质疑:真→缠怨+弃牌或失1体力,假→作废+质疑者摸1牌',
  };
}

/** 对单个质疑者结算"真牌"后果:加缠怨标记 + 选弃一张牌或失去1点体力。
 *  无手牌时强制失去1点体力(沿用刚烈 FAQ 模式)。 */
async function applyTruthConsequence(state: GameState, questioner: number, yuji: number): Promise<void> {
  // 加缠怨标记(scope=questioner,持久——docs 未描述持续时间,按"持久锁定"处理)
  await applyAtom(state, {
    type: '加标记',
    player: questioner,
    mark: { id: '缠怨', scope: questioner },
  });
  const canDiscard = state.players[questioner].hand.length >= 1;
  if (canDiscard) {
    delete state.localVars[CHOOSE_VAR_PREFIX + questioner];
    await applyAtom(state, {
      type: '请求回应',
      requestType: CHOOSE_REQUEST,
      target: questioner,
      prompt: {
        type: 'confirm',
        title: '界蛊惑:弃置一张手牌,或失去1点体力?',
        confirmLabel: '弃置一张手牌',
        cancelLabel: '失去1点体力',
      },
      defaultChoice: false,
      timeout: 30,
    });
    const choice = state.localVars[CHOOSE_VAR_PREFIX + questioner] as string | undefined;
    if (choice === 'discard') {
      const hand = [...state.players[questioner].hand];
      await applyAtom(state, { type: '弃置', player: questioner, cardIds: hand.slice(0, 1) });
      return;
    }
  }
  // 失去1点体力(来源为于吉)
  await applyAtom(state, {
    type: '失去体力',
    target: questioner,
    amount: 1,
  });
  // 注:官方"失去1点体力"——标版蛊惑用「失去体力」atom;此处沿用(不触反馈/奸雄等伤害来源技)
  // yuji 参数留作用 future source 追溯(若改用 造成伤害);当前不消费,避免 lint 报未用。
  void yuji;
}

/** 界蛊惑质疑流程(各入口共用):扣牌 → 质疑循环 → (有人质疑)翻牌结算。
 *  返回 { voided: 是否作废(假牌被质疑), downCard: 扣牌 id, questioners: 质疑者列表 }。
 *
 *  "同时质疑"在引擎中用顺序询问+全面收集实现(不走多目标并行 slot):
 *    1) 多目标并行 slot 的 toViewEvents.othersView 用 targets[0] 作为 target 标识,导致非 target
 *       viewer 的 view.pending 跟踪 targets[0];当 targets[0] 的 slot resolve 时,
 *       harness 的 pendingResolved 处理会误清所有非 target viewer 的 pending
 *       (即使其他 slot 仍存活)——与 buildView 不一致。改用 请求回应 逐个问询避免此问题。
 *    2) 顺序询问全面收集(不随首问者 break)与同时质疑在游戏状态结果上等价:
 *       规则只依赖"最终质疑者集合",不依赖决策时序/信息暴露。
 *       (唯一区别是 UX:顺序询问时后问者知道前问者的选择——可在 UI 层面优化为盲选) */
async function runQuestioning(
  state: GameState,
  yuji: number,
  cardId: string,
  declaredName: string,
): Promise<{ voided: boolean; downCard: string; questioners: number[] }> {
  // ① 扣牌(面朝下,声明公开,真身对他人隐藏)
  await applyAtom(state, { type: '扣牌', player: yuji, cardId, declaredName });

  // ② 质疑循环:从下家起逆时针逐个询问,全部询问完毕才翻牌(同时质疑语义)
  const n = state.players.length;
  const questioners: number[] = [];
  for (let step = 1; step < n; step++) {
    const p = (yuji - step + n) % n;
    if (p === yuji) continue;
    if (!state.players[p]?.alive) continue;
    delete state.localVars[QUESTIONERS_VAR];
    await applyAtom(state, {
      type: '请求回应',
      requestType: QUESTION_REQUEST,
      target: p,
      prompt: {
        type: 'confirm',
        title: `是否质疑于吉声明为【${declaredName}】的蛊惑?`,
      },
      timeout: 20,
    });
    const q = state.localVars[QUESTIONERS_VAR] as number | undefined;
    if (q !== undefined && !questioners.includes(q)) questioners.push(q);
  }

  const downCard = state.localVars[DOWNCARD_VAR] as string;
  if (questioners.length === 0) {
    // ③a 无人质疑 → 按声明生效(不翻牌)
    return { voided: false, downCard, questioners: [] };
  }
  // ③b 有人质疑 → 翻开
  await applyAtom(state, { type: '展示', player: yuji, cardId: downCard });
  const isReal = state.cardMap[downCard]?.name === declaredName;
  if (isReal) {
    // 真:扣牌按声明生效(voided=false);每个质疑者:缠怨 + 弃一张牌或失去1点体力
    // 按质疑询问顺序(逆时针)逐个结算,保证视图可预测且符合方向约定
    for (const q of questioners) {
      if (!state.players[q]?.alive) continue; // 结算过程中死亡则跳过
      await applyTruthConsequence(state, q, yuji);
    }
    return { voided: false, downCard, questioners };
  }
  // 假:扣牌作废(留弃牌堆);每个质疑者摸一张牌
  for (const q of questioners) {
    if (!state.players[q]?.alive) continue;
    await applyAtom(state, { type: '摸牌', player: q, count: 1 });
  }
  return { voided: true, downCard, questioners };
}

/** 清理本次蛊惑临时 localVars。 */
function cleanupVars(state: GameState): void {
  delete state.localVars[DOWNCARD_VAR];
  delete state.localVars[QUESTIONERS_VAR];
  // 清理所有 choice 变量(按前缀扫描)
  for (const key of Object.keys(state.localVars)) {
    if (key.startsWith(CHOOSE_VAR_PREFIX)) delete state.localVars[key];
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const unloaders = registerGuEntries(state, skill, {
    skillKey: SKILL_ID,
    runQuestioning,
    cleanupVars,
  });

  // ── respond(注册到每个座次:被蛊惑问询的角色,含 ownerId 本人)──
  //   1. 同时质疑窗口(请求回应 slot,requestType='界蛊惑/质疑'):choice=true 加入质疑者列表。
  //   2. 真牌后续选择窗口(请求回应 slot,requestType='界蛊惑/choose'):choice=true 弃牌,false 失体力。
  //  注:与 ownerId 上的 use/dodge/rescue 共存,各 actionType 独立不冲突。
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, _params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          const atom = slot.atom as { type: string; requestType?: string };
          if (atom.type !== '请求回应') return '当前不需要回应';
          const rt = atom.requestType;
          if (rt !== QUESTION_REQUEST && rt !== CHOOSE_REQUEST)
            return '当前不是界蛊惑问询窗口';
          if (!st.players[seat]?.alive) return '你已死亡';
          return null;
        },
        async (st: GameState, params: Record<string, Json>) => {
          const slot = st.pendingSlots.get(seat);
          const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
          if (rt === QUESTION_REQUEST) {
            // choice=true/confirmed=true → 质疑;pass/超时/choice=false → 不质疑
            const questioned = params.choice === true || params.confirmed === true;
            if (!questioned) return;
            // 顺序询问:直接记录当前座次为质疑者(供 runQuestioning 读取)
            st.localVars[QUESTIONERS_VAR] = seat;
          } else if (rt === CHOOSE_REQUEST) {
            // choice=true → 弃一张牌;choice=false/缺省 → 失去1点体力
            st.localVars[CHOOSE_VAR_PREFIX + seat] =
              params.choice === true ? 'discard' : 'damage';
          }
        },
      ),
    );
  }

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  return mountGuActions(api, SKILL_ID);
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
