// 涅槃(庞统·限定技):当你处于濒死状态时,你可以弃置所有牌和判定区的牌,
// 重置武将牌,摸三张牌并回复至3点体力。
//
// 分析(步骤1):
//   类型:限定技 | 时机:陷入濒死时(濒死状态)
//   流程(确认发动后,按顺序):
//     1. 弃置所有手牌+装备+判定区牌(判定区需先 移除延时锦囊 清 pendingTricks,
//        弃置.apply 会把所有 cardIds 推入弃牌堆)
//     2. 重置武将牌:若处于连环状态,设横置 chained:false
//     3. 摸3张
//     4. 回复至3点(回复体力 amount = max(0, 3 - currentHealth))
//   限定技标记:player.vars['涅槃/used'](整局一次,不被 回合结束 清理)
//
//   钩子:`陷入濒死` after-hook(target=owner 且 未使用过涅槃)→ 请求回应 → 确认后执行。
//   关键:濒死时 alive 仍 true(击杀 atom 才设 false),故 回复体力 validate 通过;
//        runDyingFlow 在 陷入濒死 after-hook 后进入求桃循环,首项 health>0 即 return,
//        涅槃把 health 拉回 3,循环立即退出,庞统不死亡。
//
// 本文件同时导出 createNiepanSkill 工厂(涅槃族共享实现),界涅槃 复用之:
//   标/界共享濒死确认、弃所有牌、复原武将牌、摸3张、回复至3体力与键空间结构;
//   差异全部显式注入——键前缀(=各自技能 id)/文案/界版追加三选一(八阵/火计/看破)。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { setChain } from '../flows/face-down';
import { locateCard } from '../core/judge-zone';
import { registerAfterHook } from '../core/skill';
import { askConfirm, defineConfirmAction, registerConfirmRespond } from '../util/skillRuntime';
import { equipmentCardIds } from '../util/player-query';
import type { SkillModule } from '../types';

/** 涅槃族差异参数(标/界共享实现,差异全部显式注入)。 */
export interface NiepanOptions {
  /** 技能 id(= 键空间前缀:confirm requestType/confirmed/used;标 '涅槃' / 界 '界涅槃') */
  skillId: string;
  /** 玩家可见技能名(Skill.name + onMount 按钮 label) */
  displayName: string;
  description: string;
  /** 濒死主确认 askConfirm 标题(标/界文案逐字不同) */
  confirmTitle: string;
  /** respond requestType 不匹配时的错误文案(标/界历史措辞不同,逐字保留) */
  mismatchError: string;
  /** onMount confirm 弹窗标题 */
  mountTitle: string;
  /** 界版:回复至3体力后逐个询问获得的候选技能(八阵/火计/看破);标版缺省 → 无此步骤 */
  choosableSkills?: readonly string[];
}

