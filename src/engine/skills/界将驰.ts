// 界将驰(界曹彰·主动技,OL hero/599 界限突破官方逐字):
//   "摸牌阶段结束时，你可以选择一项：
//    1.摸一张牌，你本回合使用【杀】的次数-1，且【杀】不计入手牌上限；
//    2.重铸一张牌，且本回合使用【杀】的次数+1，【杀】无距离限制。"
//
// 与标版曹彰·将驰(未实现)的区别(参考 docs/research/武将技能/魏国/曹彰.md):
//   - 标版①:"本回合不能使用或打出【杀】"(强禁杀,含 respond 场景)
//   - 界版①:"本回合使用【杀】的次数-1"(默认 1→0,即出牌阶段不可出杀;
//     被动 respond 杀不受限——界版措辞聚焦"使用次数")
//   - 标版②:"弃置一张牌"(纯弃,不补牌)
//   - 界版②:"重铸一张牌"(弃+摸一张,资源无损;转化出"无距离限制"杀)
//
// 实现要点:
//   - 触发时机:阶段结束(摸牌) after-hook。需区分"正常结束"vs"被跳过"——
//     仿 截辎.ts:阶段开始(摸牌) after-hook 设 normalDrawPhase 标记(被跳过的
//     摸牌阶段 cancel 阶段开始,after-hook 不执行,标记缺失)。阶段结束 after-hook
//     校验标记存在才触发,确保兵粮寸断/神速/巧变/再起跳过时不误触发。
//   - 选项1 杀次数-1:slash-quota.ts 的 slashMax 基础 1,provider 仅可加不可减。
//     用 registerSlashBlocker 直接阻断出杀(canSlash=false),等效"次数变 0"。
//     默认基础 1→0;若同时有连弩等∞增益,严格规则下 -1 vs ∞ 模糊,这里取更严
//     (阻断优先,与 isSlashBlocked 短路语义一致)。
//   - 选项1 杀不计入手牌上限:registerHandLimitProvider 返回"默认公式+手牌中
//     【杀】牌数量"。把杀牌占用的"名额"加回上限,等价于杀牌不占上限。
//     (镜像 界洛神 EXEMPT_VAR 思路,但界洛神只豁免特定判定牌,本技豁免全部杀牌)
//   - 选项2 杀次数+1:registerSlashMaxProvider 返回 1(base 1+1=2)。
//   - 选项2 杀无距离限制:基础牌 杀.ts 的 use.validate 横切新增 turn.vars
//     检查(仿 诈降/界武圣 的红色/方片杀放行模式,但本技对所有杀放行);
//     viewDistance.ts viewCanAttack 同步前端 filter。
//   - 重铸:弃置手牌 + 摸一张(同 铁索连环.recast 的实现模式)。
//
// 询问流程(2 段 confirm,因 ActionPrompt 无 3 选项枚举):
//   ① ACTIVATE_RT:是否发动?(默认不发动,超时=不发动)
//   ② 若发动 + 手牌非空:CHOOSE_RT 选择①/②(超时默认 ①)
//     若发动 + 手牌为空:强制走①(②需要弃手牌,不可执行)
//   ③ 若选②:PICK_RT 选一张手牌重铸
//
// 命名:文件名/loader key/character skill name 均为 '界将驰'(避开标版未实现的 将驰);
//   内部 Skill.name = '将驰'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';
import { registerSlashMaxProvider, registerSlashBlocker } from '../slash-quota';
import { registerHandLimitProvider } from '../hand-limit';
import { registerAttackRangeExemptor } from '../distance';

const SKILL_ID = '界将驰';
const DISPLAY_NAME = '将驰';

/** localVars key:最近一个正常开始的摸牌阶段所属玩家(被跳过时不设) */
const NORMAL_KEY = '将驰/normalDrawPhase';
/** localVars key:是否发动(true=发动) */
const ACTIVATE_KEY = '将驰/activateChoice';
/** localVars key:选项(true=①摸一张, false=②重铸一张) */
const CHOICE_KEY = '将驰/optionChoice';
/** localVars key:重铸的手牌 cardId */
const CARD_KEY = '将驰/cardId';

/** 询问 requestType */
const ACTIVATE_RT = '将驰/activate';
const CHOOSE_RT = '将驰/choose';
const PICK_RT = '将驰/pick';

/** turn.vars key:选项1激活(值=激活者 ownerId) */
const CHOICE1_VAR = '将驰/choice1';
/** turn.vars key:选项2激活(值=激活者 ownerId) */
const CHOICE2_VAR = '将驰/choice2';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '摸牌阶段结束时选择一项:①摸一张牌,本回合杀次数-1且杀不计入手牌上限;②重铸一张牌,本回合杀次数+1且杀无距离限制',
  };
}

