// 界明策(界陈宫·群·主动技,OL 界限突破官方逐字):
//   "出牌阶段限一次,你可以交给一名其他角色一张【杀】或装备牌,然后其选择一项:
//    1.视为对你选择的另一名角色使用一张【杀】,若造成伤害,执行另一项;
//    2.你与其各摸一张牌。"
//
// 与标版明策(陈宫·未实现,docs/research/武将技能/群雄/陈宫.md)对比:
//   - 标版:"交给一名其他角色一张【杀】或装备牌,然后其选择一项:
//     1.视为对其攻击范围内你选择的另一名角色使用一张【杀】;2.摸一张牌。"
//   - 界版差异:
//     ① 选项 1 取消"其攻击范围内"距离限制(任意你选择的目标)
//     ② 选项 1 命中后追加执行选项 2(双方各摸一张)
//     ③ 选项 2 改为"你与其各摸一张牌"(标版仅目标摸一张)
//   两版规则不同,必须独立界版文件。
//
// 实现要点:
//   - 限一次:player.vars['界明策/usedThisTurn'](/usedThisTurn 后缀由「回合结束」atom 自动清空)
//   - 给牌:cardId 须为【杀】或【装备牌】,从 owner 手牌或装备区移到 target 手牌
//     · 装备区装备先「卸下」回手再「移动牌」,与界强袭/界武圣 卸装备模式一致
//   - 目标选择:owner 在 use action 提交时同时指定 [target, killTarget]
//     · target:被给牌者(任意其他存活角色)
//     · killTarget:选项 1 中被杀的目标(任意其他存活角色,允许是 owner 自己——"另一名角色")
//   - target 选项询问(2 段 confirm,因 ActionPrompt 无 3 选项枚举,与界将驰一致):
//     · CONFIRM_RT:是否执行选项 1(出杀)?confirm=执行①,cancel/超时=执行②
//   - 选项 1(出杀):A 视为对 killTarget 使用一张【杀】(virtualKill,无实体牌)
//     · 若 killTarget 受到伤害(对比受伤前后体力)→ 追加执行选项 2(双方各摸 1)
//   - 选项 2(摸牌):owner 与 target 各摸一张牌
//
// 命名:文件名/loader key/character skill name 均为 '界明策';内部 Skill.name='明策'(OL 官方名)。
import type {
  Card,
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
  SkillModule,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { runUseFlow } from '../card-effect/use-card';
import { registerAction, hasBlockingPending } from '../skill';
import { defaultPlayActive } from '../action-active';
import { activeUnlessUsedThisTurn, markOncePerTurn, usedThisTurn } from '../once-per-turn';

const SKILL_ID = '界明策';
const DISPLAY_NAME = '明策';

/** localVars key:target 对选项询问的回应(false=选项②摸牌, true=选项①出杀) */
const CHOICE_KEY = '明策/choice';
/** target 选项询问 requestType */
const CHOICE_RT = '明策/choice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次:交给一名其他角色一张杀或装备牌,其选择一项:①视为对你指定的另一名角色出杀(若造成伤害,执行另一项);②你与其各摸一张牌',
  };
}

/** 判定一张卡是否为【杀】(含影子杀——name 即为 '杀') */
function isSlashCard(card: Card | undefined): boolean {
  return !!card && card.name === '杀';
}

/** 判定一张卡是否为装备牌 */
function isEquipmentCard(card: Card | undefined): boolean {
  return !!card && card.type === '装备牌';
}

/** 创建一张虚拟杀卡 id(无实体,仅用于结算流程的 cardId 引用) */
function makeVirtualSlashId(source: number, target: number, seq: number): string {
  return `明策:杀:${source}:${target}:${seq}`;
}

/**
 * 执行一次"视为出杀"的完整结算(指定目标→成为目标→检测有效性→询问闪→伤害/抵消)。
 * 不消耗手牌;模型参考 界仁德.virtualKill / 界乱武.virtualKill。
 *
 * @returns 是否对 target 造成了伤害(用于界明策选项 1 命中后追加执行选项 2)
 */
async function virtualKill(
  state: GameState,
  source: number,
  target: number,
): Promise<boolean> {
  if (!state.players[target]?.alive) return false;
  const targetHealthBefore = state.players[target].health;
  const cardId = makeVirtualSlashId(source, target, state.seq);
  // 虚拟杀无实体,但结算流程中 atoms/toViewEvents 需要 cardMap[id] 存在
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };

  await runUseFlow(state, source, cardId, [target], '杀', { virtual: true });
  // 清理虚拟杀卡(无实体,不入弃牌堆)
  delete state.cardMap[cardId];
  // 通过体力差判定是否真的造成伤害(防具/反馈/奸雄等可能改伤)
  return state.players[target].health < targetHealthBefore;
}