/** 涅槃族共享实现:标涅槃与界涅槃仅 键前缀/文案/界版三选一步骤 不同,主流程 atom 序列逐字一致。 */
export function createNiepanSkill(opts: NiepanOptions) {
  // 键名遵循 `${SKILL_ID}/…` 局部技能名模板约定。
  const SKILL_ID = opts.skillId;
  const CONFIRM_RT = `${SKILL_ID}/confirm`;
  const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;
  const USED_KEY = `${SKILL_ID}/used`;
  const TARGET_HEALTH = 3;

  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.displayName,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;

    // ── respond:庞统回应是否发动涅槃 ──
    registerConfirmRespond(state, skill.id, ownerId, CONFIRM_RT, CONFIRMED_KEY, {
      mismatchError: opts.mismatchError,
    });

    // ── 陷入濒死 after-hook:涅槃主逻辑 ──
    registerAfterHook(state, skill.id, ownerId, '陷入濒死', async (ctx) => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      // 限定技:整局一次
      if (ctx.state.players[ownerId]?.vars[USED_KEY]) return;
      // 濒死者须仍是"存活"状态(击杀未发生)。理论上 alive 此刻为 true
      const self = ctx.state.players[ownerId];
      if (!self) return;
      // 重入保护:若其他救援技(仁心/补益等)已在本 陷入濒死 中先行救活(health>0),则跳过
      if (self.health > 0) return;

      // 询问是否发动
      const confirmed = await askConfirm(ctx.state, CONFIRM_RT, ownerId, {
        confirmedKey: CONFIRMED_KEY,
        title: opts.confirmTitle,
        confirmLabel: '发动',
        cancelLabel: '不发动',
        defaultChoice: false,
        timeout: 15,
      });
      if (!confirmed) return;

      // 标记已使用(限定技)。在读到 confirmed 后立即设,防重入。
      // 用 state.vars(不被 回合结束 清理,因后缀不匹配 /usedThisTurn|/healed|/givenCount)。
      // 涅槃是被动触发(无前端按钮),不需「回合用量」同步 view。
      ctx.state.players[ownerId].vars[USED_KEY] = true;

      // 1. 弃置所有牌(手牌+装备+判定区)
      const player = ctx.state.players[ownerId];
      // 先快照(转移过程中数组会变)
      const handCards = [...player.hand];
      const equipCards = equipmentCardIds(player);
      const judgeTricks = player.pendingTricks.map((t) => ({
        trickName: t.name,
        cardId: t.card.id,
      }));
      // 判定区:先移除延时锦囊(清 pendingTricks,前后端同步)
      for (const { trickName } of judgeTricks) {
        await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName });
      }
      // 统一弃置:弃置.apply 过滤手牌+装备并 push 全部 cardIds 到弃牌堆。
      // 判定区只持牌面快照,其实体牌在使用时已入弃牌堆 → 仅补入「不在任何区」的快照牌,
      // 否则同一张牌会在弃牌堆出现两次(重洗后同牌两个实例)。
      const orphanJudgeCards = judgeTricks
        .map((t) => t.cardId)
        .filter((id) => locateCard(ctx.state, id) === null);
      const allCardIds = [...handCards, ...equipCards, ...orphanJudgeCards];
      if (allCardIds.length > 0) {
        await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: allCardIds });
      }

      // 2. 重置武将牌:解除连环状态
      const chained = ctx.state.players[ownerId].marks.some((m) => m.id === 'chained');
      if (chained) {
        await setChain(ctx.state, ownerId, false);
      }

      // 3. 摸三张牌
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 3 });

      // 4. 回复至3点体力(计算差值;濒死时 health≤0,amount = 3 - health)
      const cur = ctx.state.players[ownerId].health;
      const amount = Math.max(0, TARGET_HEALTH - cur);
      if (amount > 0) {
        await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount });
      }

      // 5. 三选一(界版):逐个询问是否获得候选技能
      //    (官方"然后获得八阵/火计/看破中的一个")。
      //    用顺序 confirm 替代单次 confirm(params.skill 不可达) —— 前端 confirm 只发 choice 布尔。
      //    庞统此时 health=3 且 alive,询问不会卡死濒死流程(濒死循环已退出)。
      const choosableSkills = opts.choosableSkills;
      if (choosableSkills) {
        let selected: string | undefined;
        for (const skillName of choosableSkills) {
          const takeSkill = await askConfirm(ctx.state, CONFIRM_RT, ownerId, {
            confirmedKey: CONFIRMED_KEY,
            title: `${opts.displayName}:是否获得「${skillName}」?`,
            confirmLabel: '获得',
            cancelLabel: '不要',
            defaultChoice: false,
            timeout: 15,
          });
          if (takeSkill) {
            selected = skillName;
            delete ctx.state.localVars[CONFIRMED_KEY];
            break;
          }
          delete ctx.state.localVars[CONFIRMED_KEY];
        }
        // 全部拒绝时默认获得第一个(界涅槃为 八阵)
        selected ??= choosableSkills[0];
        await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: selected });
      }
    });

    return () => {};
  }

  function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
    defineConfirmAction(api, 'respond', {
      label: opts.displayName,
      title: opts.mountTitle,
    });
    return undefined;
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: NiepanOptions = {
  skillId: '涅槃',
  displayName: '涅槃',
  description: '限定技:濒死时弃置所有牌和判定区牌,重置武将牌,摸三张并回复至3点体力',
  mismatchError: '当前不是涅槃确认',
  confirmTitle: '是否发动涅槃?(限定技:弃所有牌,摸3张,回复至3体力)',
  mountTitle: '是否发动涅槃?',
};

export const { createSkill, onInit, onMount } = createNiepanSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
