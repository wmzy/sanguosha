// 界荐言(界徐庶·蜀·主动技,OL 界限突破 hero/304 官方逐字):
//   出牌阶段限一次，你可以声明一种牌的类别或颜色，然后连续亮出牌堆顶的牌，
//   直到亮出符合你声明的牌为止，选择一名男性角色，该角色获得此牌，
//   再将其余以此法亮出的牌置入弃牌堆。
//
// 触发时机:出牌阶段(主动技) | 限制:每回合限一次
// 流程:
//   1. use action(出牌阶段限一次)
//   2. 询问声明(请求回应 requestType='界荐言/declare'):
//      选项 = 基本牌 / 锦囊牌 / 装备牌 / 红 / 黑(由 params.declaration 提供)
//   3. 询问目标(请求回应 requestType='界荐言/target',prompt=choosePlayer,男性过滤)
//   4. 从牌堆顶连续翻牌到处理区,直到出现符合声明的牌:
//      - 类别声明 → card.type === declaration
//      - 颜色声明 → card.color === declaration
//   5. 第一张匹配的牌移到目标手牌,其余已翻开的牌入弃牌堆
//   6. 若翻完整堆无匹配(罕见),所有翻开的入弃牌堆,不再处理(荐言失效)
//
// 关键点:
//   - 牌堆顶 = deck[len-1](与 摸牌 atom 一致,见 观星.ts 注释)
//   - 用 移动牌 atom 翻牌(牌堆→处理区),产生 ViewEvent,前端可见
//   - "选择一名男性角色"用 getGender 判定
//   - 限一次/回合:player.vars['界荐言/usedThisTurn'](/usedThisTurn 后缀由「回合结束」自动清空)
//
// 命名:文件名/loader key/character skill name 均为 '界荐言';
//   内部 Skill.name = '荐言'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill, Card } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { getGender } from '../character-meta';
import { defaultPlayActive } from '../action-active';
import type { GameView } from '../types';

const SKILL_ID = '界荐言';
const DISPLAY_NAME = '荐言';
const USED_KEY = `${SKILL_ID}/usedThisTurn`;
/** 询问 RT:声明 */
const DECLARE_RT = `${SKILL_ID}/declare`;
/** 询问 RT:选目标 */
const TARGET_RT = `${SKILL_ID}/target`;
/** localVars key:玩家声明 */
const DECLARATION_KEY = `${SKILL_ID}/declaration`;
/** localVars key:玩家选目标 */
const TARGET_KEY = `${SKILL_ID}/target`;

const VALID_DECLARATIONS = ['基本牌', '锦囊牌', '装备牌', '红', '黑'] as const;
type Declaration = (typeof VALID_DECLARATIONS)[number];

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次:声明一种牌的类别或颜色,连续亮出牌堆顶的牌直到亮出符合声明的牌,选择一名男性角色获得此牌,其余置入弃牌堆',
  };
}

/** 是否为合法声明 */
function isValidDeclaration(d: unknown): d is Declaration {
  return typeof d === 'string' && (VALID_DECLARATIONS as readonly string[]).includes(d);
}

/** 牌是否符合声明 */
function cardMatches(card: Card, declaration: Declaration): boolean {
  if (declaration === '基本牌' || declaration === '锦囊牌' || declaration === '装备牌') {
    return card.type === declaration;
  }
  // 颜色声明:红 / 黑(card.color 为 Color='红'|'黑'|'无色',与 declaration 字面量比较)
  return card.color === (declaration as '红' | '黑');
}

/** 校验某座次是否为男性存活角色 */
function isMaleAlive(state: GameState, target: number): boolean {
  const p = state.players[target];
  if (!p?.alive) return false;
  return getGender(p.character) === '男';
}