/** 当前 pending 的 requestType(类型安全读取) */
function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  return (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 选项1:杀次数-1 → 阻断出杀(默认 1→0,等效"次数变 0") ──
  const unloadBlocker = registerSlashBlocker(
    state,
    ownerId,
    (st: GameState, player: number) => st.turn.vars[CHOICE1_VAR] === player,
  );

  // ── 选项2:杀次数+1(provider 返回 1,base 1+1=2) ──
  const unloadProvider = registerSlashMaxProvider(
    state,
    ownerId,
    (st: GameState, player: number) => (st.turn.vars[CHOICE2_VAR] === player ? 1 : 0),
  );

  // ── 选项2:杀无距离限制(本回合全局,所有杀生效) ──
  //   通过 distance.registerAttackRangeExemptor 注册 predicate,避免污染 杀.ts/distance.ts。
  const unloadRangeExemptor = registerAttackRangeExemptor(
    state,
    ownerId,
    (st, from, _to, _cardId) => st.turn.vars[CHOICE2_VAR] === from,
  );

  // ── 选项1:杀不计入手牌上限 ──
  //   覆盖型 provider:返回 默认公式(体力+加成) + 手牌中【杀】牌数量。
  //   把杀牌占用的名额加回上限,等价于杀牌不占上限。
  //   (镜像 界洛神 思路,但本技豁免全部杀牌,不限特定 id)
  const unloadHandLimit = registerHandLimitProvider(state, ownerId, (st, player) => {
    if (st.turn.vars[CHOICE1_VAR] !== player) return undefined;
    const p = st.players[player];
    if (!p) return undefined;
    const slashCount = p.hand.filter((cid) => st.cardMap[cid]?.name === '杀').length;
    if (slashCount === 0) return undefined; // 无杀牌时不覆盖,走默认公式
    const bonus = (st.turn.vars[`手牌上限/bonus:${player}`] as number | undefined) ?? 0;
    const health = p.health ?? 0;
    return health + bonus + slashCount;
  });

  // ── respond:处理三段询问(ACTIVATE/CHOOSE/PICK) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) => {
      const rt = currentRequestType(s, ownerId);
      if (rt !== ACTIVATE_RT && rt !== CHOOSE_RT && rt !== PICK_RT) {
        return '当前不是将驰询问';
      }
      return null;
    },
    async (s, params) => {
      const rt = currentRequestType(s, ownerId);
      if (rt === ACTIVATE_RT) {
        s.localVars[ACTIVATE_KEY] = params.choice === true;
      } else if (rt === CHOOSE_RT) {
        s.localVars[CHOICE_KEY] = params.choice === true;
      } else if (rt === PICK_RT) {
        if (typeof params.cardId === 'string') {
          s.localVars[CARD_KEY] = params.cardId;
        }
      }
    },
  );

  // ── 阶段开始(摸牌) after-hook:标记正常开始的摸牌阶段 ──
  //   被跳过的摸牌阶段(兵粮寸断/神速/巧变/再起)在 before-hook cancel 阶段开始,
  //   本 after-hook 不执行 → 标记不设置 → 阶段结束 hook 见标记缺失 → 不触发
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '摸牌') return;
    if (atom.player !== ownerId) return;
    ctx.state.localVars[NORMAL_KEY] = ownerId;
  });

  // ── 阶段结束(摸牌) after-hook:核心触发,询问并执行选择 ──
  registerAfterHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段结束') return;
    if (atom.phase !== '摸牌') return;
    if (atom.player !== ownerId) return;
    // 跳过情形:阶段开始 after-hook 未执行 → 标记缺失 → 不触发
    if (ctx.state.localVars[NORMAL_KEY] !== ownerId) return;
    delete ctx.state.localVars[NORMAL_KEY];

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // ── 询问①:是否发动将驰?(默认不发动,超时=不发动) ──
    delete ctx.state.localVars[ACTIVATE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: ACTIVATE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '将驰:是否发动?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (ctx.state.localVars[ACTIVATE_KEY] !== true) return;

    // ── 询问②:选哪一项?(手牌为空时跳过,直接走①) ──
    //   CHOICE_KEY: true=①, false=②, undefined(超时)=①(默认选项)
    let option1 = true;
    if (self.hand.length > 0) {
      delete ctx.state.localVars[CHOICE_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CHOOSE_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title:
            '将驰:选择一项  ①摸一张(杀次数-1,杀不计入手牌上限)  ②重铸一张(杀次数+1,杀无距离限制)',
          confirmLabel: '①摸一张',
          cancelLabel: '②重铸一张',
        },
        defaultChoice: true, // 超时默认 ①
        timeout: 10,
      });
      // CHOICE_KEY === false → 选项②;否则(true/undefined)→ 选项①
      option1 = ctx.state.localVars[CHOICE_KEY] !== false;
    }

    if (option1) {
      // ── 选项①:摸一张牌 + 杀次数-1(blocker)+ 杀不计入手牌上限(hand-limit provider) ──
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
      ctx.state.turn.vars[CHOICE1_VAR] = ownerId;
      // 投影到 view.turnUsage,供前端 viewSlashMax / viewCanAttack / hand-limit 显示
      await applyAtom(ctx.state, {
        type: '回合用量',
        player: ownerId,
        key: CHOICE1_VAR,
        value: true,
      });
      return;
    }

    // ── 选项②:重铸一张手牌(弃+摸)+ 杀次数+1(provider)+ 杀无距离限制(杀.ts 横切) ──
    if (self.hand.length === 0) {
      // 无手牌可重铸 → 不发动(理论上不会到这里,询问②已跳过)
      return;
    }
    delete ctx.state.localVars[CARD_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: PICK_RT,
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: '将驰:选择一张手牌重铸',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      timeout: 10,
    });
    const cardId = ctx.state.localVars[CARD_KEY] as string | undefined;
    delete ctx.state.localVars[CARD_KEY];
    if (!cardId || !self.hand.includes(cardId)) {
      // 超时或 cardId 无效 → 不发动
      return;
    }
    // 重铸:弃置 + 摸一张
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [cardId] });
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    ctx.state.turn.vars[CHOICE2_VAR] = ownerId;
    // 投影到 view.turnUsage
    await applyAtom(ctx.state, {
      type: '回合用量',
      player: ownerId,
      key: CHOICE2_VAR,
      value: true,
    });
  });

  return () => {
    unloadBlocker();
    unloadProvider();
    unloadRangeExemptor();
    unloadHandLimit();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 触发技无主动 action;玩家通过 请求回应 询问选择
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
