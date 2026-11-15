// 铁骑(马超·被动技):当你使用【杀】指定一名角色为目标后,你可以进行一次判定,
// 若结果为红色,该角色不能使用【闪】抵消此【杀】。
//
// 实现(三段式,禁闪横切机制):
//   1. 指定目标 after hook(source===ownerId, card 是杀):
//        询问"是否发动铁骑" → 若发动 → (族差异附加效果) → applyAtom(判定)。
//   2. 判定牌生效后 after hook(judgeType==='铁骑', player===ownerId):
//        读判定牌(结算帧最后一张)→ 族差异效果(标:红色→加禁闪标签;界:记录花色)。
//   3. 询问闪 before hook(标版 dodgeBlockTag 模式:target 有禁闪标签):
//        去标签 + cancel(跳过询问闪 → 处理区无闪 → 杀.execute 造成伤害,强制命中)。
//
// 标签生命周期:在阶段1(指定目标)产出,阶段2(询问闪)消费并清除——天然按单次杀结算。
// 杀技能零感知铁骑:它只看处理区有没有闪牌;取消询问闪等价于目标不出闪。
//
// 本文件同时导出 createTieqiSkill 工厂(铁骑族共享实现),界铁骑 复用之:
// 指定目标前导守卫/发动询问/判定、判定牌生效后读牌 两段逐字共享;确认键
// '铁骑/confirmed'、目标键 '铁骑/target'、judgeType '铁骑' 两版共享。
// 界版注入 抑制标签(onConfirmed)/花色记录(onJudgeCard)/全座次 respond/附加 hook。
import type {
  Card,
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { frameCards } from '../core/frame';
import { runJudgeFlow } from '../flows/judge';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';
import { askConfirm, defineConfirmAction } from '../util/skillRuntime';

const CONFIRM = '铁骑/confirmed';
const TARGET_VAR = '铁骑/target';
const TAG = '铁骑/禁闪';

/** 铁骑族(被动技)差异参数 */
export interface TieqiOptions {
  /** Skill.name(标 '铁骑' / 界 '界铁骑') */
  name: string;
  description: string;
  /** 发动询问 requestType(标 '铁骑/confirm' / 界 '界铁骑/confirm',键空间隔离) */
  confirmRt: string;
  /** 发动询问文案 */
  confirmTitle: string;
  /** respond 注册(标:单座次 confirm;界:全座次 confirm + 弃同花色)。返回 unloaders。 */
  registerRespond: (state: GameState, skillId: string, ownerId: number) => Array<() => void>;
  /** 发动后、判定前的附加效果(界版:给目标加非锁定技失效标签)。 */
  onConfirmed?: (state: GameState, target: number) => Promise<void>;
  /** 判定牌生效后的技能效果(标:红色→加禁闪标签;界:记录花色供询问闪消费)。 */
  onJudgeCard: (state: GameState, target: number, judgeCard: Card) => Promise<void>;
  /** 标版:禁闪标签 → 注册 询问闪 before-hook(去标签 + cancel 强制命中)。 */
  dodgeBlockTag?: string;
  /** 界版附加初始化(抑制 provider + 弃同花色免闪询问闪 hook + 回合结束清标签)。 */
  extraInit?: (state: GameState, skillId: string, ownerId: number) => Array<() => void>;
}

/** 铁骑族共享实现:标版铁骑与界铁骑的 指定目标→询问→判定→读判定牌 骨架逐字一致,
 *  判定结果效果与询问闪拦截由 opts 注入。 */
export function createTieqiSkill(opts: TieqiOptions) {
  return {
    createSkill(id: string, ownerId: number): Skill {
      return {
        id,
        ownerId,
        name: opts.name,
        description: opts.description,
      };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      const unloaders: Array<() => void> = [];
      unloaders.push(...opts.registerRespond(state, skill.id, ownerId));

      // ── 指定目标 after:自己出杀指定目标 → 询问是否发动 → 判定 ──
      registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx) => {
        const atom = ctx.atom;
        if (atom.source !== ownerId) return;
        if (atom.target === undefined) return;
        const target = atom.target;
        // 仅对杀触发(cardId 缺省时容错放过——避免误拦无牌事件)
        if (atom.cardId !== undefined) {
          const card = ctx.state.cardMap[atom.cardId];
          if (card?.name !== '杀') return;
        }
        const targetPlayer = ctx.state.players[target];
        if (!targetPlayer?.alive) return;
        if (ctx.state.zones.deck.length === 0) return; // 无牌可判

        // 询问是否发动铁骑("你可以..."——可选)
        const confirmed = await askConfirm(ctx.state, opts.confirmRt, ownerId, {
          confirmedKey: CONFIRM,
          title: opts.confirmTitle,
          confirmLabel: '发动',
          cancelLabel: '不发动',
          defaultChoice: false,
          timeout: 10,
        });
        if (!confirmed) return;

        // 族差异附加效果(界版:给目标加非锁定技失效标签)
        await opts.onConfirmed?.(ctx.state, target);

        // 记录当前目标,供 判定牌生效后 hook 读取
        ctx.state.localVars[TARGET_VAR] = target;
        await runJudgeFlow(ctx.state, ownerId, '铁骑');
      });

      // ── 判定牌生效后:judgeType==='铁骑' → 读判定牌 → 族差异效果 ──
      registerAfterHook(state, skill.id, ownerId, '判定牌生效后', async (ctx) => {
        const atom = ctx.atom;
        if (atom.judgeType !== '铁骑') return;
        if (atom.player !== ownerId) return;
        const target = ctx.state.localVars[TARGET_VAR] as number | undefined;
        delete ctx.state.localVars[TARGET_VAR];
        if (target === undefined) return;
        const targetPlayer = ctx.state.players[target];
        if (!targetPlayer?.alive) return;

        // 读判定牌(判定牌生效后,仍在结算帧牌区顶,runJudgeFlow 收尾才入弃牌堆)
        const cards = frameCards(ctx.state);
        if (cards.length === 0) return;
        const judgeCardId = cards[cards.length - 1];
        const judgeCard = ctx.state.cardMap[judgeCardId];
        if (!judgeCard) return;
        await opts.onJudgeCard(ctx.state, target, judgeCard);
      });

      // ── 询问闪 before(标版模式):目标有禁闪标签 → 去标签 + cancel(强制命中)──
      const dodgeBlockTag = opts.dodgeBlockTag;
      if (dodgeBlockTag) {
        registerBeforeHook(
          state,
          skill.id,
          ownerId,
          '询问闪',
          async (ctx): Promise<HookResult | void> => {
            const atom = ctx.atom;
            if (atom.source !== ownerId) return;
            const target = atom.target;
            if (target === undefined) return;
            const player = ctx.state.players[target];
            if (!player?.tags.includes(dodgeBlockTag)) return;
            // 清标签(仅本次杀有效)+ cancel 询问闪 → 处理区无闪 → 造成伤害
            await applyAtom(ctx.state, { type: '去标签', player: target, tag: dodgeBlockTag });
            return { kind: 'cancel' };
          },
        );
      }

      if (opts.extraInit) {
        unloaders.push(...opts.extraInit(state, skill.id, ownerId));
      }

      return () => {
        for (const u of unloaders) u();
      };
    },

    onMount(_skill: Skill, api: FrontendAPI): void {
      defineConfirmAction(api, 'respond', {
        label: '铁骑',
        title: '是否发动铁骑判定？',
        style: 'default',
      });
    },
  };
}

