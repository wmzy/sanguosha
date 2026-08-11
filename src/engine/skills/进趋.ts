// 进趋(王基·魏·被动技,OL hero/362 风林火山官方逐字):
//   "结束阶段,你可以摸两张牌,然后将手牌弃至X张(X为你本回合发动"奇制"的次数)。"
//
// 实现(被动 after-hook + 两步 respond):
//   阶段开始(回合结束) after-hook:
//     1. 询问是否发动(请求回应 requestType='进趋/confirm',confirm prompt)
//     2. confirm → 摸两张牌(摸牌 atom)
//     3. 计算需弃置数:excess = hand.length - X(X = turn.vars['奇制/count'] ?? 0)
//        若 excess > 0 → 询问选 excess 张手牌弃置(请求回应 requestType='进趋/弃牌',强制)
//        若 excess <= 0 → 无需弃置
//
// 关键点:
//   - 触发时机:阶段开始(回合结束)——同闭月。此时 turn.vars['奇制/count'] 仍完整:
//     回合结束 atom(apply 清空 turn.vars)在 阶段开始(回合结束) after-hook 之后才执行
//     (回合管理 阶段结束(弃牌) after-hook 内:先 阶段开始(回合结束) → 本 hook →
//      再 清过期标记/下一玩家/回合结束 atom)。故 X 读取正确。
//   - X = 本回合奇制发动次数(turn.vars['奇制/count'],由奇制.ts 累加)。
//   - "弃至X张":强制弃置超出部分(excess = hand - X),不可跳过;超时自动弃手牌首张。
//   - X 可能为 0(本回合未发动奇制):摸2后须弃光全部手牌(规则惩罚)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';

const SKILL_ID = '进趋';
const CONFIRM_RT = `${SKILL_ID}/confirm`;
const DISCARD_RT = `${SKILL_ID}/弃牌`;

const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
const DISCARD_KEY = `${SKILL_ID}/discardCards`;
/** turn.vars key:本回合奇制发动次数(由奇制.ts 写,本技读)。 */
const QIZHI_COUNT_VAR = '奇制/count';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description: '结束阶段可摸两张牌,然后将手牌弃至X张(X为本回合发动奇制的次数)',
  };
}

/** 当前 pending 的 requestType(类型安全读取) */
function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as { requestType?: string }).requestType;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理 confirm / 弃牌 两种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT && rt !== DISCARD_RT) {
        return '当前不是进趋询问';
      }
      if (rt === CONFIRM_RT) return null; // confirm:任意 choice 均可

      // 弃牌:校验 cardIds 均在自己手牌中
      const cardIds = params.cardIds as string[] | undefined;
      if (!Array.isArray(cardIds) || cardIds.length === 0) return '请选择要弃置的牌';
      const self = st.players[ownerId];
      if (!self) return '玩家不存在';
      for (const id of cardIds) {
        if (typeof id !== 'string' || !self.hand.includes(id)) return `牌 ${id} 不在手牌中`;
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === DISCARD_RT) {
        const ids = params.cardIds as string[] | undefined;
        if (Array.isArray(ids)) st.localVars[DISCARD_KEY] = ids;
      }
    },
  );

  // ── 阶段开始(回合结束) after-hook ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.phase !== '回合结束') return;
      if (atom.player !== ownerId) return;

      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // X = 本回合奇制发动次数(此时 turn.vars 尚未被 回合结束 atom 清空)
      const x = (ctx.state.turn.vars[QIZHI_COUNT_VAR] as number | undefined) ?? 0;

      // 1. 询问是否发动进趋
      delete ctx.state.localVars[CONFIRM_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动进趋?(摸两张牌,然后将手牌弃至 ${x} 张)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars[CONFIRM_KEY]) {
        delete ctx.state.localVars[CONFIRM_KEY];
        return;
      }
      delete ctx.state.localVars[CONFIRM_KEY];

      // 2. 摸两张牌
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 2 });

      // 3. 将手牌弃至 X 张
      const handNow = ctx.state.players[ownerId]?.hand.length ?? 0;
      if (handNow > x) {
        const excess = handNow - x;
        delete ctx.state.localVars[DISCARD_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: DISCARD_RT,
          target: ownerId,
          prompt: {
            type: 'useCard',
            title: `进趋:弃 ${excess} 张手牌(弃至 ${x} 张)`,
            cardFilter: { filter: () => true, min: excess, max: excess },
          },
          // 强制型弃牌:前端隐藏"不回应"按钮;headless 不生成 skip
          mandatory: true,
          timeout: 30,
        });

        let cardIds = ctx.state.localVars[DISCARD_KEY] as string[] | undefined;
        delete ctx.state.localVars[DISCARD_KEY];
        // 强制弃牌:超时未回应 → 自动从手牌首张起补弃(不放弃弃牌义务)
        if ((!cardIds || cardIds.length === 0) && excess > 0) {
          cardIds = ctx.state.players[ownerId]?.hand.slice(0, excess) ?? [];
        }
        if (cardIds && cardIds.length > 0) {
          await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds });
        }
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: SKILL_ID,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动进趋?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