/** 本回合是否已用过荐言 */
function usedThisTurn(state: GameState, ownerId: number): boolean {
  return !!state.players[ownerId]?.vars[USED_KEY];
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理 declare + target 两种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== DECLARE_RT && rt !== TARGET_RT) return '当前不是荐言询问';
      if (rt === DECLARE_RT) {
        if (!isValidDeclaration(params.declaration)) {
          return '声明不合法(基本牌/锦囊牌/装备牌/红/黑)';
        }
      } else if (rt === TARGET_RT) {
        const t = params.target ?? (Array.isArray(params.targets) ? params.targets[0] : undefined);
        if (typeof t !== 'number') return '需要选择目标';
        if (!isMaleAlive(st, t)) return '目标必须是男性角色';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === DECLARE_RT) {
        if (isValidDeclaration(params.declaration)) {
          st.localVars[DECLARATION_KEY] = params.declaration;
        }
      } else if (rt === TARGET_RT) {
        const t = params.target ?? (Array.isArray(params.targets) ? params.targets[0] : undefined);
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
      }
    },
  );

  // ── use:主动发动荐言 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const self = st.players[ownerId];
      if (!self?.alive) return '角色不可用';
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId)) return '本回合已使用过荐言';
      // 必须有男性其他角色(包括自己)可选——至少自己若是男性也可,但通常选他人。
      // 实际目标在后续询问确定,此处仅校验是否有候选。
      const hasCandidate = st.players.some(
        (p, i) => i !== ownerId && isMaleAlive(st, i),
      );
      if (!hasCandidate) return '无男性角色可选';
      if (st.zones.deck.length === 0 && st.zones.discardPile.length === 0) return '牌堆已空';
      return null;
    },
    async (st: GameState, _params: Record<string, Json>) => {
      const from = ownerId;

      // 标记本回合已用(同步设 vars,防 dispatch 重入)
      st.players[from].vars[USED_KEY] = true;
      await applyAtom(st, {
        type: '回合用量',
        player: from,
        key: USED_KEY,
        value: true,
      });

      await pushFrame(st, SKILL_ID, from, {});

      try {
        // 1. 询问声明
        delete st.localVars[DECLARATION_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: DECLARE_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title: '荐言:声明一种牌的类别(基本牌/锦囊牌/装备牌)或颜色(红/黑)',
            description:
              '选择类别:基本牌、锦囊牌、装备牌;或颜色:红、黑。连续亮出牌堆顶直到出现符合声明的牌。',
          },
          defaultChoice: '基本牌',
          timeout: 30,
        });
        const rawDeclaration = st.localVars[DECLARATION_KEY];
        const declaration: Declaration = isValidDeclaration(rawDeclaration)
          ? rawDeclaration
          : '基本牌'; // 超时/非法 → 默认基本牌(不放弃使用机会)
        delete st.localVars[DECLARATION_KEY];

        // 2. 询问目标(男性角色)
        delete st.localVars[TARGET_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: TARGET_RT,
          target: ownerId,
          prompt: {
            type: 'choosePlayer',
            title: '荐言:选择一名男性角色获得匹配的牌',
            min: 1,
            max: 1,
            filter: (_view: GameView, t: number) =>
              t !== ownerId && isMaleAlive(st, t),
          },
          timeout: 20,
        });
        const target = st.localVars[TARGET_KEY] as number | undefined;
        delete st.localVars[TARGET_KEY];
        if (typeof target !== 'number' || !isMaleAlive(st, target)) {
          // 无有效目标:荐言失效(已限一次,不再触发)
          return;
        }

        // 3. 连续翻牌直到匹配
        const revealed: string[] = [];
        let matchId: string | undefined;
        while (st.zones.deck.length > 0) {
          const topId = st.zones.deck[st.zones.deck.length - 1];
          // 翻到处理区(产生 ViewEvent)
          await applyAtom(st, {
            type: '移动牌',
            cardId: topId,
            from: { zone: '牌堆' },
            to: { zone: '处理区' },
          });
          revealed.push(topId);
          const card = st.cardMap[topId];
          if (card && cardMatches(card, declaration)) {
            matchId = topId;
            break;
          }
        }

        // 4. 结算:匹配牌给目标,其余入弃牌堆
        if (matchId) {
          // 匹配牌 → 目标手牌
          await applyAtom(st, {
            type: '移动牌',
            cardId: matchId,
            from: { zone: '处理区' },
            to: { zone: '手牌', player: target },
          });
        }
        // 其余已翻开的牌 → 弃牌堆
        const leftover = frameCards(st).filter((id) => revealed.includes(id));
        for (const id of leftover) {
          await applyAtom(st, {
            type: '移动牌',
            cardId: id,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
      } finally {
        await popFrame(st);
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    activeWhen: (ctx) => {
      // 出牌阶段 + 自己回合 + 无阻塞 pending + 本回合未用过荐言
      if (!defaultPlayActive(ctx)) return false;
      return !ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[USED_KEY];
    },
    prompt: {
      type: 'confirm',
      title: '是否发动荐言?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
