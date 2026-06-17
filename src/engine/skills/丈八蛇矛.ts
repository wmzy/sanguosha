// src/engine/skills/丈八蛇矛.ts
// 丈八蛇矛(武器,攻击范围 3):你可以将 2 张手牌当【杀】使用或打出(转化技)。
//
// 模型(组合 action,与武圣同形):前端两步 UI(点丈八蛇矛给手牌加"杀"显示
// → 点出杀选目标),提交时一个 ClientMessage:preceding=[丈八蛇矛.transform]
// + 主 action=杀.use。
// 后端 dispatch 先执行 丈八蛇矛.transform(用两张手牌创建一张影子杀),
// 再 杀.use validate 看到"杀"通过。杀技能零感知丈八蛇矛——
// 它看到的永远是 cardMap 里的一张"杀"。
//
// 与武圣的关键差异:武圣是 1 张原卡 → 1 张 shadow(原卡仍在 cardMap,
// shadowOf 指向原卡,影子离开结算区时引擎按 shadowOf 还原)。丈八蛇矛是
// 2 张原卡 → 1 张 shadow(原卡从 cardMap **移除**,从手牌移除;
// shadowOf 置空,因为不存在一一对应的"原卡")。因此 rollback 路径
// 必须在 execute 前后保留原卡 id,自己完成"删影子/还原卡"配对,引擎
// shadowOf 还原机制不适用。
import type { Card, GameState, Json, Skill } from '../types';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '丈八蛇矛',
    description: '可将两张手牌当杀使用',
  };
}

/** 影子卡 id:${id1}#${id2}#丈八蛇矛 —— 拼接两张原卡 id 避免与单卡 shadow 冲突 */
function shadowIdOf(id1: string, id2: string): string {
  return `${id1}#${id2}#丈八蛇矛`;
}

/** localVars 键:供 rollback 找回本次合并的两张原卡 id */
const LOCAL_VARS_KEY = '丈八蛇矛/原卡';

export function onInit(skill: Skill, ownerId: number): () => void {
  // transform action:把 2 张手牌转化为影子"杀"(新建 Card 实体,shadowOf 留空)。
  // 作为 preceding 在 杀.use 之前执行。杀.validate 读 cardMap[影子id] 看到"杀"。
  registerAction(
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardIds = params.cardIds;
      if (!Array.isArray(cardIds) || cardIds.length !== 2) return '需要选择 2 张手牌';
      const [id1, id2] = cardIds as string[];
      if (typeof id1 !== 'string' || typeof id2 !== 'string') return 'cardIds 必须为字符串';
      if (id1 === id2) return '不能选择同一张牌';
      const cardInHand = !!self && self.hand.includes(id1) && self.hand.includes(id2);
      const c1 = state.cardMap[id1];
      const c2 = state.cardMap[id2];
      const cardsExist = !!c1 && !!c2;
      // 武器校核:必须装备丈八蛇矛(动态检查,允许同帧内换下后不再触发)
      const weaponId = self?.equipment?.['武器'];
      const weaponCard = weaponId ? state.cardMap[weaponId] : undefined;
      const hasZhangba = weaponCard?.name === '丈八蛇矛';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardsExist && hasZhangba;
      return ok ? null : '丈八蛇矛转化条件不满足';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const [id1, id2] = params.cardIds as string[];
      const c1 = state.cardMap[id1];
      const sId = shadowIdOf(id1, id2);
      // 新建影子卡:name='杀',suit/rank 取第一张原卡;shadowOf 留空(2 张合一,无单一原卡)
      const shadow: Card = {
        id: sId,
        name: '杀',
        suit: c1.suit,
        rank: c1.rank,
        type: '基本牌',
      };
      state.cardMap[sId] = shadow;
      // 手牌:移除两张原卡,影子卡追加到末尾。validate 阶段已确认两张牌在手中,
      // 此处用 filter+push(2 合一位置不固定,validate/UI 都不依赖手牌顺序)。
      const self = state.players[ownerId];
      self.hand = self.hand.filter(c => c !== id1 && c !== id2);
      self.hand.push(sId);
      // 记录原卡 id,供 rollback 恢复
      state.localVars[LOCAL_VARS_KEY] = [id1, id2];
    },
    // rollback:主 action validate 失败时,撤销转化(删影子 + 还原卡 + 清 localVars)
    (state: GameState, params: Record<string, Json>) => {
      const cardIds = params.cardIds;
      const [id1, id2] = Array.isArray(cardIds) ? (cardIds as string[]) : [];
      const sId = id1 && id2 ? shadowIdOf(id1, id2) : undefined;
      if (sId) {
        delete state.cardMap[sId];
        const self = state.players[ownerId];
        const idx = self.hand.indexOf(sId);
        if (idx >= 0) self.hand.splice(idx, 1);
        // 把两张原卡按 localVars 记录的顺序放回手牌;若 localVars 缺失(异常路径),
        // 退化为直接 push(避免卡牌丢失)。
        const stored = state.localVars[LOCAL_VARS_KEY] as string[] | undefined;
        if (stored && stored.length === 2) {
          self.hand.push(stored[0], stored[1]);
        } else if (id1 && id2) {
          self.hand.push(id1, id2);
        }
      }
      delete state.localVars[LOCAL_VARS_KEY];
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: { defineAction: Function }): void {
  // 前端:丈八蛇矛是转化技,defineAction 声明可选两张手牌。
  // 前端 UI 流程:点丈八蛇矛 → 选 2 张手牌(加"杀"显示) → 点杀选目标
  //   → 提交 preceding+主 action。
  api.defineAction('transform', {
    label: '丈八蛇矛',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择 2 张手牌当杀使用',
      cardFilter: { filter: () => true, min: 2, max: 2 },
    },
  });
  return;
}

