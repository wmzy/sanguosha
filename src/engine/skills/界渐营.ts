// 界渐营(界沮授·群·被动技,OL 界限突破官方逐字):
//   当你于出牌阶段使用牌时,若此牌与你于此阶段使用的上一张牌花色或点数相同,
//   则你可以摸一张牌。出牌阶段限一次,你可以将一张牌当做任意一张基本牌使用,
//   若你于本阶段使用的上一张牌有花色,则此牌的花色视为与上一张牌的花色相同。
//
// 与标版渐营区别(标版未实现,docs/research/武将技能/群雄/沮授.md):
//   - 标版渐营只有"用牌与前张同花色或点数则摸一张"被动效果
//   - 界版新增第二段:出牌阶段限一次,将一张牌当任意基本牌使用(可继承上张花色)
//
// 实现要点:
//   - "上一张牌"追踪:turn.vars['界渐营/lastSuit']/['界渐营/lastRank'](string)
//     生产者:移动牌 after-hook(from=手牌,to=处理区,在 owner 出牌阶段)+ 装备 after-hook
//     消费者:移动牌 after-hook(下次比较)、渐营 transform execute(继承花色)
//     重置:阶段开始(出牌) after-hook(owner) → 置 ''(空,表示无上一张)
//   - 触发时机:移动牌 after-hook(owner 手牌→处理区,在 owner 出牌阶段)
//     和 装备 after-hook(owner 出牌阶段装备牌)
//     (装备也是"使用牌",需要追踪。OL 装备使用计入 渐营 触发条件)
//   - 限一次(第二段):player.vars['界渐营/transform/usedThisTurn'](后缀 /usedThisTurn 自动清空)
//   - 转化(第二段):经 skillRuntime 转化技工厂注册(每个声明牌名一个 `transform:<牌名>`
//     action):当作 atom 创建影子卡;若上一张牌有花色,override 影子卡 suit/color
//   - 花色继承后视图同步限制:当作 atom 的 applyView 据源卡 view.cardMap 构造影子,
//     override 是直接 mutate state.cardMap[shadowId](applyView 看不到),故视图可能不一致。
//     测试中用 disableAutoCompare() 跳过已知视图不一致,行为正确性由 state 直接验证。
//
// 命名:文件名/loader key/character skill name 均为 '界渐营'(避开标版冲突);
//   内部 Skill.name = '渐营'(OL 官方技能名,玩家可见)。
import type { ActionContext, Card, FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { setPlayerVarUsage } from '../rules/turn-usage';
import { registerAfterHook, hasBlockingPending } from '../core/skill';
import { defaultPlayActive } from '../rules/action-active';
import { getCardEffect } from './cards';
import { TRANSFORM_ACTION_PREFIX } from '../util/declaredActionType';
import type { SkillModule } from '../types';
import {
  askConfirm,
  defineConfirmAction,
  mountTransformAction,
  registerConfirmRespond,
  registerTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';

const SKILL_ID = '界渐营';
const DISPLAY_NAME = '渐营';

/** 上一张牌花色('' = 本阶段尚未使用过牌) */
const LAST_SUIT_KEY = `${SKILL_ID}/lastSuit`;
/** 上一张牌点数('' = 本阶段尚未使用过牌) */
const LAST_RANK_KEY = `${SKILL_ID}/lastRank`;
/** 第二段"当任意基本牌使用"限一次标记(后缀 /usedThisTurn 自动清空) */
const TRANSFORM_USED_KEY = `${SKILL_ID}/transform/usedThisTurn`;
/** 询问 requestType:渐营是否摸一张 */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
/** localVars key:owner 是否确认摸牌 */
const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;

/** 渐营第二段允许声明的目标牌名(基本牌) */
const ALLOWED_NAMES: ReadonlySet<string> = new Set(['杀', '闪', '桃', '酒']);

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段用牌若与上一张花色或点数相同,可摸一张;每阶段限一次,可将一张牌当任意基本牌使用(若有上一张花色则继承)',
  };
}

/** 上一张牌花色('' / '♠' / '♥' / '♣' / '♦') */
function lastSuit(state: GameState): string {
  const v = state.turn.vars[LAST_SUIT_KEY];
  return typeof v === 'string' ? v : '';
}

