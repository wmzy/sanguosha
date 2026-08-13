// 决堰(陆抗·吴·主动技,风林火山 hero/414 官方逐字):
//   "出牌阶段限一次,你可以废除一个装备栏并于本回合获得对应效果:
//    武器栏,使用【杀】的限制次数+3;防具栏,摸三张牌且手牌上限+3;
//    坐骑栏,使用牌无距离限制;宝物栏,获得'集智'。"
//
// 模式 B(主动技):registerAction 'use',出牌阶段限一次。
//   execute:废除选定的装备栏(写 player.vars 永久标记)→ 本回合获得对应效果。
//
// 装备栏分组(官方"栏"概念,引擎 EquipSlot 有 5 个独立槽):
//   武器栏 → ['武器']
//   防具栏 → ['防具']
//   坐骑栏 → ['进攻马', '防御马'](OL 的"坐骑栏"覆盖两个马匹槽)
//   宝物栏 → ['宝物']
//
// 废除存储:player.vars['决堰/废除:<槽>'] = true(永久,不被「回合结束」自动清理)。
//   装备防装钩子(防止往已废除的槽装装备)由 谦节.ts 统一注册(谦节为永久锁定技,
//   决堰被破势移除后仍生效)。
//
// 本回合效果(turn.vars 驱动,回合结束自动清空):
//   武器:turn.vars['决堰/本回合:武器'] → slashExtraProvider 返回 +3
//   防具:立即摸牌 3 + turn.vars['手牌上限/bonus:<player>'] += 3
//   坐骑:turn.vars['决堰/本回合:坐骑'] → distanceExemptor 返回 true
//   宝物:applyAtom 添加技能 集智 + player.vars['决堰/集智临时'](回合结束 移除集智)
import type {
  EquipSlot,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import {
  registerAction,
  registerAfterHook,
} from '../core/skill';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { registerSlashExtraProvider } from '../rules/slash-quota';
import { registerDistanceExemptor } from '../rules/distance';
import type { SkillModule } from '../types';
import { handLimitBonusKey } from '../rules/vars-keys';

const SKILL_NAME = '决堰';

/** 废除标记前缀(player.vars)。值 true 表示该槽已被废除,永久生效。
 *  谦节.ts / 破势.ts 均读取此前缀判定废除状态。 */
export const ABOLISH_PREFIX = '决堰/废除:';

/** 本回合武器效果标记(turn.vars,回合结束自动清空) */
const TURN_WEAPON = '决堰/本回合:武器';
/** 本回合坐骑效果标记(turn.vars,回合结束自动清空) */
const TURN_MOUNT = '决堰/本回合:坐骑';
/** 集智临时标记(player.vars,回合结束由 决堰 after-hook 移除集智后清除)。
 *  不使用 /usedThisTurn 等自动清理后缀——需在 回合结束 after-hook(已清 turn.vars)中读取。 */
const JIZHI_TEMP = '决堰/集智临时';

/** 栏名 → 引擎槽位列表 */
const SLOT_GROUPS: Record<string, EquipSlot[]> = {
  武器: ['武器'],
  防具: ['防具'],
  坐骑: ['进攻马', '防御马'],
  宝物: ['宝物'],
};

/** 栏选项列表(onMount prompt / validate 校验共用) */
const SLOT_CHOICES = ['武器', '防具', '坐骑', '宝物'] as const;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_NAME,
    description:
      '出牌阶段限一次,废除一个装备栏并于本回合获得对应效果:武器栏杀次数+3;防具栏摸三张且手牌上限+3;坐骑栏使用牌无距离限制;宝物栏获得集智',
  };
}

/** 玩家某栏是否已全部废除(栏内所有槽都标记废除) */
export function isSlotGroupAbolished(state: GameState, player: number, group: string): boolean {
  const slots = SLOT_GROUPS[group];
  if (!slots) return false;
  return slots.every((s) => state.players[player]?.vars[ABOLISH_PREFIX + s]);
}

