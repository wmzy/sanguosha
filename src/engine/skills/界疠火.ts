// 界疠火(界程普·吴·主动技,OL 界限突破官方逐字):
//   你使用的非火【杀】可以改为火【杀】使用,此牌结算后,若其造成伤害,
//   你弃置一张牌或失去1体力。你使用的火【杀】可以多指定一个目标。
//
// 与标版疠火(程普)区别:
//   1. 标版:仅"普通【杀】可视为火【杀】"(不含雷杀);界版:"非火【杀】"(含雷杀)。
//   2. 标版:转化杀造成伤害后"失去1点体力"(固定代价);界版:"弃置一张牌或失去1体力"(二选一)。
//   3. 多目标效果两版相同(火杀可+1目标)。
//
// 实现:
//   ① transform action(preceding,主 action=杀.use 之前执行):经 skillRuntime 转化技工厂
//      注册(outputDamageType='火焰'):校验 owner 手中的杀 damageType !== '火焰'
//      (即非火杀,含普通/雷杀),创建影子卡 `${cardId}#界疠火`(后缀 = 技能 id,与客户端
//      构造约定一致),name='杀',damageType='火焰',继承花色/点数/颜色,shadowOf 指向原卡。
//      标记 `localVars['疠火/converted:${shadowId}']` = true 供后续 hook 识别
//      (工厂 afterExecute 维度;rollback 经 extraRollback 清理)。
//   ② 造成伤害 after-hook:
//      若 atom.source===owner + atom.cardId 是疠火转化影子 + amount>0 →
//      标记 `localVars['疠火/damaged:${shadowId}']` = true。
//   ③ 移动牌 after-hook:
//      若 atom.cardId 是疠火转化影子 + from.zone='处理区' + to.zone='弃牌堆'(杀收尾移动)
//      + 已造成伤害 → 询问 owner 弃1手牌;若 owner 超时(选择"失去体力")或手牌为空,
//      则失去 1 体力。
//      询问 requestType='疠火/cost';respond 写入 COST_CARD_KEY。
//   ④ 多目标:owner 注册 slashTargetProvider,使用火杀(原始或疠火转化)时返回 2
//      (默认 1 + 火杀额外 1),canUseSlash 据此放宽目标数上限。前端 targetFilter max=2 配合。
//
// 命名:文件名/loader key/character skill name 均为 '界疠火'(避开标疠火冲突);
//   内部 Skill.name = '疠火'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  GameView,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import { defaultPlayActive, viewCanSlash } from '../rules/action-active';
import { registerSlashTargetProvider } from '../rules/slash-target';
import { requireRequestType, registerTransformAction, mountTransformAction, type TransformActionOptions } from '../util/skillRuntime';

const DISPLAY_NAME = '疠火';
const COST_RT = '界疠火/cost';
const COST_CARD_KEY = '疠火/costCard';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '你使用的非火【杀】可以改为火【杀】;此牌造成伤害后,你弃1牌或失去1体力;你使用的火【杀】可多指定一个目标',
  };
}

/** 标记某影子为疠火转化(在 localVars 里) */
function convertedKey(shadowId: string): string {
  return `疠火/converted:${shadowId}`;
}

/** 标记某影子已造成伤害(在 localVars 里) */
function damagedKey(shadowId: string): string {
  return `疠火/damaged:${shadowId}`;
}

