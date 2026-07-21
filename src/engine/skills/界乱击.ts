// 界乱击(界袁绍·群·转化技,OL 界限突破官方逐字):
//   你可以将两张花色相同的手牌当【万箭齐发】使用。你使用【万箭齐发】可以少选一个目标。
//
// 与标版乱击( src/engine/skills/乱击.ts )区别:
//   - 转化部分(两张同花色手牌 → 万箭齐发):与标版完全一致。
//   - 新增:"你使用【万箭齐发】可以少选一个目标"——界袁绍座次使用任何来源的
//     【万箭齐发】(界乱击转化或实际万箭齐发牌)时,均可选择至多 1 名目标排除。
//     为角色锁定属性,故必须独立界版文件,镜像 界火计/界连环 的覆盖模式。
//
// 模型(组合 action + 覆盖):
//   ① transform action(preceding,界乱击.transform):两张同花色手牌 → 影子"万箭齐发"。
//      前端组合:preceding=[界乱击.transform cardIds=[id1,id2]] + 主 action=万箭齐发.use
//      (cardId = `${id1}#${id2}#界乱击`,影子卡)。
//   ② use action(覆盖万箭齐发.use,仅本座次):界版万箭齐发结算,主流程开始前
//      插入"少选一个目标"询问(selectTarget min:0,max:1)。覆盖保证:
//      - 界袁绍以任何来源的【万箭齐发】均走界版结算。
//      - 其他座次的万箭齐发仍走标版(由标版万箭齐发 card skill 注册)。
//
// 覆盖机制:万箭齐发在 DEFAULT_SKILLS 中先实例化标版万箭齐发.use;界乱击.onInit 后实例化,
//   registerAction('万箭齐发', ownerId, 'use', ...) 覆盖标版注册(state-bound 注册表 Map.set 覆盖)。
//   "你使用【万箭齐发】可以少选一个目标" 为角色锁定属性,凡本座次使用万箭齐发均走界版,
//   符合官方语义。镜像 界火计.ts / 界连环.ts 的覆盖模式。
//
// "少选一个目标"语义(OL 官方 FAQ):
//   - 默认目标:除使用者外所有存活角色(标版万箭齐发自动选定)。
//   - 界版允许使用者从中至多排除 1 名(可选 0 或 1 名)。
//   - 排除后剩余目标可为 0(此时万箭齐发无目标但仍按锦囊正常进处理区→弃牌堆,
//     走完无懈可询问流程)。
//
// 原牌归宿(与标版一致):2 张原卡从手牌移除、合并成影子卡;影子卡离开结算区进弃牌堆时,
//   因 shadowOf 为空(多卡转化无一一对应原卡),引擎不自动还原——原卡停留在
//   cardMap 但已不在任何手牌区(与丈八蛇矛一致)。rollback 路径自行完成删影子/还原配对。
//   乱击出的万箭齐发可被无懈可击抵消——由 万箭齐发.use 自身的 询问无懈可击 流程保证。
//
// 命名:文件名/loader key/character skill name 均为 '界乱击'(避开标乱击冲突);
//   内部 Skill.name = '乱击'(OL 官方技能名,玩家可见)。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, hasBlockingPending } from '../skill';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { 询问无懈可击 } from '../无懈可击';
import { defaultPlayActive } from '../action-active';

const SKILL_ID = '界乱击';
const DISPLAY_NAME = '乱击';
/** "少选一个目标"请求回应的 requestType(路由到本技能 respond) */
const SKIP_TARGET_RT = `${SKILL_ID}/skipTarget`;
/** localVars key:玩家选择的排除目标座次(number | undefined | null) */
const SKIP_TARGET_KEY = `${SKILL_ID}/skipTargetChoice`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '你可以将两张花色相同的手牌当【万箭齐发】使用;你使用【万箭齐发】可以少选一个目标',
  };
}

