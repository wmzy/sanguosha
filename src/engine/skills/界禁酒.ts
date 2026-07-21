// 界禁酒(界高顺·群·锁定技,OL hero/604 界限突破官方逐字):
//   "锁定技，你的【酒】视为点数K的【杀】。其他角色不能于你的回合使用【酒】。"
//
// 与标版 高顺 禁酒(docs/research/武将技能/群雄/高顺.md)对比:
//   - 标版:"你的【酒】视为【杀】"(未指定点数)。
//   - 界版:"你的【酒】视为点数K的【杀】"(显式点数 K,拼点/烈弓等读点数场景更稳定)。
//   - 界版新增"其他角色不能于你的回合使用【酒】"(回合内禁他人酒救援)。
//   两版有差异 + 标版高顺未实现 → 独立界版文件。
//
// 实现要点:
//   - 锁定技,自动生效,无主动询问。
//   - "你的【酒】视为点数K的【杀】":转化技模式(镜像 武圣/酒池)。
//     owner 选一张【酒】手牌 → 点 禁酒 → 提交 preceding=[界禁酒.transform] + 主 action=杀.use。
//     transform 创建影子卡(名=杀,点数=K,影子 id 键 '界禁酒' 与标版隔离)。
//     杀技能零感知界禁酒——它看到的永远是 cardMap 里的一张"杀"(点数 K)。
//     酒的所有原本使用方式(增伤/濒死当桃)依然保留——禁酒只是"额外可用作 K 杀"。
//   - "其他角色不能于你的回合使用【酒】":wrap 其他玩家(非 owner)的 酒.respond action。
//     界禁酒.onInit 时,遍历所有非 owner 玩家 pid,读出其 酒:pid:respond 原始 entry,
//     重新注册为 wrapped 版:validate 头部检查 state.currentPlayerIndex===ownerId → 拒绝;
//     否则调用原 validate。execute/rollback 原样保留。unload 时恢复原始 entry。
//     主作用场景:owner 回合内他人濒死,无法用 酒 自救(仍可用 桃)。
//
//   - 点数 K:当作 atom 默认继承首张原卡的 rank,本技需强制覆盖为 'K'。
//     applyAtom(当作) 之后直接 mutate 影子卡 state.cardMap[shadowId].rank='K'。
//     影子卡是纯数据,直接 mutate 不破坏 invariants(引擎约定:影子卡创建/调整豁免)。
//
// 命名:文件名/loader key/character skill name 均为 '界禁酒'(避开标版潜在冲突);
//   内部 Skill.name = '禁酒'(OL 官方技能名,玩家可见)。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import {
  registerAction,
  hasBlockingPending,
  findActionEntry,
  registerActionEntry,
  type SkillModule,
} from '../skill';
import type { ActionEntry } from '../types';
import { applyAtom } from '../create-engine';
import { defaultPlayActive } from '../action-active';

const SKILL_ID = '界禁酒';
const DISPLAY_NAME = '禁酒';
/** 影子卡固定点数:K(界版官方逐字"视为点数K的【杀】")。 */
const SHADOW_RANK = 'K';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '锁定技:你的【酒】视为点数K的【杀】;其他角色不能于你的回合使用【酒】',
    isLocked: true,
  };
}

/** 影子卡 id:${原id}#界禁酒(与标版禁酒隔离)。 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#界禁酒`;
}

/** 保存被 wrap 的原始 酒:pid:respond entry,供卸载时恢复。
 *  state-bound WeakMap,key=GameState,value=Map<pid, originalEntry>。 */
const wrappedOriginalsByState = new WeakMap<
  GameState,
  Map<number, ActionEntry>
>();

function getWrappedOriginalsMap(state: GameState): Map<number, ActionEntry> {
  let m = wrappedOriginalsByState.get(state);
  if (!m) {
    m = new Map();
    wrappedOriginalsByState.set(state, m);
  }
  return m;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── transform action:把【酒】手牌转化为影子"杀"(点数 K)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (st: GameState, params: Record<string, Json>): string | null => {
      // 锁定技常驻(任意回合);转化需在自己回合 + 无 pending + 存活 + 手牌 + 酒
      const myTurn = st.currentPlayerIndex === ownerId;
      const free = !hasBlockingPending(st);
      const self = st.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? st.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isWine = !!card && card.name === '酒';
      const ok = myTurn && free && selfAlive && cardInHand && isWine;
      return ok ? null : '现在不能使用禁酒';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(st, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '杀',
      });
      // 强制覆盖点数为 K(当作 atom 默认继承首张原卡 rank,界禁酒需固定 K)
      const shadow = st.cardMap[shadowId];
      if (shadow) {
        shadow.rank = SHADOW_RANK;
      }
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (st: GameState, params: Record<string, Json>): void => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete st.cardMap[sId];
      const self = st.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );

  // ─── wrap 其他玩家的 酒.respond:owner 回合内禁止他人用酒 ──
  //   原 entry 由 酒 skill 在 DEFAULT_SKILLS 阶段实例化时注册(registerSkillsFromState
  //   按 skills 数组序实例化,DEFAULT_SKILLS 含 '酒';界禁酒是角色技能,晚于 '酒' 加载)。
  //   wrap 仅注入 validate 头部检查;execute/rollback 保留原引用(零行为变化)。
  //   卸载时通过 registerActionEntry 直接写回原 entry,确保状态干净。
  const wrappedPids: number[] = [];
  for (const p of state.players) {
    if (p.index === ownerId) continue;
    const pid = p.index;
    const original = findActionEntry(state, '酒', pid, 'respond');
    if (!original) continue;
    // 已被 wrap(幂等保护:理论不会触发,因为 instantiateSkill 先 unload 再 onInit)
    if (getWrappedOriginalsMap(state).has(pid)) continue;
    getWrappedOriginalsMap(state).set(pid, { ...original });
    wrappedPids.push(pid);
    const originalValidate = original.validate;
    registerAction(
      state,
      '酒',
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        if (st.currentPlayerIndex === ownerId) {
          return '禁酒:界高顺的回合内,其他角色不能使用【酒】';
        }
        return originalValidate(st, params);
      },
      original.execute,
      original.rollback,
    );
  }

  return () => {
    // 恢复所有被 wrap 的原始 酒:pid:respond entry
    const map = getWrappedOriginalsMap(state);
    for (const pid of wrappedPids) {
      const original = map.get(pid);
      if (original) {
        registerActionEntry(state, original);
        map.delete(pid);
      }
    }
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  // 前端:界禁酒是转化技,defineAction 声明【酒】手牌。
  // 前端 UI 流程:选【酒】手牌 → 点禁酒 → 提交 preceding=[界禁酒.transform] + 主 action=杀.use。
  // 主 action=杀.use 自带目标选择(useCardAndTarget),转化出的 K 杀按 杀.use 正常结算。
  api.defineAction('transform', {
    label: DISPLAY_NAME,
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张【酒】当点数K的【杀】使用',
      cardFilter: {
        filter: (c: Card) => c.name === '酒',
        min: 1,
        max: 1,
      },
    },
    transform: (card: Card) => ({
      name: '杀',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      return p.hand?.some((c) => c.name === '酒') ?? false;
    },
  });
  return;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
