// 界仁德(界刘备):
//   出牌阶段,每名角色限一次,你可以交给一名其他角色任意张手牌。
//   当你本阶段以此法给出第二张牌时,你可以视为使用一张基本牌
//   (使用【杀】有次数限制)。
//
// OL 官方:
//   "出牌阶段,每名角色限一次,你可以交给一名其他角色任意张手牌。
//    当你本阶段以此法给出第二张牌时,你可以视为使用一张基本牌
//    (使用【杀】有次数限制)。"
//
// 与标仁德区别:
//   - 标仁德:以此法给出第二张时【回复1点体力】(回血),无限次给牌(每名角色无限制)。
//   - 界仁德:【不回血】,改为可"视为使用一张基本牌"(杀/桃/酒);每名角色每回合限一次。
//
// 给牌主流程(校验/移动/计数/onMount distribute 按钮)复用标版仁德导出的
// createRendeSkill 工厂;本文件只写差异:
//   - 每名角色每回合限一次(self.vars['仁德/givenTargets'],回合结束清空)。
//   - 跨过第二张时触发"视为使用基本牌"询问:用 self.vars['仁德/basicUsed'] 防重入(每阶段一次)。
//   - 基本牌范围:杀/桃/酒(闪无主动使用场景,故不提供)。
//   · 杀:须尊重出杀次数限制(canSlash 预检;计数由 chargeOnSettle 的 onSettle 负责)。
//   · 桃:目标须已受伤(health<maxHealth),存活。
//   · 酒:仅对自己,标记下一张杀伤害+1。
//   - 转化卡:用 `仁德:杀:${source}:${target}:${seq}` 等虚拟卡 id,无实体;不入弃牌堆。
import type { GameState, GameView, Json } from '../types';
import { applyAtom } from '../core/apply'
import { registerAction } from '../core/skill';
import { inAttackRange } from '../rules/distance';
import { canSlash } from '../rules/slash-quota';
import { usedThisTurn } from '../rules/once-per-turn';
import { runUseFlow } from './cards/use-card';
import { requireRequestType, firstTarget, defineConfirmAction, currentRequestType } from '../util/skillRuntime';
import { runVirtualSlash } from './cards/_virtualSlash';
import { createRendeSkill, type RendeOptions } from './仁德';
import type { SkillModule } from '../types';

// localVars keys(界刘备视为使用基本牌流程)
const BASIC_CHOICE_VAR = '仁德/basicChoice';
const BASIC_TARGET_VAR = '仁德/basicTarget';
// 请求回应的 requestType(隔离 respond 路由)
const CHOICE_RT = '界仁德/basicChoice';
const TARGET_RT = '界仁德/basicTarget';

/** 视为使用一张【桃】:走 runUseFlow virtual（resolve=回复体力） */
async function virtualPeach(state: GameState, source: number, target: number): Promise<void> {
  const t = state.players[target];
  if (!t?.alive) return;
  if (t.health >= t.maxHealth) return;
  const cardId = `仁德:桃:${source}:${target}:${state.seq}`;
  state.cardMap[cardId] = { id: cardId, name: '桃', suit: '', color: '无色', rank: 'A', type: '基本牌' };
  await runUseFlow(state, source, cardId, [target], '桃', { virtual: true });
  delete state.cardMap[cardId];
}

/** 视为使用一张【酒】:走 runUseFlow virtual（resolve=加增伤标记） */
async function virtualWine(state: GameState, source: number): Promise<void> {
  const cardId = `仁德:酒:${source}:${source}:${state.seq}`;
  state.cardMap[cardId] = { id: cardId, name: '酒', suit: '', color: '无色', rank: 'A', type: '基本牌' };
  await runUseFlow(state, source, cardId, [source], '酒', { virtual: true });
  delete state.cardMap[cardId];
}

