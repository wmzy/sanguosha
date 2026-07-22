// 界矫诏(界郭皇后·转化技,OL 界限突破官方逐字):
//   出牌阶段限一次,你可将一张牌当本轮未有角色使用过的基本或普通锦囊牌使用。
//
// 界限突破(相对标矫诏 郭皇后):
//   1. 标矫诏:展示一张手牌,令距离最近的角色声明一种基本牌,本回合展示牌当声明牌使用
//      (被动声明、限基本牌、限最近角色、不能对自己使用)。
//   2. 界矫诏:玩家自主声明一种"本轮未有角色使用过的"基本或普通锦囊牌,转化后使用
//      (主动声明、含普通锦囊、范围放宽为本轮未使用)。
//
// 实现要点(模型同武圣——preceding 转化 + 主 use):
//   - transform action: 入参 cardId(原牌)+ outputName(目标牌名)
//   - validate: 自己回合 + 出牌阶段 + 无 pending + 限一次/回合 + outputName 合法 +
//     outputName 不在本轮已用牌名集合 + 原牌在手牌
//   - execute: 当作 atom 创建影子卡(shadowId=${cardId}#界矫诏),手牌中 id 替换为影子 id
//   - rollback: 主 action validate 失败时撤销转化(删影子,手牌还原)
//   - 限一次: player.vars['界矫诏/usedThisTurn'](后缀 /usedThisTurn 由「回合结束」atom 自动清空)
//   - 本轮已用牌名: state.localVars['界矫诏/已用牌名'](string[],本轮范围)
//     配合 state.localVars['界矫诏/lastRound'] 记录上次重置轮次,新轮重置为空数组
//   - 已用牌名追踪: 注册「结算帧入栈」after hook——任何玩家 push 任何 frame(skillId 为
//     基本牌/普通锦囊牌名)时,自动追加到已用牌名集合(Set 语义,防重复)
//
// 命名: 文件名/loader key/character skill name 均为 '界矫诏'(避开标矫诏冲突);
//   内部 Skill.name = '矫诏'(OL 官方技能名,玩家可见)。
//
// 待澄清: 文档未说明"修改矫诏"(殚心)对矫诏的具体效果,故本实现按文档逐字:
//   矫诏效果恒为基础版本,殚心仅做计数(见 界殚心.ts)。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import {
  registerAction,
  registerAfterHook,
  hasBlockingPending,
  type SkillModule,
} from '../skill';
import { defaultPlayActive } from '../action-active';

const SKILL_ID = '界矫诏';
const DISPLAY_NAME = '矫诏';

/** 本回合是否已用过矫诏(限一次)。后缀 /usedThisTurn 由「回合结束」atom 自动清空。 */
const USED_KEY = `${SKILL_ID}/usedThisTurn`;
/** 本轮已使用的牌名集合(string[])。 */
const USED_NAMES_KEY = `${SKILL_ID}/已用牌名`;
/** 上次重置已用牌名的轮次(number)。 */
const LAST_ROUND_KEY = `${SKILL_ID}/lastRound`;

/**
 * 矫诏可声明的目标牌名(基本牌 + 普通锦囊)。
 * 排除: 延时锦囊(乐不思蜀/兵粮寸断/闪电)、响应锦囊(无懈可击)、装备牌。
 */
const ALLOWED_NAMES: ReadonlySet<string> = new Set([
  // 基本牌
  '杀',
  '闪',
  '桃',
  '酒',
  // 普通锦囊
  '决斗',
  '过河拆桥',
  '顺手牵羊',
  '无中生有',
  '借刀杀人',
  '桃园结义',
  '五谷丰登',
  '南蛮入侵',
  '万箭齐发',
  '火攻',
  '铁索连环',
]);

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '出牌阶段限一次,你可将一张牌当本轮未有角色使用过的基本或普通锦囊牌使用',
  };
}

