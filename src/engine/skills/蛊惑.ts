// src/engine/skills/蛊惑.ts
// 蛊惑(于吉·群·主动技):每回合限一次,你可以将一张手牌扣置,声明为一张基本牌
//   (杀/闪/桃/酒)并使用之。其他角色可依次质疑:
//     - 无人质疑:该牌视为所声明的基本牌生效。
//     - 有人质疑,翻开此牌:
//         · 真(确实是声明的牌):质疑者失去1点体力,该牌按声明使用。
//         · 假(不是声明的牌):质疑者获得此牌,该牌作废。
//
// 规则来源:docs/design/引擎缺失能力.md 第12项 + 标准三国杀(风扩展包·于吉)。
// 注:docs/research/武将技能/群雄/于吉.md 中"假牌→于吉失体力/质疑者摸牌、无次数限制"与
//   标准规则不符,采用标准规则(假牌→质疑者获牌且作废;每回合限一次)。
//
// 实现(多玩家质疑 = 引擎唯一未实现能力,本技能补齐):
//   1. use action(主动):出牌阶段、自己回合、无阻塞 pending、存活、本回合未用过。
//      params: { cardId(扣牌), declaredName(杀/闪/桃/酒), target?(杀的目标) }。
//   2. 扣牌 atom:手牌→弃牌堆(面朝下,身份对他人隐藏),声明公开。记录 localVars['蛊惑/扣牌']/['蛊惑/声明']。
//   3. 质疑循环:从于吉下家起按座次 for 遍历每个其他存活角色 →
//        请求回应('蛊惑/质疑', target=该角色, confirm prompt)。
//        respond(质疑)= 设 localVars['蛊惑/质疑者']; pass/超时 = 不质疑。
//        首个质疑者即触发翻牌,后续不再询问(标准规则:质疑者 singular)。
//   4. 结算分叉:
//        - 无人质疑 → 按声明生效(扣牌已在弃牌堆=已使用)。
//        - 有人质疑 → 展示 atom(翻开,广播真实身份):
//            · 真 → 失去体力(质疑者,1) → 按声明生效。
//            · 假 → 移动牌(扣牌 弃牌堆→质疑者手牌),作废(不生效)。
//
// respond 注册到每个座次(被问询者非于吉),onInit 返回合并卸载函数
//   (unloadSkillInstance 仅按 (skillId,于吉座次) 清 action,清不到其他座次)。
//
// 限制(已决策,非本任务核心):
//   - 主动使用仅支持杀/桃/酒(有主动效果的牌);闪/桃(濒死救援)的"打出"为响应式路径,未实现。
//    validate 允许声明闪,但闪主动使用无效果(仅消耗扣牌)——保留声明入口以覆盖质疑机制。
//   - 蛊惑-杀 成功时不将扣牌移入处理区(处理区会公开 cardId→经 cardMap 暴露真身,破坏隐藏信息)。
//    故杀结算直接走 成为目标→检测有效性→询问闪→伤害,扣牌留在弃牌堆。武器技(贯石斧/青龙)依
//    靠处理区查杀牌的 hook 在此简化路径下不生效;仁王盾对"假牌当杀"的边缘判定亦简化。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, hasBlockingPending } from '../skill';
import { inAttackRange } from '../distance';
import { canSlash, incSlashUsed, slashUsed } from '../slash-quota';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';

const REQUEST_TYPE = '蛊惑/质疑';
const QUESTIONER_VAR = '蛊惑/质疑者';
const DOWNCARD_VAR = '蛊惑/扣牌';
const DECLARE_VAR = '蛊惑/声明';
const BASIC_CARDS = ['杀', '闪', '桃', '酒'] as const;
type DeclaredName = (typeof BASIC_CARDS)[number];

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '蛊惑',
    description: '每回合限一次,扣置一张手牌声明为基本牌(杀/闪/桃/酒)并使用之;其他角色可质疑',
  };
}

/** 蛊惑-杀 成功后的杀结算:成为目标→检测有效性→询问闪→(被抵消/伤害)。
 *  扣牌已在弃牌堆(不进处理区,保隐藏),cardId 仅作 hook 来源标识。 */