/** 上一张牌点数 */
function lastRank(state: GameState): string {
  const v = state.turn.vars[LAST_RANK_KEY];
  return typeof v === 'string' ? v : '';
}

/** 写入"上一张牌" */
function setLast(state: GameState, suit: string, rank: string): void {
  state.turn.vars[LAST_SUIT_KEY] = suit;
  state.turn.vars[LAST_RANK_KEY] = rank;
}

/** 重置"上一张牌"为空 */
function resetLast(state: GameState): void {
  setLast(state, '', '');
}

/** 是否处于 owner 的出牌阶段 */
function inMyPlayPhase(state: GameState, ownerId: number): boolean {
  return state.currentPlayerIndex === ownerId && state.phase === '出牌';
}

/** 第二段是否已用过(限一次/阶段) */
function transformUsed(state: GameState, ownerId: number): boolean {
  return !!state.players[ownerId]?.vars[TRANSFORM_USED_KEY];
}

/** 声明的牌名此刻能否被主动使用(与 使用牌 的 onMount 同源判据):
 *  timing='生效前' 的纯回应牌(闪/无懈可击)无主动 use 入口;牌自身 activeWhen 不满足
 *  (如 桃 需自己已受伤)时同样不可用 —— 这类声明点了会走到死路(主 action 不存在/被拒)。 */
function declaredUsable(ctx: ActionContext, name: string): boolean {
  const effect = getCardEffect(name);
  if (!effect) return true; // 未注册 card-effect(装备等)按可用处理
  if (effect.timing === '生效前') return false;
  return !effect.activeWhen || effect.activeWhen(ctx);
}

/** 基础激活条件(未用次数 + 有手牌),叠加声明牌名自身的可用性 */
function baseActiveWhen(ctx: ActionContext): boolean {
  if (!defaultPlayActive(ctx)) return false;
  const p = ctx.view.players[ctx.perspectiveIdx];
  if (!p) return false;
  if (p.turnUsage?.[TRANSFORM_USED_KEY]) return false; // 本阶段已用过
  return (p.handCount ?? 0) > 0;
}

/** 每个声明牌名一份转化技配置(后端 `transform:<牌名>` action 与前端按钮一一对应):
 *  用户点哪个按钮 = 声明哪张牌,产出牌名由配置固定 → preceding/主 action 与声明天然一致。
 *  (旧实现只有一个无 transform 回调的 'transform' action,浏览器提交缺 outputName、
 *   无头枚举直接跳过 → 该技能在任何真实客户端都不可发动。) */