/** 检查玩家某栏是否还有未废除的槽(可被决堰废除) */
function canAbolishGroup(state: GameState, player: number, group: string): boolean {
  const slots = SLOT_GROUPS[group];
  if (!slots) return false;
  // 栏内只要有任一槽未废除即可废除整栏(废除时会标记栏内全部槽)
  return slots.some((s) => !state.players[player]?.vars[ABOLISH_PREFIX + s]);
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use action:废除一个装备栏并获得本回合效果 ──
  const unloadUse = registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (usedThisTurn(st, ownerId, SKILL_NAME)) return '本回合已使用过决堰';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      // 栏名:前端 chooseOption 传 option,测试/直接 dispatch 传 slot
      const group = (params.slot as string) ?? (params.option as string);
      if (typeof group !== 'string' || !SLOT_CHOICES.includes(group as (typeof SLOT_CHOICES)[number])) {
        return '请选择要废除的装备栏';
      }
      if (!canAbolishGroup(st, ownerId, group)) return '该装备栏已全部废除';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const group = (params.slot as string) ?? (params.option as string);
      // 限一次标记(同步设 vars + 回合用量投影 view,防 dispatch 重入)
      await markOncePerTurn(st, ownerId, SKILL_NAME);

      await pushFrame(st, SKILL_NAME, ownerId, { group });

      const slots = SLOT_GROUPS[group];
      const self = st.players[ownerId];

      // 1) 废除栏内所有槽:若有装备则弃置,然后写废除标记
      for (const slot of slots) {
        const equipId = self.equipment[slot];
        if (equipId) {
          await applyAtom(st, { type: '卸下', player: ownerId, slot });
          await applyAtom(st, {
            type: '移动牌',
            cardId: equipId,
            from: { zone: '手牌', player: ownerId },
            to: { zone: '弃牌堆' },
          });
        }
        st.players[ownerId].vars[ABOLISH_PREFIX + slot] = true;
      }

      // 2) 本回合对应效果
      if (group === '武器') {
        // 杀限制次数+3(本回合):slashExtraProvider 读此标记
        st.turn.vars[TURN_WEAPON] = true;
        // 投影 view.turnUsage,供前端 viewSlashMax 推断
        await applyAtom(st, { type: '回合用量', player: ownerId, key: '杀/extra/决堰', value: 3 });
      } else if (group === '防具') {
        // 摸三张牌
        await applyAtom(st, { type: '摸牌', player: ownerId, count: 3 });
        // 手牌上限+3(本回合):hand-limit.ts 读 turn.vars['手牌上限/bonus:<player>']
        const bonusKey = handLimitBonusKey(ownerId);
        const cur = (st.turn.vars[bonusKey] as number | undefined) ?? 0;
        st.turn.vars[bonusKey] = cur + 3;
      } else if (group === '坐骑') {
        // 使用牌无距离限制(本回合):distanceExemptor 读此标记
        st.turn.vars[TURN_MOUNT] = true;
      } else if (group === '宝物') {
        // 获得"集智"(本回合):回合结束由 after-hook 移除
        await applyAtom(st, { type: '添加技能', player: ownerId, skillId: '集智' });
        st.players[ownerId].vars[JIZHI_TEMP] = true;
      }

      await popFrame(st);
    },
  );

  // ── 武器栏效果:杀限制次数+3(slashExtraProvider,本回合由 turn.vars 驱动) ──
  const unloadExtra = registerSlashExtraProvider(state, ownerId, (st, player) => {
    if (player !== ownerId) return 0;
    return st.turn.vars[TURN_WEAPON] ? 3 : 0;
  });

  // ── 坐骑栏效果:使用牌无距离限制(distanceExemptor,本回合由 turn.vars 驱动) ──
  const unloadDist = registerDistanceExemptor(state, ownerId, (st, from, _to) => {
    if (from !== ownerId) return false;
    return !!st.turn.vars[TURN_MOUNT];
  });

  // ── 回合结束:移除本回合由宝物栏获得的"集智" ──
  //   回合结束 after-hook 在 apply(已清 turn.vars)之后触发;
  //   JIZHI_TEMP 用无自动清理后缀的 player.vars key, survives 清理。
  const unloadTurnEnd = registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx) => {
    const atom = ctx.atom as { type: string; player?: number };
    if (atom.type !== '回合结束') return;
    if (atom.player !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self?.vars[JIZHI_TEMP]) return;
    delete self.vars[JIZHI_TEMP];
    if (self.skills.includes('集智')) {
      await applyAtom(ctx.state, { type: '移除技能', player: ownerId, skillId: '集智' });
    }
  });

  return () => {
    unloadUse();
    unloadExtra();
    unloadDist();
    unloadTurnEnd();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '决堰',
    style: 'primary',
    activeWhen: activeUnlessUsedThisTurn(SKILL_NAME),
    prompt: {
      type: 'chooseOption',
      title: '决堰:选择要废除的装备栏(本回合获得对应效果)',
      options: [
        { value: '武器', label: '武器栏 — 使用杀的限制次数+3' },
        { value: '防具', label: '防具栏 — 摸三张牌且手牌上限+3' },
        { value: '坐骑', label: '坐骑栏 — 使用牌无距离限制' },
        { value: '宝物', label: '宝物栏 — 获得集智' },
      ],
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
