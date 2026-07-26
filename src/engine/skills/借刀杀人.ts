// 借刀杀人(技能层):被借刀时选「出杀(含 B/方天画戟多目标) 或交武器」的 respond 入口。
// CardEffect 层(card-effects/借刀杀人.ts)负责牌的使用结算;本文件负责被问询方的回应入口。
//
// 注册模式参照 乱武:respond action 注册到每个座次(被问询者 A 可能是任意玩家,
// 与发起者 P1 不同座次),onInit 返回合并卸载函数保证清理所有座次的 respond 注册。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction } from '../skill';
import type { SkillModule } from '../skill';
import { inAttackRange } from '../distance';

const REQUEST_TYPE = '借刀杀人/出杀';
const CHOICE_VAR = '借刀杀人/出杀选择';
const KILL_TARGET_VAR = '借刀杀人/killTarget';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '借刀杀人',
    description: '被借刀杀人问询时的回应入口:出杀(含指定目标)或交出武器',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const unloaders: Array<() => void> = [];

  // respond 注册到每个座次:被借刀的目标 A 可能是任意玩家。
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          if ((slot.atom as { target?: number }).target !== seat) return '不是问你的';
          const atom = slot.atom as { requestType?: string };
          if (atom.requestType !== REQUEST_TYPE) return '当前不是借刀杀人询问';
          // 不传 cardId = 选择交出武器(pass),由 resolve 兜底走交武器分支
          const cardId = params.cardId as string | undefined;
          if (cardId === undefined) return null;
          const targets = params.targets as number[] | undefined;
          if (!Array.isArray(targets) || targets.length === 0) return '请选择杀的目标';
          const self = st.players[seat];
          if (!self?.hand.includes(cardId)) return '牌不在手牌中';
          if (st.cardMap[cardId]?.name !== '杀') return '只能使用杀';
          // 必含发起者指定的 killTarget(权威校验,前端 targetFilter 仅提示)
          const killTarget = st.localVars[KILL_TARGET_VAR] as number | undefined;
          if (killTarget !== undefined && !targets.includes(killTarget))
            return '必须包含借刀杀人指定的目标';
          // 每个目标须在 A 的攻击范围内(镜像 杀.canUse/canUseSlash 的距离校验)。
          // 在 respond 阶段即拒绝非法选择,避免进入结算后 useCard 静默失败 → 白费整张借刀杀人
          // (与 乱武 在 respond 校验 nearestOthers 同理:把约束前移到问询阶段)。
          for (const t of targets) {
            if (!inAttackRange(st, seat, t, cardId)) return '目标不在攻击范围内';
          }
          return null;
        },
        async (st: GameState, params: Record<string, Json>) => {
          const cardId = params.cardId as string | undefined;
          const targets = params.targets as number[] | undefined;
          // 不传 = 交武器,localVars 不设选择 → resolve 走交武器分支
          if (typeof cardId === 'string' && Array.isArray(targets)) {
            st.localVars[CHOICE_VAR] = { cardId, targets };
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
  api.defineAction('respond', {
    label: '出杀',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '借刀杀人:对指定角色使用一张杀,或交出武器',
      cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
      // 方天画戟等允许多目标;具体距离/必含由后端 canUse + mandatedTargets 校验
      targetFilter: { min: 1, max: 3, filter: () => true },
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
