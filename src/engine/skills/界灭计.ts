// 界灭计(界李儒·群·主动技,OL 界限突破官方逐字):
//   "出牌阶段限一次,你可以将一张锦囊牌置于牌堆顶并令一名有手牌的其他角色选择一项:
//    1.弃置一张锦囊牌;2.依次弃置两张牌。"
//
// 界限突破(相对标灭计 —— 标版未实现,见 docs/research/武将技能/群雄/李儒.md):
//   1. 标灭计:置顶"黑色锦囊";选项 2 为"弃两张非锦囊"。
//   2. 界灭计:置顶"任意锦囊";选项 2 为"弃两张任意牌"(无非锦囊限制)。
//
// 流程(主动技,出牌阶段限一次):
//   1. use:出牌阶段、自己回合、无阻塞 pending、存活、未用过、手中至少 1 张锦囊、
//      选一名有手牌的其他角色。限一次标记。
//   2. 将所选锦囊牌置于牌堆顶(移动牌 to zone='牌堆';deck 末尾=牌堆顶,因摸牌从末尾抽)。
//   3. 令目标选一项:
//      - 若目标同时有锦囊且有 ≥2 手牌 → confirm 二选一
//      - 若只有锦囊(无 ≥2 手牌)→ 强制选 1(弃一张锦囊)
//      - 若只有 ≥2 手牌(无锦囊)→ 强制选 2(依次弃两张)
//      - 两者皆无(手牌只有 1 张非锦囊)→ 描述未规定,按"无法选择则无效果"处理(置顶已收)
//   4. 选 1:请求目标弃一张锦囊牌(useCard,filter type=锦囊牌)→ 弃置此牌
//      选 2:依次请求目标弃两张牌(每次 useCard,filter 任意牌)→ 弃置
//
// 关键点:
//   - 置顶不展示:锦囊牌从手牌直接 → 牌堆顶(攻心同款语义:移动牌 to zone='牌堆')。
//   - 目标选项合法性由后端 execute 计算;前端只在 confirm 时给两选项,实际是否可选由后端兜底。
//   - respond action 注册到每个座次(目标可为任意其他玩家)。
//   - 限一次:界灭计/usedThisTurn(once-per-turn 工具,回合结束自动清空)。
//
// 命名:文件名/loader key/character skill name 均为 '界灭计';内部 Skill.name = '灭计'。
import type {
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

const SKILL_ID = '界灭计';
const DISPLAY_NAME = '灭计';

const CHOOSE_RT = '界灭计/选效果';
const CHOICE_KEY = '界灭计/effect';
const PICK_TRICK_RT = '界灭计/弃锦囊';
const PICK_ONE_RT = '界灭计/弃一张';
const CARD_KEY = '界灭计/cardId';

/** 是否为(可置顶的)锦囊牌:延时/响应锦囊不可置顶(只在手牌中作为锦囊牌判定)。
 *  按 OL 灭计惯例,普通锦囊/延时锦囊均算"锦囊牌";响应锦囊(无懈)不算。 */
function isTrickCard(card: Card | undefined): boolean {
  return !!card && card.type === '锦囊牌' && card.trickSubtype !== '响应锦囊';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次:将一张锦囊牌置于牌堆顶,令一名有手牌的其他角色选择弃一张锦囊或依次弃两张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use(界李儒主动发动:选锦囊牌 + 目标)──
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
        if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过灭计';
        const self = st.players[ownerId];
        if (!self?.alive) return '玩家不存在或已死亡';

        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张锦囊牌';
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        if (!isTrickCard(st.cardMap[cardId])) return '只能选择锦囊牌';

        const target = params.target as number | undefined;
        if (typeof target !== 'number') return '请指定一名目标';
        if (target === ownerId) return '不能以自己为目标';
        const tp = st.players[target];
        if (!tp?.alive) return '目标不合法';
        if (tp.hand.length === 0) return '目标没有手牌';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const from = ownerId;
        const target = params.target as number;
        const cardId = params.cardId as string;

        // 限一次标记:第一个 await 前设置,防 dispatch 重入
        await markOncePerTurn(st, from, SKILL_ID);
        await pushFrame(st, SKILL_ID, from, { target, cardId });

        // ── 将锦囊牌置于牌堆顶 ──
        if (st.players[from]?.hand.includes(cardId)) {
          await applyAtom(st, {
            type: '移动牌',
            cardId,
            from: { zone: '手牌', player: from },
            to: { zone: '牌堆' },
          });
        }

        // ── 目标选项合法性计算 ──
        const tp = st.players[target];
        const hasTrick = tp?.hand.some((id) => isTrickCard(st.cardMap[id])) ?? false;
        const hasTwo = (tp?.hand.length ?? 0) >= 2;

        let effect: 'trick' | 'twoCards';
        if (hasTrick && hasTwo) {
          // 两项皆可选 → 询问目标选一项
          delete st.localVars[CHOICE_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: CHOOSE_RT,
            target,
            prompt: {
              type: 'confirm',
              title: '灭计:选择一项',
              description: '1.弃置一张锦囊牌;2.依次弃置两张牌',
              confirmLabel: '弃一张锦囊',
              cancelLabel: '依次弃两张',
            },
            defaultChoice: false,
            timeout: 30,
          });
          effect = st.localVars[CHOICE_KEY] === 'trick' ? 'trick' : 'twoCards';
          delete st.localVars[CHOICE_KEY];
        } else if (hasTrick) {
          // 只能弃锦囊
          effect = 'trick';
        } else if (hasTwo) {
          // 只能弃两张
          effect = 'twoCards';
        } else {
          // 两者皆不可(1 张非锦囊手牌)→ 无效果,流程结束
          await popFrame(st);
          return;
        }

        if (effect === 'trick') {
          // 请求目标弃一张锦囊
          delete st.localVars[CARD_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: PICK_TRICK_RT,
            target,
            prompt: {
              type: 'useCard',
              title: '灭计:弃置一张锦囊牌',
              cardFilter: { filter: (c: Card) => isTrickCard(c), min: 1, max: 1 },
            },
            timeout: 30,
          });
          const picked = st.localVars[CARD_KEY] as string | undefined;
          delete st.localVars[CARD_KEY];
          // 二次校验:仍在手中 + 仍是锦囊(防超时兜底/竞态)
          if (
            picked &&
            st.players[target]?.hand.includes(picked) &&
            isTrickCard(st.cardMap[picked])
          ) {
            await applyAtom(st, { type: '弃置', player: target, cardIds: [picked] });
          }
        } else {
          // 依次弃两张任意牌
          for (let i = 0; i < 2; i++) {
            const tpNow = st.players[target];
            if (!tpNow?.alive || tpNow.hand.length === 0) break; // 中途死亡/无牌则停止
            delete st.localVars[CARD_KEY];
            await applyAtom(st, {
              type: '请求回应',
              requestType: PICK_ONE_RT,
              target,
              prompt: {
                type: 'useCard',
                title: `灭计:依次弃置两张牌(第 ${i + 1}/2 张)`,
                cardFilter: { filter: () => true, min: 1, max: 1 },
              },
              timeout: 30,
            });
            const picked = st.localVars[CARD_KEY] as string | undefined;
            delete st.localVars[CARD_KEY];
            if (picked && st.players[target]?.hand.includes(picked)) {
              await applyAtom(st, { type: '弃置', player: target, cardIds: [picked] });
            } else {
              // 超时/放弃:按规则仍需弃第二张,但实际超时则停止避免死循环
              break;
            }
          }
        }

        await popFrame(st);
      },
    ),
  );

  // ── respond(注册到每个座次:被灭计问询的目标回应)──
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          const atom = slot.atom as { type?: string; requestType?: string };
          if (atom['type'] !== '请求回应') return '当前不需要回应';
          const rt = atom['requestType'];
          if (rt === CHOOSE_RT) return null; // confirm:任意 params 均接受
          if (rt === PICK_TRICK_RT || rt === PICK_ONE_RT) {
            const cardId = params.cardId as string | undefined;
            if (typeof cardId !== 'string') return '请选择一张牌';
            if (!st.players[seat]?.hand.includes(cardId)) return '牌不在手牌中';
            if (rt === PICK_TRICK_RT && !isTrickCard(st.cardMap[cardId])) {
              return '只能选择锦囊牌';
            }
            return null;
          }
          return '当前不是灭计询问';
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(seat);
          const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
          if (rt === CHOOSE_RT) {
            // confirm=true → 弃锦囊(choice='trick');confirm=false → 弃两张(choice='twoCards')
            st.localVars[CHOICE_KEY] =
              params.choice === true || params.confirmed === true ? 'trick' : 'twoCards';
          } else if (rt === PICK_TRICK_RT || rt === PICK_ONE_RT) {
            const cardId = params.cardId as string | undefined;
            if (typeof cardId === 'string') st.localVars[CARD_KEY] = cardId;
          }
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
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '灭计:将一张锦囊牌置于牌堆顶,令一名有手牌的其他角色弃锦囊或弃两张牌',
      cardFilter: { filter: (c: Card) => isTrickCard(c), min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) => {
          const me = view.currentPlayerIndex;
          if (t === me) return false;
          const tp = view.players.find((p) => p.index === t);
          if (!tp || tp.alive === false) return false;
          return tp.handCount > 0;
        },
      },
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn(SKILL_ID)(ctx),
  });
  // respond:目标回应 confirm 或 useCard。前端按 pending prompt 渲染。
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '灭计:选择一项',
      confirmLabel: '弃一张锦囊',
      cancelLabel: '依次弃两张',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