async function resolveGuSlash(
  state: GameState,
  source: number,
  target: number,
  cardId: string,
): Promise<void> {
  const damageType = state.cardMap[cardId]?.damageType;
  await pushFrame(state, '蛊惑', source, { cardId, declaredName: '杀', target });
  try {
    const became = await applyAtom(state, { type: '成为目标', source, target, cardId });
    if (!became) return; // 空城等:目标不合法
    const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
    if (!valid) return; // 仁王盾黑杀无效等
    await applyAtom(state, { type: '询问闪', target, source });
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length > 0) {
      await applyAtom(state, { type: '被抵消', source, target, cardId });
      for (const dId of dodgeIds) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: dId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    } else if (state.players[target]?.alive) {
      await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId, damageType });
    }
  } finally {
    // 异常安全:弹帧 + 清理滞留处理区的闪
    for (const id of frameCards(state)) {
      if (state.cardMap[id]?.name === '闪') {
        await applyAtom(state, { type: '移动牌', cardId: id, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      }
    }
    await popFrame(state);
  }
  // 蛊惑-杀 成功计入出杀次数(标准 FAQ:真牌/无人质疑=正常使用)
  incSlashUsed(state);
  await applyAtom(state, { type: '回合用量', player: source, key: '杀/usedCount', value: slashUsed(state) });
}

/** 按声明的牌生效(扣牌已在弃牌堆=已使用)。 */
async function applyDeclaredEffect(
  state: GameState,
  source: number,
  declaredName: string,
  target: number | undefined,
  cardId: string,
): Promise<void> {
  if (declaredName === '杀') {
    if (typeof target !== 'number' || !state.players[target]?.alive) return;
    await resolveGuSlash(state, source, target, cardId);
  } else if (declaredName === '桃') {
    const tgt = typeof target === 'number' ? target : source;
    if (!state.players[tgt]?.alive) return;
    await applyAtom(state, { type: '回复体力', target: tgt, amount: 1, source });
  } else if (declaredName === '酒') {
    await applyAtom(state, {
      type: '加标记',
      player: source,
      mark: { id: '酒/nextKillDamageBonus', scope: -1, payload: 1, duration: 'turn' },
    });
  }
  // 闪:主动使用无效果(仅消耗扣牌),不作废之外的处置。
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use(于吉主动发动)──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, params: Record<string, Json>): string | null => {
        if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
        if (st.phase !== '出牌') return '只能在出牌阶段发动';
        if (hasBlockingPending(st)) return '当前有未完成的询问';
        if (usedThisTurn(st, ownerId, '蛊惑')) return '本回合已使用过蛊惑';
        const self = st.players[ownerId];
        if (!self?.alive) return '玩家不存在或已死亡';
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string' || !self.hand.includes(cardId)) return '请选择一张手牌';
        const declaredName = params.declaredName as string | undefined;
        if (!declaredName || !(BASIC_CARDS as readonly string[]).includes(declaredName)) {
          return '声明牌须为基本牌(杀/闪/桃/酒)';
        }
        if (declaredName === '杀') {
          const target = params.target as number | undefined;
          if (typeof target !== 'number' || !st.players[target]?.alive) return '请选择合法目标';
          if (!inAttackRange(st, ownerId, target)) return '目标不在攻击范围内';
          if (!canSlash(st, ownerId)) return '出杀次数已达上限';
        } else if (declaredName === '桃') {
          const target = (params.target as number | undefined) ?? ownerId;
          const tp = st.players[target];
          if (!tp?.alive) return '目标不存在';
          if (tp.health >= tp.maxHealth) return '桃只能对受伤角色使用';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const cardId = params.cardId as string;
        const declaredName = params.declaredName as DeclaredName;
        const target = params.target as number | undefined;
        // 限一次标记:第一个 await 前设置,防 dispatch 重入
        await markOncePerTurn(st, from, '蛊惑');
        await pushFrame(st, '蛊惑', from, { cardId, declaredName });
        try {
          // ① 扣牌(面朝下,声明公开,真身对他人隐藏)
          await applyAtom(st, { type: '扣牌', player: from, cardId, declaredName });

          // ② 质疑循环:从下家起按座次逐个询问,首个质疑者即翻牌
          const n = st.players.length;
          let questioner: number | undefined = undefined;
          for (let step = 1; step < n; step++) {
            const p = (from + step) % n;
            if (p === from) continue;
            if (!st.players[p]?.alive) continue;
            delete st.localVars[QUESTIONER_VAR];
            await applyAtom(st, {
              type: '请求回应',
              requestType: REQUEST_TYPE,
              target: p,
              prompt: {
                type: 'confirm',
                title: `是否质疑于吉声明为【${declaredName}】的蛊惑?`,
              },
              timeout: 20,
            });
            const q = st.localVars[QUESTIONER_VAR] as number | undefined;
            if (q !== undefined) {
              questioner = q;
              break; // 首个质疑者触发翻牌,后续不再询问
            }
          }

          const downCard = st.localVars[DOWNCARD_VAR] as string;
          if (questioner === undefined) {
            // ③a 无人质疑 → 按声明生效
            await applyDeclaredEffect(st, from, declaredName, target, downCard);
          } else {
            // ③b 有人质疑 → 翻开
            await applyAtom(st, { type: '展示', player: from, cardId: downCard });
            const isReal = st.cardMap[downCard]?.name === declaredName;
            if (isReal) {
              // 真:质疑者失去1点体力,然后按声明使用
              await applyAtom(st, { type: '失去体力', target: questioner, amount: 1 });
              await applyDeclaredEffect(st, from, declaredName, target, downCard);
            } else {
              // 假:质疑者获得此牌,该牌作废(扣牌 弃牌堆→质疑者手牌)
              await applyAtom(st, {
                type: '移动牌',
                cardId: downCard,
                from: { zone: '弃牌堆' },
                to: { zone: '手牌', player: questioner },
              });
            }
          }
        } finally {
          // 清理临时 localVars(扣牌已结算完毕)
          delete st.localVars[DOWNCARD_VAR];
          delete st.localVars[DECLARE_VAR];
          delete st.localVars[QUESTIONER_VAR];
          await popFrame(st);
        }
      },
    ),
  );

  // ── respond(注册到每个座次:被蛊惑问询的角色选择是否质疑)──
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, _params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          const atom = slot.atom as { requestType?: string };
          if (atom.requestType !== REQUEST_TYPE) return '当前不是蛊惑质疑窗口';
          if (!st.players[seat]?.alive) return '你已死亡';
          return null;
        },
        async (st: GameState, _params: Record<string, Json>) => {
          st.localVars[QUESTIONER_VAR] = seat;
        },
      ),
    );
  }

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '蛊惑',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '蛊惑:扣置一张手牌,声明为基本牌(杀/闪/桃/酒)并使用',
      cardFilter: { min: 1, max: 1 },
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn('蛊惑')(ctx),
  });
  // respond:被蛊惑问询的角色选择是否质疑。前端按 pending prompt 渲染。
  api.defineAction('respond', {
    label: '质疑',
    style: 'danger',
    prompt: { type: 'confirm', title: '是否质疑于吉的蛊惑?' },
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
