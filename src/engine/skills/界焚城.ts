// 界焚城(界李儒·群·限定技,OL 界限突破官方逐字):
//   "限定技,出牌阶段,你可以选择一名其他角色开始,
//    令所有其他角色依次选择一项:1.弃置任意张牌(须比上家弃置的牌多);
//    2.受到你造成的2点火焰伤害。"
//
// 界限突破(相对标焚城 —— 标版未实现):
//   1. 标焚城:从所有其他角色依次选(顺序由引擎约定为座次)。
//   2. 界焚城:可选一名其他角色作为"起点",从该起点按座次依次遍历。
//
// 流程(限定技,出牌阶段):
//   1. use:出牌阶段、自己回合、无阻塞 pending、存活、未用过、有其他存活角色。
//      立即标记 player.vars['界焚城/used']=true(限定技,整局一次,防重入)。
//   2. 询问李儒选择一名其他存活角色作为起点(choosePlayer)。
//   3. 从起点按座次依次遍历每个其他存活角色 P:
//      - 询问 P:选 1 弃 X 张(X > 上家弃牌数,X ≤ 手牌数)或 选 2 受 2 点火伤。
//      - 选 1:请求 P 弃 X 张牌(distribute select,minTotal=lastCount+1,maxTotal=handCount)
//        → 弃牌成功后更新 lastCount = X
//      - 选 2 或无法弃(超时/手牌不足):applyAtom(造成伤害, target=P, amount=2,
//        source=李儒, damageType='火焰')
//   4. 第一位目标的 lastCount=0(须弃 ≥1 张)。
//
// 关键点:
//   - 限定技整局一次:player.vars['界焚城/used'](永久 vars,不被自动清理)。
//   - 起点选择:李儒可选任意其他存活角色;遍历按座次从该起点开始,回到李儒前停。
//   - "上家弃牌数":初始为 0;若上家选 2(受伤)则 lastCount 不变(按 OL 规则,
//     "上家弃置的牌数"指实际弃牌的张数;上家受伤时未弃牌,沿用更上一家的张数。
//     OL 描述口径:受伤者不算"上家弃牌",沿用上一次实际弃牌张数作为基准)。
//   - 火焰伤害用 damageType:'火焰',触发藤甲 +1 等。
//   - respond action 注册到每个座次:被问询的目标可为任意其他玩家。
//   - 受伤可能致死;死亡的目标跳过(无后续选择)。
//
// 命名:文件名/loader key/character skill name 均为 '界焚城';内部 Skill.name = '焚城'。
import type {
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

const SKILL_ID = '界焚城';
const DISPLAY_NAME = '焚城';
const USED_KEY = '界焚城/used';

const START_RT = '界焚城/选起点';
const START_KEY = '界焚城/start';
const CONFIRM_RT = '界焚城/选效果';
const CHOICE_KEY = '界焚城/effect';
const DISCARD_RT = '界焚城/弃牌';
const DISCARD_KEY = '界焚城/discarded';
/** 当前"上家弃牌数"——放在 turn.vars 让所有目标共享读 */
const LASTCOUNT_KEY = '界焚城/lastCount';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '限定技:选一名其他角色开始,所有其他角色依次弃比上家多的牌或受你造成的2点火焰伤害',
  };
}

