// 耀武(华雄·群·锁定技,OL hero/214 官方逐字):
//   锁定技,当一名角色使用红色【杀】对你造成伤害时,
//   其选择回复1点体力或摸一张牌。
//
// 实现(被动 after-hook + 来源方选择):
//   造成伤害后 after-hook(target===华雄, 红色杀, amount>0):
//     1. 校验:atom.target===ownerId(华雄受伤)、来源存在且存活、
//        造成伤害的牌为红色【杀】(card.name==='杀' 且 card.color==='红')
//     2. 请求来源选择(请求回应 requestType='耀武/选择',target=source,prompt=chooseOption):
//        来源选「回复1点体力」或「摸一张牌」
//     3. 按选择 applyAtom:回复体力(source,1) 或 摸牌(source,1)
//     4. 超时/无回应:默认摸一张牌(锁定技,来源必得收益)
//
// 关键点:
//   - 锁定技:必触发(isLocked:true),但收益归属来源,来源需做选择(非华雄)
//   - 来源可能是任意其他玩家:respond action 必须为所有座次注册
//     (引擎 dispatch 按 (skillId, message.ownerId=回应者座次, actionType) 精确查 action,
//      仅注册华雄座次会导致来源座次查不到 → 无法回应。参考 享乐/乱武/刚烈)
//   - "红色杀":card.name==='杀'(含火杀/雷杀,均为杀)且 card.color==='红'(♥♦)
//   - 触发时机:造成伤害后(来源方时机,与狂骨/破军同列)——伤害已实际造成,
//     即便华雄随后濒死/死亡,来源仍获收益(规则:伤害已造成即触发)
//   - 每次红色杀伤害触发一次(非每点伤害):酒+红杀造成2点仍只触发一次
//   - 卸载:onInit 返回合并卸载函数(乱武模式),保证卸载 耀武 实例时清理所有座次的
//     respond 注册(unloadSkillInstance 仅按 (skillId,华雄座次) 清 action,清不到其他座次)
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';

const CHOICE_RT = '耀武/选择';
const CHOICE_KEY = '耀武/选择结果';
const OPT_RECOVER = 'recover';
const OPT_DRAW = 'draw';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '耀武',
    description: '锁定技,当一名角色使用红色杀对你造成伤害时,其选择回复1点体力或摸一张牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const unloads: Array<() => void> = [];

  // ─── respond action:为所有玩家注册(来源可能是任意其他玩家) ───
  // validate 严格检查 pending requestType='耀武/选择',非耀武 pending 一律拒绝(无副作用)。
  for (const p of state.players) {
    const pid = p.index;
    unloads.push(
      registerAction(
        state,
        skill.id,
        pid,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(pid);
          if (!slot) return '当前不需要回应';
          if (slot.atom.type !== '请求回应') return '当前不需要回应';
          const reqType = (slot.atom as { requestType?: string }).requestType;
          if (reqType !== CHOICE_RT) return '当前不是耀武选择';
          const opt = params.option;
          if (opt !== OPT_RECOVER && opt !== OPT_DRAW) return '请选择回复体力或摸牌';
          return null;
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          st.localVars[CHOICE_KEY] = params.option;
        },
      ),
    );
  }

  // ─── after-hook:造成伤害后(华雄被红色杀造成伤害时,来源获收益) ───
  unloads.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '造成伤害后',
      async (ctx) => {
        const atom = ctx.atom;
        if (atom.target !== ownerId) return; // 仅华雄受伤触发
        if ((atom.amount ?? 0) <= 0) return;

        const source = atom.source;
        if (typeof source !== 'number') return; // 系统来源(如闪电)无来源方收益
        const sourcePlayer = ctx.state.players[source];
        if (!sourcePlayer?.alive) return; // 来源已死亡则无收益对象

        // 造成伤害的牌须为红色【杀】(♥♦ 的杀,含火杀/雷杀)
        const damageCardId = atom.cardId;
        const damageCard = damageCardId ? ctx.state.cardMap[damageCardId] : undefined;
        if (!damageCard) return;
        if (damageCard.name !== '杀') return;
        if (damageCard.color !== '红') return;

        // 询问来源选择:回复1点体力 或 摸一张牌(锁定技,来源必得收益)
        delete ctx.state.localVars[CHOICE_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: CHOICE_RT,
          target: source,
          prompt: {
            type: 'chooseOption',
            title: `耀武:你对 ${ctx.state.players[ownerId].name} 造成红色杀伤害,选择一项`,
            options: [
              { value: OPT_RECOVER, label: '回复1点体力' },
              { value: OPT_DRAW, label: '摸一张牌' },
            ],
          },
          timeout: 20,
        });

        const choice = ctx.state.localVars[CHOICE_KEY] as string | undefined;
        delete ctx.state.localVars[CHOICE_KEY];

        if (choice === OPT_RECOVER) {
          await applyAtom(ctx.state, {
            type: '回复体力',
            target: source,
            amount: 1,
            source: ownerId,
          });
        } else {
          // OPT_DRAW 或 超时无回应 → 默认摸一张牌(锁定技,来源必得收益)
          await applyAtom(ctx.state, { type: '摸牌', player: source, count: 1 });
        }
      },
    ),
  );

  return () => {
    for (const u of unloads) u();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 锁定技无主动 UI(无 use action);respond 由 pending 驱动,定义兜底 UI。
  api.defineAction('respond', {
    label: '耀武',
    style: 'primary',
    prompt: {
      type: 'chooseOption',
      title: '耀武:选择一项',
      options: [
        { value: OPT_RECOVER, label: '回复1点体力' },
        { value: OPT_DRAW, label: '摸一张牌' },
      ],
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