const TRANSFORM_OPTIONS: TransformActionOptions = {
  outputName: '杀',
  // outputDamageType='火焰' 是疠火核心:非火杀转化为火杀
  outputDamageType: '火焰',
  // 非火杀:name === '杀' 且 damageType !== '火焰'(含普通杀与雷杀)
  cardPredicate: (state, _ownerId, cardIds) => {
    const card = state.cardMap[cardIds[0]];
    return !!card && card.name === '杀' && card.damageType !== '火焰';
  },
  invalidError: '现在不能使用疠火',
  // 标记此影子为疠火转化,供后续 hook 识别
  afterExecute: (state, _ownerId, shadowId) => {
    state.localVars[convertedKey(shadowId)] = true;
  },
  // rollback 配对清理 localVars 标记(影子/手牌还原由工厂与 dispatch 快照负责)
  extraRollback: (state, _ownerId, _cardIds, shadowId) => {
    delete state.localVars[convertedKey(shadowId)];
    delete state.localVars[damagedKey(shadowId)];
  },
  mount: {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '疠火:将非火【杀】当火【杀】使用',
      // 选非火杀(普通/雷杀)
      cardFilter: {
        filter: (c) => c.name === '杀' && c.damageType !== '火焰',
        min: 1,
        max: 1,
      },
      targetFilter: {
        min: 1,
        // 火杀可多指定一个目标(默认 1 + 1 = 2);后端 slashTargetProvider 权威校验
        max: 2,
        filter: (view: GameView, t: number) => {
          // 排除自己;具体距离校验由后端 杀.use validate 处理
          const cp = view.currentPlayerIndex;
          return t !== cp;
        },
      },
    },
    activeWhen: (ctx) => defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx),
  },
};

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 添加持久 tag:火杀多目标(供前端 viewSlashTargetMax 推断,替代 skills.includes 检查)
  const owner = state.players[ownerId];
  const FIRE_TAG = '杀/火杀多目标';
  if (!owner.tags.includes(FIRE_TAG)) {
    owner.tags.push(FIRE_TAG);
  }

  // ─── 杀目标数提供者:owner 的火杀可多指定一个目标(默认 1 + 1 = 2) ──
  // 原始火杀与疠火转化影子均 damageType='火焰',统一识别。
  const unloadTarget = registerSlashTargetProvider(state, ownerId, (st, _player, cardId) => {
    if (!cardId) return 0;
    const card = st.cardMap[cardId];
    return card?.name === '杀' && card.damageType === '火焰' ? 2 : 0;
  });

  // ─── transform action:把非火杀转化为火杀影子(preceding,杀.use 之前) ──
  registerTransformAction(state, skill.id, ownerId, TRANSFORM_OPTIONS);

  // ─── respond:玩家在「疠火/cost」询问下选弃哪张牌;超时 = 失去1体力 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s, params) => {
      const check = requireRequestType(s, ownerId, [COST_RT], {
        mismatchError: '当前不是疠火代价选择',
      });
      if (check.error) return check.error;
      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string') return 'cardId required';
      const self = s.players[ownerId];
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      return null;
    },
    async (s, params) => {
      s.localVars[COST_CARD_KEY] = params.cardId;
    },
  );

  // ─── 造成伤害 after:记录疠火转化杀是否造成伤害 ──────────────────
  registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    // 只标记疠火转化的影子(其他来源的火杀不触发代价)
    if (!ctx.state.localVars[convertedKey(cardId)]) return;
    ctx.state.localVars[damagedKey(cardId)] = true;
  });

  // ─── 移动牌 after:杀收尾时(处理区→弃牌堆)触发疠火代价 ─────────
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (atom.from?.zone !== '处理区') return;
    if (atom.to?.zone !== '弃牌堆') return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    // 仅疠火转化影子触发
    if (!ctx.state.localVars[convertedKey(cardId)]) return;
    // 必须造成过伤害
    const damaged = ctx.state.localVars[damagedKey(cardId)] === true;
    // 清理 localVars 标记(无论是否触发代价,影子已入弃牌堆不再追踪)
    delete ctx.state.localVars[convertedKey(cardId)];
    delete ctx.state.localVars[damagedKey(cardId)];
    if (!damaged) return;

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 弃1张牌 or 失去1体力
    // 实现:询问 owner 弃1张手牌。若 owner 超时(pass=不愿弃)或手牌为空 → 失去1体力。
    if (self.hand.length > 0) {
      delete ctx.state.localVars[COST_CARD_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: COST_RT,
        target: ownerId,
        prompt: {
          type: 'useCard',
          title: '疠火:此杀造成伤害。弃置 1 张牌,或放弃(失去 1 体力)',
          // filter:()=>true 让投影层(resolveCardFilterCandidates)下发全手牌 candidates,
          // 否则前端拿不到可选牌只能等超时失去体力
          cardFilter: { filter: () => true, min: 1, max: 1 },
        },
        // 超时默认 false(放弃,失去1体力)
        defaultChoice: false,
        timeout: 10,
      });
      const costCard = ctx.state.localVars[COST_CARD_KEY] as string | undefined;
      delete ctx.state.localVars[COST_CARD_KEY];
      if (typeof costCard === 'string' && self.hand.includes(costCard)) {
        // 弃置选中的牌
        await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [costCard], voluntary: true });
      } else {
        // 未选(超时/主动放弃)→ 失去1体力
        await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
      }
    } else {
      // 无手牌:只能失去1体力
      await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
    }
  });

  return () => {
    unloadTarget();
    owner.tags = owner.tags.filter((t) => t !== '杀/火杀多目标');
  };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // transform:前端选非火杀 → 选目标 → 点疠火按钮 → 提交 preceding=[疠火.transform] + 主 action=杀.use
  // (转化技前端入口:transform 回调由工厂附带,缺 transform 字段则前端无法进入转化模式)
  mountTransformAction(api, skill.id, TRANSFORM_OPTIONS);
  // respond:代价选择(弃1张牌或放弃=失去1体力)
  api.defineAction('respond', {
    label: '弃1张牌',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '疠火:请弃置 1 张牌(或放弃失去 1 体力)',
      // cardFilter 必须有 filter 函数:AI/headless 经 extractCardFilter 枚举可选牌,
      // 缺 filter 时恒不匹配 → 永远枚举不出该弃牌动作(同 界义绝/界制霸 先例)
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