/** 当前回合的上家弃牌数(默认 0) */
function lastCount(st: GameState): number {
  const v = st.turn.vars[LASTCOUNT_KEY];
  return typeof v === 'number' ? v : 0;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use(李儒主动发动)──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, _params: Record<string, Json>): string | null => {
        if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
        if (st.phase !== '出牌') return '只能在出牌阶段发动';
        if (hasBlockingPending(st)) return '当前有未完成的询问';
        if (st.players[ownerId]?.vars[USED_KEY]) return '焚城已使用过(限定技)';
        if (!st.players[ownerId]?.alive) return '玩家不存在或已死亡';
        const others = st.players.filter((p) => p.alive && p.index !== ownerId);
        if (others.length === 0) return '场上没有其他存活角色';
        return null;
      },
      async (st: GameState, _params: Record<string, Json>): Promise<void> => {
        const from = ownerId;
        // 限定技标记:第一个 await 前设置,防 dispatch 重入
        st.players[from].vars[USED_KEY] = true;
        await pushFrame(st, SKILL_ID, from, {});

        try {
          // ── 1) 询问李儒选择起点(其他存活角色)──
          delete st.localVars[START_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: START_RT,
            target: from,
            prompt: {
              type: 'choosePlayer',
              title: '焚城:选择一名其他角色作为起点',
              description: '所有其他角色从该角色开始依次选择弃牌或受2点火焰伤害',
              min: 1,
              max: 1,
              filter: (_view, t) => t !== from && st.players[t]?.alive === true,
            },
            timeout: 30,
          });
          const startArr = st.localVars[START_KEY] as number[] | undefined;
          delete st.localVars[START_KEY];
          if (!Array.isArray(startArr) || startArr.length !== 1) return; // 超时 → 放弃
          const startTarget = startArr[0];
          if (!st.players[startTarget]?.alive) return;

          // ── 2) 从起点按座次依次遍历每个其他存活角色 ──
          // 重置上家弃牌数(本回合本次焚城专用)
          st.turn.vars[LASTCOUNT_KEY] = 0;
          const n = st.players.length;
          // 遍历 n-1 步(所有其他角色)
          for (let step = 0; step < n; step++) {
            const p = (startTarget + step) % n;
            if (p === from) continue;
            if (!st.players[p]?.alive) continue;

            const prev = lastCount(st);
            const handCount = st.players[p].hand.length;
            const canDiscard = handCount > prev; // 至少弃 prev+1 张,须手牌足够

            let effect: 'discard' | 'damage';
            if (canDiscard) {
              // 询问 P 选一项
              delete st.localVars[CHOICE_KEY];
              await applyAtom(st, {
                type: '请求回应',
                requestType: CONFIRM_RT,
                target: p,
                prompt: {
                  type: 'confirm',
                  title: `焚城:选一项(上家弃 ${prev} 张)`,
                  description: `1.弃置 ${prev + 1} 张或更多牌;2.受到李儒造成的 2 点火焰伤害`,
                  confirmLabel: `弃 ≥ ${prev + 1} 张`,
                  cancelLabel: '受 2 点火伤',
                },
                defaultChoice: false,
                timeout: 30,
              });
              effect = st.localVars[CHOICE_KEY] === 'discard' ? 'discard' : 'damage';
              delete st.localVars[CHOICE_KEY];
            } else {
              // 手牌不足 → 只能受伤
              effect = 'damage';
            }

            if (effect === 'discard') {
              // 请求 P 弃 X 张(X ≥ prev+1,X ≤ handCount)
              delete st.localVars[DISCARD_KEY];
              await applyAtom(st, {
                type: '请求回应',
                requestType: DISCARD_RT,
                target: p,
                prompt: {
                  type: 'distribute',
                  mode: 'select',
                  title: `焚城:弃置至少 ${prev + 1} 张牌(上家弃 ${prev} 张)`,
                  source: 'hand',
                  minTotal: prev + 1,
                  maxTotal: handCount,
                },
                timeout: 30,
              });
              const picked = st.localVars[DISCARD_KEY] as string[] | undefined;
              delete st.localVars[DISCARD_KEY];
              // 二次校验:张数 ≥ prev+1 + 仍在手中
              if (
                Array.isArray(picked) &&
                picked.length >= prev + 1 &&
                picked.every((id) => st.players[p]?.hand.includes(id))
              ) {
                await applyAtom(st, { type: '弃置', player: p, cardIds: picked });
                st.turn.vars[LASTCOUNT_KEY] = picked.length; // 更新上家
              } else {
                // 超时/放弃/校验失败 → 受伤
                if (st.players[p]?.alive) {
                  await applyAtom(st, {
                    type: '造成伤害',
                    target: p,
                    amount: 2,
                    source: from,
                    damageType: '火焰',
                  });
                }
              }
            } else {
              // 选 2 → 受伤
              if (st.players[p]?.alive) {
                await applyAtom(st, {
                  type: '造成伤害',
                  target: p,
                  amount: 2,
                  source: from,
                  damageType: '火焰',
                });
              }
            }
          }
          delete st.turn.vars[LASTCOUNT_KEY];
        } finally {
          await popFrame(st);
        }
      },
    ),
  );

  // ── respond(注册到每个座次)──
  // ownerId 座次:起点选择;其他座次:confirm + 弃牌
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
          if (rt === START_RT) {
            const targets = params.targets as number[] | undefined;
            if (!Array.isArray(targets) || targets.length !== 1) return '请选择一名起点';
            const t = targets[0];
            if (t === seat) return '不能选自己为起点';
            if (!st.players[t]?.alive) return '起点不合法';
            return null;
          }
          if (rt === CONFIRM_RT) return null; // confirm:任意 params 均接受
          if (rt === DISCARD_RT) {
            const cardIds = params.cardIds as string[] | undefined;
            if (!Array.isArray(cardIds) || cardIds.length === 0) return '请选择要弃置的牌';
            const self = st.players[seat];
            if (!self) return '玩家不存在';
            const prev = lastCount(st);
            if (cardIds.length <= prev) return `须弃置至少 ${prev + 1} 张`;
            for (const id of cardIds) {
              if (!self.hand.includes(id)) return '牌不在手牌中';
            }
            return null;
          }
          return '当前不是焚城询问';
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(seat);
          const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
          if (rt === START_RT) {
            const targets = params.targets as number[] | undefined;
            if (Array.isArray(targets)) st.localVars[START_KEY] = targets;
          } else if (rt === CONFIRM_RT) {
            st.localVars[CHOICE_KEY] =
              params.choice === true || params.confirmed === true ? 'discard' : 'damage';
          } else if (rt === DISCARD_RT) {
            const cardIds = params.cardIds as string[] | undefined;
            if (Array.isArray(cardIds)) st.localVars[DISCARD_KEY] = cardIds;
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
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '焚城(限定技):选一名其他角色开始,所有其他角色依次弃比上家多的牌或受2点火焰伤害',
    },
    activeWhen: (ctx) => defaultPlayActive(ctx),
  });
  // respond:目标按 pending prompt 渲染(choosePlayer/confirm/distribute 三种轮转)
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '焚城:选择一项',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