/** 影子卡 id:${id1}#${id2}#界乱击 —— 拼接两张原卡 id,'界乱击' 后缀避免与标版冲突 */
function shadowIdOf(id1: string, id2: string): string {
  return `${id1}#${id2}#界乱击`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── transform action:两张同花色手牌 → 影子"万箭齐发"(作为 preceding) ───
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending + 存活
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardIds = params.cardIds;
      if (!Array.isArray(cardIds) || cardIds.length !== 2) return '需要选择 2 张手牌';
      const [id1, id2] = cardIds as string[];
      if (typeof id1 !== 'string' || typeof id2 !== 'string') return 'cardIds 必须为字符串';
      if (id1 === id2) return '不能选择同一张牌';
      const cardInHand = !!self && self.hand.includes(id1) && self.hand.includes(id2);
      const c1 = state.cardMap[id1];
      const c2 = state.cardMap[id2];
      const cardsExist = !!c1 && !!c2;
      // 乱击核心条件:两张牌花色相同(同花色,suit 严格相等)
      const sameSuit = !!c1 && !!c2 && c1.suit !== '' && c1.suit === c2.suit;
      const ok =
        myTurn && inActPhase && free && selfAlive && cardInHand && cardsExist && sameSuit;
      return ok ? null : '界乱击需要两张同花色的手牌';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardIds = params.cardIds as string[];
      const [id1, id2] = cardIds;
      const shadowId = shadowIdOf(id1, id2);
      // 通过「当作」atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds,
        shadowId,
        outputName: '万箭齐发',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子 + 还原两张原卡到手牌)
    (state: GameState, params: Record<string, Json>) => {
      const cardIds = params.cardIds;
      const [id1, id2] = Array.isArray(cardIds) ? (cardIds as string[]) : [];
      const sId = id1 && id2 ? shadowIdOf(id1, id2) : undefined;
      if (sId) {
        delete state.cardMap[sId];
        const self = state.players[ownerId];
        const idx = self.hand.indexOf(sId);
        if (idx >= 0) self.hand.splice(idx, 1);
        self.hand.push(id1, id2);
      }
    },
  );

  // ─── use action:覆盖标版万箭齐发.use,本座次走界版结算(可少选 1 目标) ───
  // 万箭齐发在 DEFAULT_SKILLS 中先实例化标版;此处 registerAction 覆盖之(同 key 覆盖)。
  // 仅影响本座次(界袁绍),其他座次的万箭齐发仍走标版。
  registerAction(
    state,
    '万箭齐发',
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      // 校验同标版万箭齐发.use:自己回合 + 出牌阶段 + 无阻塞 pending + 存活 +
      // 手牌中存在万箭齐发(含影子卡)。万箭齐发本无目标参数(targets 由本流程自动计算)。
      if (state.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (state.phase !== '出牌') return '不是出牌阶段';
      if (hasBlockingPending(state)) return '当前有等待响应';
      const self = state.players[ownerId];
      if (!self?.alive) return '你已死亡';
      const cardId = params.cardId as string;
      if (typeof cardId !== 'string') return 'cardId required';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      if (state.cardMap[cardId]?.name !== '万箭齐发') return '不是万箭齐发';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      await pushFrame(state, '界乱击', from, { ...params });

      // 计算默认目标:除使用者外所有存活角色,按座次从 from+1 顺时针
      const alivePlayers = state.players.filter((p) => p.alive);
      const n = alivePlayers.length;
      const defaultTargets: number[] = [];
      if (n > 1) {
        const fromPos = alivePlayers.findIndex((p) => p.index === from);
        if (fromPos >= 0) {
          for (let i = 1; i < n; i++) {
            defaultTargets.push(alivePlayers[(fromPos + i) % n].index);
          }
        }
      }

      // ── "少选一个目标"询问(界版核心):从默认目标中可选排除至多 1 名 ──
      // 仅当默认目标 ≥ 1 时才有意义询问(0 个目标时万箭齐发无效果,但仍走流程)
      let targets = defaultTargets;
      if (defaultTargets.length >= 1) {
        delete state.localVars[SKIP_TARGET_KEY];
        await applyAtom(state, {
          type: '请求回应',
          requestType: SKIP_TARGET_RT,
          target: from,
          prompt: {
            type: 'selectTarget',
            title: '界乱击:可少选一个目标(选 0 或 1 名排除)',
            description: '可放弃(不排除任何目标)',
            targetFilter: {
              min: 0,
              max: 1,
              filter: (_view, t) => defaultTargets.includes(t),
            },
          },
          timeout: 20,
        });
        const skipTarget = state.localVars[SKIP_TARGET_KEY];
        delete state.localVars[SKIP_TARGET_KEY];
        if (typeof skipTarget === 'number') {
          targets = defaultTargets.filter((t) => t !== skipTarget);
        }
      }

      // 锦囊进处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });

      // 逐个询问无懈 + 闪 + 伤害(镜像标版万箭齐发.use)
      try {
        for (const target of targets) {
          if (!state.players[target]?.alive) continue;
          const cancelled = await 询问无懈可击(state, target);
          if (cancelled) continue;

          await applyAtom(state, { type: '询问闪', target, source: from });
          // 检查处理区
          const dodgeCardId = frameCards(state).find((id) => {
            const c = state.cardMap[id];
            return c?.name === '闪';
          });
          if (dodgeCardId) {
            await applyAtom(state, { type: '被抵消', source: from, target, cardId });
            await applyAtom(state, {
              type: '移动牌',
              cardId: dodgeCardId,
              from: { zone: '处理区' },
              to: { zone: '弃牌堆' },
            });
          } else {
            if (!state.players[target]?.alive) continue;
            await applyAtom(state, {
              type: '造成伤害',
              target,
              amount: 1,
              source: from,
              cardId,
            });
          }
        }
        // 锦囊移出处理区→弃牌堆
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        if (frameCards(state).includes(cardId)) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
        await popFrame(state);
      }
    },
  );

  // ─── respond action:处理"少选一个目标"询问 ──────────────
  // requestType='界乱击/skipTarget' 路由到本技能。
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是界乱击询问';
      if (atom.requestType !== SKIP_TARGET_RT) return '当前不是界乱击询问';
      // params.target:未选(undefined/null)=不排除;选了 = 座次号
      const target = params.target;
      if (target === undefined || target === null) return null;
      if (typeof target !== 'number') return 'target 必须为数字';
      if (!state.players[target]?.alive) return '目标不存在或已死亡';
      // target 必须在候选目标中(由 prompt.targetFilter 限制,后端兜底)
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const target = params.target;
      state.localVars[SKIP_TARGET_KEY] =
        typeof target === 'number' ? target : null;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  // 前端:界乱击是多卡转化技(同标版乱击)。transform 把选中两张同花色手牌包装成 CardWrapper。
  // 前端通过 prompt.cardFilter.min/max (2..2) 识别多卡选牌,进入多选转化模式,
  // 提交 preceding params.cardIds=[id1,id2]。主 action skillId 由 transform.name='万箭齐发' 决定,
  // 后端万箭齐发.use 已被本座次界版覆盖(增加"少选一个目标"询问)。
  api.defineAction('transform', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: '选择 2 张同花色的手牌当万箭齐发使用(界版:可少选一个目标)',
      cardFilter: { filter: () => true, min: 2, max: 2 },
    },
    transform: (card: Card) => ({
      name: '万箭齐发',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.hand) return false;
      // 至少存在两张同花色手牌才可发动
      const suitCount: Record<string, number> = {};
      for (const c of p.hand) {
        if (!c.suit) continue;
        suitCount[c.suit] = (suitCount[c.suit] ?? 0) + 1;
        if (suitCount[c.suit] >= 2) return true;
      }
      return false;
    },
  });
  // respond action:"少选一个目标" selectTarget 询问
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '界乱击:少选一个目标(可选)',
      targetFilter: { min: 0, max: 1 },
    },
  });
  return;
}

const _skillModule: import('../skill').SkillModule = {
  createSkill,
  onInit,
  onMount,
};
export default _skillModule;