const OPTIONS: RendeOptions = {
  skillName: '界仁德',
  description:
    '出牌阶段:每名角色限一次,将任意张手牌交给一名其他角色;本阶段给出第二张时,可视为使用一张基本牌',
  mountTitle: '界仁德：选择要送出的手牌和目标角色(每名角色每回合限一次)',
  crossGuardKey: '仁德/basicUsed',
  extraValidate: (state, ownerId, normalized) => {
    // 界仁德:每次只能交给一名角色 + 本回合未交给过该角色(每名角色每回合限一次)
    const self = state.players[ownerId];
    const distinctTargets = new Set(normalized.map((t) => t.target));
    const singleTarget = distinctTargets.size === 1;
    const givenTargets = Array.isArray(self.vars['仁德/givenTargets'])
      ? (self.vars['仁德/givenTargets'] as number[])
      : [];
    const notGivenBefore = !givenTargets.includes(normalized[0].target);
    return singleTarget && notGivenBefore;
  },
  afterGive: async (state, from, targets, shouldOfferBasic) => {
    const self = state.players[from];
    // 记录已给目标(本回合不能再给)
    const givenTargets = Array.isArray(self.vars['仁德/givenTargets'])
      ? (self.vars['仁德/givenTargets'] as number[])
      : [];
    for (const t of targets) {
      if (!givenTargets.includes(t.target)) givenTargets.push(t.target);
    }
    self.vars['仁德/givenTargets'] = givenTargets;

    // 界仁德核心新增:本阶段首次给出第二张 → 询问视为使用基本牌
    if (!shouldOfferBasic) return;
    // 标记本阶段已触发(防重入;每名角色每回合限一次给牌 + 一次询问)
    self.vars['仁德/basicUsed'] = true;

    // 步骤1:询问选择基本牌类型(杀/桃/酒,或不使用)
    delete state.localVars[BASIC_CHOICE_VAR];
    await applyAtom(state, {
      type: '请求回应',
      requestType: CHOICE_RT,
      target: from,
      prompt: {
        type: 'chooseOption',
        title: '界仁德:视为使用一张基本牌?',
        options: [
          { value: '杀', label: '杀' },
          { value: '桃', label: '桃' },
          { value: '酒', label: '酒' },
          { value: '不使用', label: '不使用' },
        ],
      },
      defaultChoice: '不使用',
      timeout: 30,
    });
    const choice = state.localVars[BASIC_CHOICE_VAR];
    delete state.localVars[BASIC_CHOICE_VAR];

    if (choice === '杀') {
      // 须尊重出杀次数限制:已达上限则不发起目标询问
      if (!canSlash(state, from)) {
        // 已达上限:不使用,直接结束(不计为已使用次数)
      } else {
        delete state.localVars[BASIC_TARGET_VAR];
        await applyAtom(state, {
          type: '请求回应',
          requestType: TARGET_RT,
          target: from,
          prompt: {
            type: 'choosePlayer',
            title: '界仁德:选择【杀】的目标(攻击范围内一名其他角色)',
            min: 1,
            max: 1,
            filter: (_view: GameView, t: number) =>
              t !== from &&
              state.players[t]?.alive === true &&
              inAttackRange(state, from, t),
          },
          timeout: 30,
        });
        const slashTarget = state.localVars[BASIC_TARGET_VAR] as number | undefined;
        delete state.localVars[BASIC_TARGET_VAR];
        if (typeof slashTarget === 'number' && state.players[slashTarget]?.alive) {
          // 出杀次数累加已由 runVirtualSlash 的 charge 计费负责
          await runVirtualSlash(state, from, slashTarget, { prefix: '仁德', charge: true });
        }
      }
    } else if (choice === '桃') {
      // 桃:目标须已受伤(任意已受伤角色,含自己)
      delete state.localVars[BASIC_TARGET_VAR];
      await applyAtom(state, {
        type: '请求回应',
        requestType: TARGET_RT,
        target: from,
        prompt: {
          type: 'choosePlayer',
          title: '界仁德:选择【桃】的目标(一名已受伤角色,可对自己)',
          min: 1,
          max: 1,
          filter: (_view: GameView, t: number) => {
            const tp = state.players[t];
            return !!tp?.alive && tp.health < tp.maxHealth;
          },
        },
        timeout: 30,
      });
      const peachTarget = state.localVars[BASIC_TARGET_VAR] as number | undefined;
      delete state.localVars[BASIC_TARGET_VAR];
      if (typeof peachTarget === 'number' && state.players[peachTarget]?.alive) {
        await virtualPeach(state, from, peachTarget);
      }
    } else if (choice === '酒') {
      // 酒增伤(使用方法Ⅰ)每回合限一次:已用过且无"酒/无次数限制"豁免则不使用
      // (与 杀 的 canSlash 预检对称;canUseWine 同款判定)。否则视为使用一张酒。
      if (
        usedThisTurn(state, from, '酒') &&
        !state.players[from]?.tags.includes('酒/无次数限制')
      ) {
        // 本回合已用酒增伤:不使用,直接结束
      } else {
        await virtualWine(state, from);
      }
    }
    // choice === '不使用' / 超时 → 不使用,直接结束
  },
  extraInit: (state, skillId, ownerId) => {
    // ── respond:处理界仁德视为使用基本牌的 choice/target 询问 ──
    registerAction(
      state,
      skillId,
      ownerId,
      'respond',
      (s: GameState): string | null =>
        requireRequestType(s, ownerId, [CHOICE_RT, TARGET_RT], {
          mismatchError: '当前不是仁德询问',
        }).error,
      async (s: GameState, params: Record<string, Json>) => {
        const rt = currentRequestType(s, ownerId) ?? '';
        if (rt === CHOICE_RT) {
          // chooseOption:option 为 '杀'/'桃'/'酒'/'不使用'(参考化身.ts 的处理方式)
          const c = params.option;
          if (c === '杀' || c === '桃' || c === '酒') {
            s.localVars[BASIC_CHOICE_VAR] = c;
          } else {
            // '不使用' / 超时 / 其他 → 不使用
            s.localVars[BASIC_CHOICE_VAR] = '不使用';
          }
        } else if (rt === TARGET_RT) {
          const t = firstTarget(params);
          if (typeof t === 'number') s.localVars[BASIC_TARGET_VAR] = t;
        }
      },
    );
  },
  extraMount: (api) => {
    defineConfirmAction(api, 'respond', {
      label: '界仁德',
      title: '界仁德',
      style: 'default',
    });
  },
};

export const { createSkill, onInit, onMount } = createRendeSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
