// 界势斩(界华雄·群·主动技,OL hero/446 官方逐字):
//   出牌阶段限两次,你可以令一名其他角色视为对你使用一张【决斗】。
//
// 实现(主动技 use action,限两次,复用 决斗 结算核心):
//   1. use action validate:自己回合 + 出牌阶段 + 无阻塞 pending + 限两次 + 目标合法
//   2. execute:
//      a) 计数 +1(同步设 vars + 回合用量 atom 投影 view,防 dispatch 重入)
//      b) pushFrame
//      c) runUseFlow({virtual:true})：目标(其他角色)是决斗发起者(出杀后手),
//         华雄是决斗目标(出杀先手);无实体牌(视为使用),按惯例(与离间/界翦灭一致)
//         跳过无懈可击
//      d) popFrame
//
// 关键点:
//   - 计数限两次:player.vars['界势斩/usedThisTurn'] 存数字(1/2),沿用 /usedThisTurn
//     后缀由「回合结束」atom 自动清空。每次发动 +1,经 回合用量 atom 同步 view.turnUsage。
//   - 决斗发起者=目标(其他角色),目标=华雄自己:华雄是出杀先手(先被询问杀),
//     若华雄不出杀则直接输并受1伤,符合"令其他角色对你使用决斗"的语义。
//   - 虚拟决斗跳过无懈:与离间/翦灭一致("视为使用"通常不可被无懈可击抵消)
//   - 决斗结算走 runUseFlow virtual 模式,与正常决斗行为一致(无双双杀、
//     轮流出杀、输者受 1 点伤害)
//   - 与界耀武共存:决斗输者受 1 伤,若输者为华雄则触发界耀武(决斗无实体牌 → "非红色"
//     → 华雄摸一张);若输者为另一角色,该伤害来源为华雄 → 因无 cardId → 不触发红摸分支
//
// 命名:文件名/loader key/character skill name 均为 '界势斩';
//   内部 Skill.name = '势斩'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { runUseFlow } from '../card-effect/use-card';

const SKILL_ID = '界势斩';
const DISPLAY_NAME = '势斩';
/** 数字计数(1/2);沿用 /usedThisTurn 后缀由「回合结束」atom 自动清空。 */
const COUNT_KEY = `${SKILL_ID}/usedThisTurn`;
const MAX_USES = 2;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '出牌阶段限两次,令一名其他角色视为对你使用一张决斗',
  };
}

/** 本回合已发动次数(0/1/2)。 */
function usesThisTurn(state: GameState, ownerId: number): number {
  const v = state.players[ownerId]?.vars[COUNT_KEY];
  return typeof v === 'number' ? v : 0;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usesThisTurn(st, ownerId) >= MAX_USES) return '本阶段势斩已达上限(2次)';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';

      const target = params.target;
      if (typeof target !== 'number') return '需要指定一名目标';
      if (target === ownerId) return '不能以自己为目标';
      if (!st.players[target]?.alive) return '目标不合法';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const target = params.target as number;

      // 计数 +1(同步设 vars + 回合用量 atom 投影 view,防 dispatch 重入)。
      // 必须在第一个 await 之前设置,以防 dispatch 重入(见制衡.ts 注释)。
      const nextCount = usesThisTurn(st, from) + 1;
      st.players[from].vars[COUNT_KEY] = nextCount;
      await applyAtom(st, { type: '回合用量', player: from, key: COUNT_KEY, value: nextCount });

      await pushFrame(st, SKILL_ID, from, { ...params });

      try {
        // 目标(其他角色)视为对华雄使用决斗:from=目标(发起者/出杀后手),
        // target=华雄(目标/出杀先手)。虚拟使用模式(无实体牌)。
        if (st.players[from]?.alive && st.players[target]?.alive) {
          const virtualCardId = `${SKILL_ID}:决斗:${target}:${from}:${st.seq}`;
          st.cardMap[virtualCardId] = { id: virtualCardId, name: '决斗', suit: '', color: '无色', rank: 'A', type: '锦囊牌' };
          await runUseFlow(st, target, virtualCardId, [from], '决斗', { virtual: true });
          delete st.cardMap[virtualCardId];
        }
      } finally {
        await popFrame(st);
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '势斩:选择一名其他角色,令其视为对你使用一张决斗(限两次/阶段)',
      description: '本阶段限两次',
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, target) => {
          const me = view.currentPlayerIndex;
          if (target === me) return false;
          const tp = view.players.find((pl) => pl.index === target);
          if (!tp || tp.alive === false) return false;
          return true;
        },
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const used = ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[COUNT_KEY];
      return (typeof used === 'number' ? used : 0) < MAX_USES;
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
