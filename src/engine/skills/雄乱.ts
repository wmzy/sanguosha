// 雄乱(张绣·群·限定技,风林火山 hero/415 官方逐字):
//   "限定技,出牌阶段,你可以指定一名其他角色并废除你的判定区和装备区,
//    然后你本回合对其使用牌无距离和次数限制,其本回合不能使用和打出手牌。"
//
// 模式 B(主动技 use action)+ 多重持续效果:
//   execute:标记限定技已用 → 废除判定区+装备区(永久)→ 写入本回合目标(turn.vars)。
//
// 永久废除(player.vars,'雄乱/废除:<区>',后缀不匹配自动清理列表 → 不被 回合结束 清理):
//   判定区:'雄乱/废除:判定' → before-hook 添加延时锦囊 cancel(免疫延时锦囊)
//   装备区:5 个槽(武器/防具/进攻马/防御马/宝物)→ before-hook 装备 cancel(不可装装备)
//   废除时:弃置已装备的牌(卸下→弃牌堆)、移除判定区已有的延时锦囊。
//
// 本回合效果(turn.vars['雄乱/目标']=targetIdx,回合结束 atom 自动清空):
//   ① 对目标使用牌无距离限制:distanceExemptor(from=owner, to=目标)→ true
//   ② 对目标使用杀无次数限制:slashUnlimitedProvider(owner, 目标已设)→ true
//   ③ 目标不能使用/打出手牌:before-hook 询问闪/询问杀/请求回应(卡牌回应型)
//      target===目标 → cancel(询问直接被取消,父流程视为未出牌 → 杀必中、不可救援)
//
// 限定技整局一次:player.vars['雄乱/used'](永久 vars,不被 回合结束 清理)。
//   use action validate 校验;activeWhen 用默认出牌条件(validate 兜底已用状态)。
import type {
  EquipSlot,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import {
  registerAction,
  registerBeforeHook,
  hasBlockingPending,
} from '../core/skill';
import { registerSlashUnlimitedProvider } from '../rules/slash-quota';
import { registerDistanceExemptor } from '../rules/distance';
import { defaultPlayActive } from '../rules/action-active';
import type { SkillModule } from '../types';

const SKILL_NAME = '雄乱';

/** player.vars key:限定技已用(整局一次,永久) */
const USED_KEY = '雄乱/used';
/** turn.vars key:本回合雄乱指定的目标座次(回合结束自动清空) */
const TARGET_VAR = '雄乱/目标';
/** player.vars 废除前缀:'雄乱/废除:<区/槽>' = true 表示该区/槽已废除(永久) */
const ABOLISH_PREFIX = '雄乱/废除:';
/** 判定区废除标记 */
const JUDGE_ABOLISHED = `${ABOLISH_PREFIX}判定`;

/** 全部装备槽(废除装备区时逐槽处理) */
const ALL_EQUIP_SLOTS: EquipSlot[] = ['武器', '防具', '进攻马', '防御马', '宝物'];

/** 从 card.subtype 推断装备槽位(镜像 谦节.ts / 决堰.ts) */
function inferEquipSlot(subtype: string | undefined): EquipSlot | null {
  switch (subtype) {
    case '武器':
    case '防具':
    case '进攻马':
    case '防御马':
    case '宝物':
      return subtype;
    default:
      return null;
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_NAME,
    description:
      '限定技,出牌阶段,指定一名其他角色并废除你的判定区和装备区,本回合对其使用牌无距离和次数限制,其本回合不能使用和打出手牌',
  };
}

/** 目标座次是否被本回合雄乱禁出牌(turn.vars['雄乱/目标'] 命中) */
function isBannedFromPlaying(state: GameState, seat: number): boolean {
  return state.turn.vars[TARGET_VAR] === seat;
}

/** 需要打出/使用手牌的 prompt 类型(纯选择型如 confirm/chooseSuit 不在此列)。
 *  镜像 义绝.ts:目标仍可处理非出牌选择(选目标/确认等),仅拦截出牌型回应。 */
const CARD_PLAY_PROMPTS = new Set([
  'useCard',
  'useCardAndTarget',
  'pickProcessingCard',
  'pickTargetCard',
  'distribute',
]);

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use action:发动雄乱 ──
  const unloadUse = registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (st.players[ownerId]?.vars[USED_KEY]) return '雄乱已使用过(限定技)';
      if (!st.players[ownerId]?.alive) return '玩家不存在或已死亡';
      // 目标:前端 selectTarget 传 target 或 targets[0]
      const target =
        (params.target as number | undefined) ??
        (Array.isArray(params.targets) ? (params.targets as number[])[0] : undefined);
      if (typeof target !== 'number') return '请选择一名其他角色';
      if (target === ownerId) return '不能选择自己';
      if (!st.players[target]?.alive) return '目标不存在或已死亡';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const target =
        (params.target as number | undefined) ??
        (Array.isArray(params.targets) ? (params.targets as number[])[0] : undefined);
      if (typeof target !== 'number') return;

      // 1) 标记限定技已用(第一个 await 前设,防 dispatch 重入)
      st.players[ownerId].vars[USED_KEY] = true;

      await pushFrame(st, SKILL_NAME, ownerId, { target });
      try {
        const self = st.players[ownerId];

        // 2) 废除判定区:移除已有延时锦囊,写废除标记
        const trickNames = [...new Set(self.pendingTricks.map((t) => t.name))];
        for (const name of trickNames) {
          await applyAtom(st, { type: '移除延时锦囊', player: ownerId, trickName: name });
        }
        st.players[ownerId].vars[JUDGE_ABOLISHED] = true;

        // 3) 废除装备区:逐槽卸下已装备的牌并弃置,写废除标记
        for (const slot of ALL_EQUIP_SLOTS) {
          const equipId = self.equipment[slot];
          if (equipId) {
            await applyAtom(st, { type: '卸下', player: ownerId, slot });
            // 卸下把牌回手;再移到弃牌堆实现"弃置"
            if (st.players[ownerId].hand.includes(equipId)) {
              await applyAtom(st, {
                type: '移动牌',
                cardId: equipId,
                from: { zone: '手牌', player: ownerId },
                to: { zone: '弃牌堆' },
              });
            }
          }
          st.players[ownerId].vars[ABOLISH_PREFIX + slot] = true;
        }

        // 4) 本回合目标(turn.vars 驱动①②③效果,回合结束自动清空)
        st.turn.vars[TARGET_VAR] = target;
      } finally {
        await popFrame(st);
      }
    },
  );

  // ── ① 对目标使用牌无距离限制(本回合) ──
  const unloadDist = registerDistanceExemptor(state, ownerId, (st, from, to) => {
    if (from !== ownerId) return false;
    return st.turn.vars[TARGET_VAR] === to;
  });

  // ── ② 对目标使用杀无次数限制(本回合) ──
  //    杀 quota 是按来源计的回合制上限,无法 per-target 精确豁免;
  //    雄乱激活本回合即放开 owner 的杀次数(对齐咆哮/诸葛连弩)。
  const unloadUnlimited = registerSlashUnlimitedProvider(state, ownerId, (st, player) => {
    if (player !== ownerId) return false;
    return typeof st.turn.vars[TARGET_VAR] === 'number';
  });

  // ── ③ 目标不能使用/打出手牌:拦截卡牌回应型询问 ──
  //    询问闪 / 询问杀:取消 → 父流程检测处理区无响应牌 → 杀必中
  //    请求回应(prompt.type==='useCard'):取消 → 无法出桃/无懈等手牌回应
  const unloadBlockDodge = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom as { target?: number };
      if (typeof atom.target !== 'number') return;
      if (!isBannedFromPlaying(ctx.state, atom.target)) return;
      return { kind: 'cancel' };
    },
  );
  const unloadBlockKill = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问杀',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom as { target?: number };
      if (typeof atom.target !== 'number') return;
      if (!isBannedFromPlaying(ctx.state, atom.target)) return;
      return { kind: 'cancel' };
    },
  );
  const unloadBlockRespond = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '请求回应',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom as { target?: number; prompt?: { type?: string } };
      if (typeof atom.target !== 'number') return;
      // 仅拦截出牌型回应(useCard/useCardAndTarget/pick*/distribute);
      // confirm/choosePlayer/selectTarget 等纯决策型不拦,目标仍可做非出牌选择。
      const promptType = atom.prompt?.type;
      if (!promptType || !CARD_PLAY_PROMPTS.has(promptType)) return;
      if (!isBannedFromPlaying(ctx.state, atom.target)) return;
      return { kind: 'cancel' };
    },
  );

  // ── 废除判定区:不可再放入延时锦囊(永久) ──
  const unloadBlockTrick = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '添加延时锦囊',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number };
      if (typeof atom.player !== 'number') return;
      if (atom.player !== ownerId) return;
      if (!ctx.state.players[ownerId]?.vars[JUDGE_ABOLISHED]) return;
      return { kind: 'cancel' };
    },
  );

  // ── 废除装备区:不可再装装备(永久) ──
  const unloadBlockEquip = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '装备',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number; cardId?: string };
      if (typeof atom.player !== 'number' || atom.player !== ownerId) return;
      const card = ctx.state.cardMap[atom.cardId ?? ''];
      if (!card) return;
      const slot = inferEquipSlot(card.subtype);
      if (!slot) return;
      if (ctx.state.players[ownerId]?.vars[ABOLISH_PREFIX + slot]) {
        return { kind: 'cancel' };
      }
    },
  );

  return () => {
    unloadUse();
    unloadDist();
    unloadUnlimited();
    unloadBlockDodge();
    unloadBlockKill();
    unloadBlockRespond();
    unloadBlockTrick();
    unloadBlockEquip();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '雄乱',
    style: 'danger',
    activeWhen: (ctx) => defaultPlayActive(ctx),
    prompt: {
      type: 'selectTarget',
      title: '雄乱(限定技):指定一名其他角色,废除你的判定区和装备区,本回合对其使用牌无距离和次数限制,其本回合不能使用和打出手牌',
      targetFilter: {
        min: 1,
        max: 1,
        filter: (_view, target) => target !== _view.currentPlayerIndex && !!_view.players[target]?.alive,
      },
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