const OPTIONS: TieqiOptions = {
  name: '铁骑',
  description: '使用杀指定目标后可判定,红色则目标不能出闪抵消',
  confirmRt: '铁骑/confirm',
  confirmTitle: '是否发动铁骑判定?',
  // respond:被询问"是否发动铁骑"时回应,设 localVars 标记结果
  registerRespond: (state, skillId, ownerId) => {
    const u = registerAction(
      state,
      skillId,
      ownerId,
      'respond',
      (state, _params) => {
        const slot = state.pendingSlots.get(ownerId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as { type?: string; requestType?: string };
        if (atom.type !== '请求回应') return '当前不是请求回应';
        if (atom.requestType !== '铁骑/confirm') return '当前不是铁骑确认';
        return null;
      },
      async (state, params) => {
        state.localVars[CONFIRM] = params.choice === true || params.confirmed === true;
      },
    );
    return [u];
  },
  // 判定牌生效后:红色 → 给目标加禁闪标签(询问闪 before hook 消费)
  onJudgeCard: async (state, target, judgeCard) => {
    if (judgeCard.color === '红') {
      await applyAtom(state, { type: '加标签', player: target, tag: TAG });
    }
  },
  dodgeBlockTag: TAG,
};

export const { createSkill, onInit, onMount } = createTieqiSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