/** 影子卡 id: ${原id}#界矫诏 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#${SKILL_ID}`;
}

/** 本轮已用牌名集合(读取时自动按 round 重置)。 */
function readUsedNames(state: GameState): string[] {
  const currentRound = state.turn.round;
  const lastRound = state.localVars[LAST_ROUND_KEY];
  if (lastRound !== currentRound) {
    state.localVars[LAST_ROUND_KEY] = currentRound;
    state.localVars[USED_NAMES_KEY] = [];
    return [];
  }
  const v = state.localVars[USED_NAMES_KEY];
  return Array.isArray(v) ? (v as string[]) : [];
}

/** 标记一个牌名为本轮已用(Set 语义,防重复)。 */
function markUsedName(state: GameState, name: string): void {
  if (!ALLOWED_NAMES.has(name)) return;
  const list = readUsedNames(state);
  if (!list.includes(name)) {
    state.localVars[USED_NAMES_KEY] = [...list, name];
  }
}

/** 本回合是否已用过矫诏。 */
function usedThisTurn(state: GameState, ownerId: number): boolean {
  return !!state.players[ownerId]?.vars[USED_KEY];
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── transform action: 把手牌转化为影子"声明的牌"(新建 Card 实体,shadowOf 指向原卡)。
  //    作为 preceding 在 <outputName>.use 之前执行。<outputName>.validate 读 cardMap[影子id] 通过。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId)) return '本回合已使用过矫诏';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';

      const cardId = params.cardId as string | undefined;
      const outputName = params.outputName as string | undefined;
      if (typeof cardId !== 'string') return '需要选择一张牌';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      if (typeof outputName !== 'string' || !ALLOWED_NAMES.has(outputName)) {
        return '声明的牌名不合法(须为基本或普通锦囊牌)';
      }
      const used = readUsedNames(st);
      if (used.includes(outputName)) return `本轮已有角色使用过【${outputName}】`;
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const cardId = params.cardId as string;
      const outputName = params.outputName as string;
      const shadowId = shadowIdOf(cardId);

      // 限一次标记:同步设 vars(防 dispatch 重入)+ 回合用量 atom 投影 view(前端禁用按钮)。
      // 必须在第一个 await 之前设置(见制衡.ts 注释)。
      st.players[ownerId].vars[USED_KEY] = true;
      await applyAtom(st, { type: '回合用量', player: ownerId, key: USED_KEY, value: true });

      // 创建影子卡(原卡仍在 cardMap,shadowOf 指向原卡;原卡花色/颜色继承)
      await applyAtom(st, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName,
      });
    },
    // rollback: 主 action validate 失败时撤销转化(删影子,手牌还原 + 清限一次标记)
    (st: GameState, params: Record<string, Json>): void => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete st.cardMap[sId];
      const self = st.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
      // 撤销限一次标记(transform 失败 → 矫诏算作未用)
      delete self.vars[USED_KEY];
    },
  );

  // ── 「结算帧入栈」after hook: 任何玩家 push 任何 frame(skillId 为基本/普通锦囊)时
  //    自动追加到本轮已用牌名集合。同一 frame 多次触发(Set 语义)不会重复。
  registerAfterHook(state, skill.id, ownerId, '结算帧入栈', async (ctx) => {
    const atom = ctx.atom;
    const name = atom.skillId;
    if (typeof name !== 'string') return;
    if (!ALLOWED_NAMES.has(name)) return;
    markUsedName(ctx.state, name);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('transform', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '选择一张牌,声明一种本轮未使用过的基本或普通锦囊牌',
      description: '出牌阶段限一次;转化后按声明的牌正常结算',
      cardFilter: { min: 1, max: 1 },
      // outputName 由前端通过额外 UI(声明面板)选择;此处不限定具体牌名
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      if (p.turnUsage?.[USED_KEY]) return false; // 本回合已用过
      return (p.handCount ?? 0) > 0;
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