/** 选项 2:owner 与 target 各摸一张牌 */
async function drawBoth(state: GameState, owner: number, target: number): Promise<void> {
  if (state.players[owner]?.alive) {
    await applyAtom(state, { type: '摸牌', player: owner, count: 1 });
  }
  if (state.players[target]?.alive) {
    await applyAtom(state, { type: '摸牌', player: target, count: 1 });
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use action(陈宫主动发动明策)──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, params: Record<string, Json>): string | null => {
        if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
        if (st.phase !== '出牌') return '只能在出牌阶段使用';
        if (hasBlockingPending(st)) return '当前有未完成的询问';
        if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过明策';
        const self = st.players[ownerId];
        if (!self?.alive) return '角色不可用';

        // cardId:要给出的杀或装备牌
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '需要选择一张牌';
        const card = st.cardMap[cardId];
        if (!isSlashCard(card) && !isEquipmentCard(card)) {
          return '只能给出杀或装备牌';
        }
        // cardId 来源:手牌或自己的装备区
        const inHand = self.hand.includes(cardId);
        const inEquip = Object.values(self.equipment).includes(cardId);
        if (!inHand && !inEquip) return '牌不在你的手牌或装备区';

        // targets:两名不同的其他存活角色 [target, killTarget]
        // target = 被给牌者;killTarget = 选项 1 中被杀的目标(可为 owner 自己)
        const targets = params.targets as number[] | undefined;
        if (!Array.isArray(targets) || targets.length !== 2) {
          return '需要选择给牌目标与可能的杀目标';
        }
        const [target, killTarget] = targets;
        if (target === ownerId) return '给牌目标不能是自己';
        if (!st.players[target]?.alive) return '给牌目标不合法';
        // killTarget 允许是 owner 自己("另一名角色"含陈宫);但必须与 target 不同
        // (官方 FAQ:选项 1 中杀的目标是"另一名角色",即不同于被给牌者 target)
        if (killTarget === target) return '杀目标不能与给牌目标相同';
        if (!st.players[killTarget]?.alive) return '杀目标不合法';

        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const from = ownerId;
        const cardId = params.cardId as string;
        const [target, killTarget] = params.targets as [number, number];

        // 限一次:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
        await markOncePerTurn(st, from, SKILL_ID);

        await pushFrame(st, SKILL_ID, from, { ...params });
        try {
          // 1) 给牌:从 owner(手牌或装备区)移到 target 手牌
          //    装备区装备先卸下(回手),再移动牌;手牌直接移动
          const inEquip = Object.values(st.players[from].equipment).includes(cardId);
          if (inEquip) {
            // 找到对应槽位并卸下
            const slot = (Object.entries(st.players[from].equipment) as Array<
              [string, string]
            >).find(([, id]) => id === cardId)?.[0];
            if (slot) {
              await applyAtom(st, {
                type: '卸下',
                player: from,
                slot: slot as '武器' | '防具' | '进攻马' | '防御马',
              });
            }
          }
          await applyAtom(st, {
            type: '移动牌',
            cardId,
            from: { zone: '手牌', player: from },
            to: { zone: '手牌', player: target },
          });

          // target 死亡检测(给牌本身不会致死,但极端防御性检查)
          if (!st.players[target]?.alive) return;

          // 2) 询问 target 选择:confirm=选项①出杀,cancel/超时=选项②摸牌
          delete st.localVars[CHOICE_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: CHOICE_RT,
            target,
            prompt: {
              type: 'confirm',
              title: `明策:选择一项(确认=对 ${killTarget + 1} 号视为使用一张杀,若造成伤害再各摸一张;取消=你与陈宫各摸一张)`,
              confirmLabel: '①视为出杀',
              cancelLabel: '②双方各摸一张',
            },
            defaultChoice: false, // 超时默认选项②摸牌
            timeout: 20,
          });
          const choseSlash = st.localVars[CHOICE_KEY] === true;
          delete st.localVars[CHOICE_KEY];

          if (choseSlash) {
            // 选项 ①:target 视为对 killTarget 使用一张杀
            const dealtDamage = await virtualKill(st, target, killTarget);
            // 若造成伤害,执行另一项(选项②:双方各摸 1)
            if (dealtDamage) {
              await drawBoth(st, from, target);
            }
          } else {
            // 选项 ②:owner 与 target 各摸一张
            await drawBoth(st, from, target);
          }
        } finally {
          await popFrame(st);
        }
      },
    ),
  );

  // ── respond:target 响应选项询问(CHOICE_RT)──
  //   为每个座次注册(因为 target 可能是任意玩家),与界乱武/界激将 跨座次 respond 模式一致
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
          const rt = (slot.atom as { requestType?: string }).requestType;
          if (rt !== CHOICE_RT) return '当前不是明策询问';
          return null;
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(seat);
          const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
          if (rt !== CHOICE_RT) return;
          // confirm → choice=true(选项①);cancel/其他 → choice=false(选项②)
          st.localVars[CHOICE_KEY] = params.choice === true || params.confirmed === true;
        },
      ),
    );
  }

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '明策:交给一名其他角色一张杀或装备牌;并选择可能的杀目标',
      description:
        '出牌阶段限一次。给牌后该角色选择:①视为对你指定的另一名角色出杀(若造成伤害再各摸一张);②你与其各摸一张',
      cardFilter: {
        // 前端 filter 是 validate 的超集:杀 + 装备(手牌或装备区)
        filter: (c: Card) => isSlashCard(c) || isEquipmentCard(c),
        min: 1,
        max: 1,
      },
      targetFilter: {
        min: 2,
        max: 2,
        // 两槽位:① 给牌目标(任意其他存活角色);② 杀目标(任意存活角色,可为陈宫自己,但不能与①相同)
        slots: [
          {
            label: '给牌目标',
            filter: (view: GameView, t: number) =>
              t !== view.currentPlayerIndex && !!view.players[t]?.alive,
          },
          {
            label: '杀目标(选项①)',
            filter: (view: GameView, t: number, ctx: { selected: number[] }) =>
              !!view.players[t]?.alive && !ctx.selected.includes(t),
          },
        ],
      },
    },
    activeWhen: (ctx) => defaultPlayActive(ctx) && activeUnlessUsedThisTurn(SKILL_ID)(ctx),
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
