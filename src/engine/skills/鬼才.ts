// 鬼才(司马懿·被动触发):在任意角色的判定牌生效前,你可以打出一张手牌代替之。
//
// 触发时机:判定牌翻开(判定 atom.apply 完成)后、判定效果(闪电/兵粮寸断/乐不思蜀等
//   消费技能在 判定牌生效后 读判定牌)生效前。本技能注册为判定改判钩子(registerJudgeModifier),
//   由 判定牌生效前 atom 的 afterApply 阶段(runJudgeModifiers)触发:
//   - 判定 atom.apply 已把判定牌推入 frameCards(top)
//   - 判定牌生效前.afterApply:runJudgeModifiers 从判定目标起逆时针逐个询问改判能力
//   - 本钩子询问司马懿是否替换:是 → 把 frameCards 顶的判定牌移入弃牌堆,替换牌压入帧顶
//   - 之后 判定牌生效后 的技能 after hooks(闪电等消费方)读 frameCards 顶 → 看到替换后的牌
//   - runJudgeFlow 末尾把 frameCards 顶移入弃牌堆
//
// 顺序保证:改判在 判定牌生效前.afterApply、消费方在 判定牌生效后 after-hook,前者严格先于后者。
//   故司马懿任意座次都能生效(不再依赖“座次靠前于消费方”)。鬼才与鬼道同场时,
//   runJudgeModifiers 按判定目标逆时针依次询问,顺序符合官方规则。
//
// 交换判定牌走 flows/judge.ts 的 replaceJudgeCard:原判定牌与替换牌各经一步「移动牌」atom
//   (前者入弃牌堆、后者打出到帧顶),交换全程有视图投影。
//
// 本文件同时导出 createGuicaiSkill 工厂(鬼才族共享实现),界鬼才 复用之,仅注入
//   includeEquipment(装备区牌可作替换牌:candidates 投影 + 移除技能→卸下 序列)等差异参数。
import type { EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { frameCards } from '../core/frame';
import { registerAction, registerJudgeModifier } from '../core/skill';
import { replaceJudgeCard } from '../flows/judge';
import { requireRequestType } from '../util/skillRuntime';
import { equipSlotOf } from '../util/player-query';

/** 鬼才族(任意牌改判)差异参数 */
export interface GuicaiOptions {
  /** Skill.name(玩家可见技能名:标 '鬼才' / 界 '界鬼才') */
  name: string;
  description: string;
  /** respond 询问的 requestType(技能名/xxx 命名空间,标/界键隔离) */
  replaceRequestType: string;
  /** 记录所选替换牌的 localVars 键(标/界共用原前缀;缺省 '鬼才/replaceCard') */
  replaceCardKey?: string;
  /** 询问/报错文案的技能名前缀(标 '鬼才' / 界 '界鬼才') */
  promptName: string;
  /** 替换牌范围文案(标题用):标 '手牌' / 界 '手牌或装备牌' */
  cardNoun: string;
  /** 是否允许装备区牌作替换牌(界版差异):询问显式下发 candidates,装备牌替换前先 移除技能→卸下 */
  includeEquipment?: boolean;
}

/** 鬼才族共享实现:标版鬼才与界鬼才仅替换牌范围(手牌 vs 手牌或装备区)不同,机制完全一致。 */
export function createGuicaiSkill(opts: GuicaiOptions) {
  const replaceCardKey = opts.replaceCardKey ?? '鬼才/replaceCard';
  const askTitle = `${opts.promptName}:是否打出一张${opts.cardNoun}代替判定牌?`;
  const pickTitle = `${opts.promptName}:选择一张${opts.cardNoun}代替判定牌`;

  return {
    createSkill(id: string, ownerId: number): Skill {
      return { id, ownerId, name: opts.name, description: opts.description };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      // 检查 cardId 在 owner 的哪个区域:手牌 / 装备槽 / null(界版:装备区牌可作替换牌)
      function findCardLocation(st: GameState, cardId: string): 'hand' | EquipSlot | null {
        const me = st.players[ownerId];
        if (!me) return null;
        if (me.hand.includes(cardId)) return 'hand';
        return equipSlotOf(me, cardId);
      }

      // owner 是否有可用作替换的牌(标版:手牌;界版:手牌或装备区)
      function hasReplaceableCards(st: GameState): boolean {
        const me = st.players[ownerId];
        if (!me) return false;
        if (me.hand.length > 0) return true;
        return !!opts.includeEquipment && Object.values(me.equipment).some((id) => id !== undefined);
      }

      // ─── respond:选替换牌(或拒绝) ──────────────────────
      registerAction(
        state,
        skill.id,
        ownerId,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const check = requireRequestType(st, ownerId, [opts.replaceRequestType], {
            mismatchError: `当前不是${opts.promptName}询问`,
          });
          if (check.error) return check.error;
          // 若选择替换:cardId 必须在合法区域(标:手牌;界:手牌或装备区);拒绝则无额外要求
          // 浏览器/Headless 客户端对 useCard 型 pending 只发 {cardId}(无 choice),
          // 故 cardId 出现即视为发动意图;{choice:false}/{} 仍视为不发动。
          if (params.choice === true || params.confirmed === true || typeof params.cardId === 'string') {
            const cardId = params.cardId as string;
            if (typeof cardId !== 'string') return '请选择一张替换牌';
            if (opts.includeEquipment) {
              if (findCardLocation(st, cardId) === null) return '替换牌不在手牌或装备区中';
            } else if (!st.players[ownerId].hand.includes(cardId)) {
              return '替换牌不在手牌中';
            }
          }
          return null;
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const use =
            params.choice === true || params.confirmed === true || typeof params.cardId === 'string';
          if (!use) {
            st.localVars[replaceCardKey] = null;
            return;
          }
          st.localVars[replaceCardKey] = params.cardId ?? null;
        },
      );

      // ─── 判定改判钩子:翻开判定牌后询问是否替换 ────────────
      registerJudgeModifier(state, skill.id, ownerId, async (ctx) => {
        const atom = ctx.atom;
        if (atom.type !== '判定牌生效前') return;
        // 须存活且有可用替换牌(标版:手牌;界版:手牌或装备区)
        const me = ctx.state.players[ownerId];
        if (!me?.alive) return;
        if (!hasReplaceableCards(ctx.state)) return;

        // 当前判定牌(frameCards 顶)
        const cards = frameCards(ctx.state);
        if (cards.length === 0) return;

        // 询问是否替换
        delete ctx.state.localVars[replaceCardKey];
        // 界版显式 candidates(手牌+装备区,仿界天香):投影层 resolveCardFilterCandidates
        // 仅遍历 player.hand 生成候选,浏览器/HGC 把 candidates 当权威 → 装备牌永远选不到
        // (prompt 标题却写「手牌或装备牌」,界版核心差异在客户端不可达)。
        const equipIds = opts.includeEquipment
          ? Object.values(me.equipment).filter((id): id is string => typeof id === 'string')
          : [];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: opts.replaceRequestType,
          target: ownerId,
          prompt: {
            type: 'useCard',
            title: askTitle,
            cardFilter: {
              filter: () => true,
              ...(opts.includeEquipment ? { candidates: [...me.hand, ...equipIds] } : {}),
              min: 1,
              max: 1,
            },
          },
          defaultChoice: false,
          timeout: 15,
        });

        const replaceCardId = ctx.state.localVars[replaceCardKey] as string | null | undefined;
        delete ctx.state.localVars[replaceCardKey];
        if (!replaceCardId) return; // 不替换

        // 二次校验:替换牌仍须在合法区域(标:手牌;界:手牌或装备区)
        if (opts.includeEquipment) {
          const location = findCardLocation(ctx.state, replaceCardId);
          if (location === null) return;

          // 若替换牌来自装备区:先卸载装备自带技能(移除技能),再从装备区卸下到手牌(卸下)
          //   与 装备通用 换装流程一致:移除技能 → 卸下,确保技能实例/vars 正确清理。
          if (location !== 'hand') {
            const equipSlot = location;
            const card = ctx.state.cardMap[replaceCardId];
            // 卸载装备自带的技能实例(武器技/马匹技等)
            if (card?.name && me.skills.includes(card.name)) {
              await applyAtom(ctx.state, {
                type: '移除技能',
                player: ownerId,
                skillId: card.name,
              });
            }
            // 卸下装备:装备区→手牌(清除武器攻击范围 vars,马匹 vars 由技能 onUnload 清理)
            await applyAtom(ctx.state, {
              type: '卸下',
              player: ownerId,
              slot: equipSlot,
            });
          }
        } else if (!me.hand.includes(replaceCardId)) {
          return;
        }

        // 交换判定牌:原判定牌 → 弃牌堆,替换牌 → 处理区(帧顶)。
        // 两步都走「移动牌」atom —— 直接 mutate frameCards 会漏掉「替换牌离手(handCount)」
        // 与「原判定牌入弃牌堆(discardPileCount)」的视图投影,客户端会一直显示司马懿手里还有那张牌。
        await replaceJudgeCard(ctx.state, ownerId, replaceCardId);
      });

      return () => {};
    },

    onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
      api.defineAction('respond', {
        label: opts.name,
        style: 'primary',
        prompt: {
          type: 'useCard',
          title: pickTitle,
          // 注册表兜底声明(静态,无法携带装备区动态 candidates):真实询问的权威候选
          // 由 onInit 判定改判钩子在发起前以 hand+equipment 显式下发(仿界天香),
          // 前端/HGC 优先消费 pending 侧 candidates,不依赖此处 cardFilter 的手牌遍历。
          cardFilter: { filter: () => true, min: 1, max: 1 },
        },
      });
    },
  };
}

const OPTIONS: GuicaiOptions = {
  name: '鬼才',
  description: '判定牌生效前,你可以打出一张手牌代替之',
  replaceRequestType: '鬼才/replace',
  promptName: '鬼才',
  cardNoun: '手牌',
};

export const { createSkill, onInit, onMount } = createGuicaiSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