function transformOptionsOf(outputName: string): TransformActionOptions {
  return {
    outputName,
    actionType: `${TRANSFORM_ACTION_PREFIX}${outputName}`,
    // validate 逐条件独立文案,故全量自定义
    validate: (st, ownerId, params): string | null => {
      if (!inMyPlayPhase(st, ownerId)) return '只能在你的出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (transformUsed(st, ownerId)) return '本阶段渐营转化已用过';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string') return '需要选择一张牌';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      return null;
    },
    beforeExecute: async (st, ownerId, _cardIds) => {
      // 限一次标记:同步设 vars(防 dispatch 重入)+ 回合用量 atom 投影 view(前端禁用按钮)。
      // 必须在第一个 await 之前设置(见制衡.ts 注释);setPlayerVarUsage 内部先写 vars 再 await。
      await setPlayerVarUsage(st, ownerId, TRANSFORM_USED_KEY, true);
    },
    afterExecute: (st, _ownerId, shadowId) => {
      // 若上一张牌有花色,override 影子卡 suit/color 与之一致
      const prevSuit = lastSuit(st);
      if (prevSuit !== '') {
        const shadow = st.cardMap[shadowId];
        if (shadow) {
          shadow.suit = prevSuit as Card['suit'];
          shadow.color = prevSuit === '♥' || prevSuit === '♦' ? '红' : '黑';
        }
      }
    },
    extraRollback: (st, ownerId) => {
      // 撤销限一次标记(transform 失败 → 渐营算作未用)
      delete st.players[ownerId].vars[TRANSFORM_USED_KEY];
    },
    mount: {
      label: `${DISPLAY_NAME}·${outputName}`,
      style: 'primary',
      prompt: {
        type: 'useCard',
        title: `渐营:将一张牌当【${outputName}】使用`,
        description: '出牌阶段限一次;若上一张牌有花色,此牌视为与之同花色',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      activeWhen: (ctx) => baseActiveWhen(ctx) && declaredUsable(ctx, outputName),
    },
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:owner 在"摸一张牌"询问下的回应 ──
  registerConfirmRespond(state, skill.id, ownerId, CONFIRM_RT, CONFIRMED_KEY, {
    mismatchError: '当前不是渐营询问',
  });

  // ── transform:第二段——把一张牌转化为声明的影子基本牌 ──
  // 作为 preceding 在 <outputName>.use 之前执行。<outputName>.validate 看到"基本牌"通过。
  const unregTransforms = [...ALLOWED_NAMES].map((outputName) =>
    registerTransformAction(state, skill.id, ownerId, transformOptionsOf(outputName)),
  );

  // ── 阶段开始(出牌) after-hook:owner 出牌阶段开始 → 重置"上一张牌" ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    resetLast(ctx.state);
  });

  // ── 移动牌 after-hook:owner 出牌阶段内 hand→处理区 = 主动使用/打出 ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const st = ctx.state;
    if (!inMyPlayPhase(st, ownerId)) return;
    const atom = ctx.atom;
    if (atom.from?.zone !== '手牌') return;
    if (atom.from.player !== ownerId) return;
    if (atom.to?.zone !== '处理区') return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    const card = st.cardMap[cardId];
    if (!card) return;

    await checkAndPromptDraw(st, ownerId, card);
  });

  // ── 装备 after-hook:owner 出牌阶段内装备牌 = 使用牌 ──
  registerAfterHook(state, skill.id, ownerId, '装备', async (ctx) => {
    const st = ctx.state;
    if (!inMyPlayPhase(st, ownerId)) return;
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    const card = st.cardMap[cardId];
    if (!card) return;

    await checkAndPromptDraw(st, ownerId, card);
  });

  return () => {
    for (const unreg of unregTransforms) unreg();
  };
}

/**
 * 渐营第一段核心:比较当前牌与"上一张牌",若花色或点数相同则询问是否摸一张;
 * 之后无条件将"上一张牌"更新为当前牌。
 */
async function checkAndPromptDraw(st: GameState, ownerId: number, card: Card): Promise<void> {
  const prevSuit = lastSuit(st);
  const prevRank = lastRank(st);
  const hasPrev = prevSuit !== '' || prevRank !== '';

  const suitMatch = hasPrev && card.suit !== '' && card.suit === prevSuit;
  const rankMatch = hasPrev && card.rank !== '' && card.rank === prevRank;

  // 先更新"上一张牌"——询问与执行摸牌都应不阻塞追踪,且若询问被拒不应影响下一张比较
  setLast(st, card.suit, card.rank);

  if (!suitMatch && !rankMatch) return; // 不匹配 → 不询问

  // 匹配 → 询问是否摸一张
  const confirmed = await askConfirm(st, CONFIRM_RT, ownerId, {
    confirmedKey: CONFIRMED_KEY,
    title: '是否发动渐营?(此牌与上一张花色或点数相同,可摸一张)',
    confirmLabel: '摸一张',
    cancelLabel: '不发动',
    defaultChoice: false,
    timeout: 10,
  });

  if (confirmed) {
    await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
  }
  delete st.localVars[CONFIRMED_KEY];
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 每个声明牌名一个 action(与后端 `transform:<牌名>` 一一对应)。
  // 声明牌名的按钮还需该牌此刻可用:渐营允许声明【闪】(纯回应牌),但闪无主动 use 入口,
  // 「当闪使用」在出牌阶段是死路 → 不渲染该按钮(与无头枚举的跳过判据同源)。
  for (const outputName of ALLOWED_NAMES) {
    mountTransformAction(api, SKILL_ID, transformOptionsOf(outputName));
  }
  defineConfirmAction(api, 'respond', {
    label: DISPLAY_NAME,
    style: 'default',
    title: '是否发动渐营?',
    confirmLabel: '摸一张',
    cancelLabel: '不发动',
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
