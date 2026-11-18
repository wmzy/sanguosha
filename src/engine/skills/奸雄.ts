// 奸雄(曹操·被动技):当你受到伤害后,你可以获得造成此伤害的牌。
//   无来源伤害(闪电等)无牌可获得,技能不发动。(官方逐字,docs/research/武将技能/魏国/曹操.md)
//
// 时序关键:伤害牌在造成伤害时位于 frame.cards(处理区),父 execute
// (杀/万箭齐发/南蛮入侵/决斗)收尾会 applyAtom(移动牌, 处理区→弃牌堆)将其入弃牌堆。
// 若奸雄在造成伤害 after hook 直接拿走(处理区→手牌),父收尾的 移动牌 `to:弃牌堆`
// 仍会无条件 push 该 cardId → 牌同时出现在手牌与弃牌堆(状态损坏)。
// 故采用"延迟拿取":造成伤害后记录 wantCard=cardId,挂 移动牌 after hook,
// 在该伤害牌被移入弃牌堆的瞬间再 移动牌(弃牌堆→手牌)。此时父收尾已完成、无重复。
//
// 本文件同时导出 createJianxiongSkill 工厂:界奸雄(src/engine/skills/界奸雄.ts)
// 复用同一实现,仅注入差异——
//   - chooseRt:发动询问 requestType(标版 '奸雄/choose',界版 '界奸雄/choose')。
//   - drawOne:发动后先摸一张牌(界版两项效果之一;界版无伤害牌仍询问、只摸一张,
//     OL 官网 FAQ 2016-11-01;标版无伤害牌不发动、发动也不摸牌)。
// wantCard/choice 为 state.localVars 键,两版共用同一字面量(历史如此,保持等价)。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import { askConfirm, defineConfirmAction, effectiveCardId, registerConfirmRespond } from '../util/skillRuntime';

const WANTCARD_KEY = '奸雄/wantCard';
const CHOICE_KEY = '奸雄/choice';

export interface JianxiongOptions {
  /** 技能 id(亦作 Skill.name 与询问文案前缀) */
  skillId: string;
  /** 发动询问 requestType(标版 '奸雄/choose',界版 '界奸雄/choose') */
  chooseRt: string;
  /** 技能描述 */
  description: string;
  /** 发动后是否摸一张牌(界版效果;标版仅获得伤害牌) */
  drawOne: boolean;
}

export function createJianxiongSkill(opts: JianxiongOptions) {
  const SKILL_ID = opts.skillId;
  const { chooseRt, drawOne } = opts;

  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: SKILL_ID,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;

    // respond:玩家在发动询问(chooseRt)下的选择(choice=true=发动)
    registerConfirmRespond(state, skill.id, ownerId, chooseRt, CHOICE_KEY, {
      mismatchError: '当前不是奸雄选择',
    });

    // 造成伤害 after:曹操受伤后询问是否发动
    registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      // 清除上一轮残留的 wantCard:若上次记录的牌被其他 hook(如天妒)截走、
      // 从未进入弃牌堆,移动牌 hook 不会删除它;此处不清理会在后续该牌入弃牌堆时被误拿。
      delete ctx.state.localVars[WANTCARD_KEY];
      if ((atom.amount ?? 0) <= 0) return;

      const damageCardId = atom.cardId;
      const hasCard = typeof damageCardId === 'string' && !!ctx.state.cardMap[damageCardId];
      // 标版:无伤害牌(闪电等无来源伤害)无可获得之物,技能不发动;
      // 界版:仍可发动,但只摸一张牌(官网 FAQ)。
      if (!hasCard && !drawOne) return;
      // 转化影子卡(武圣红牌当杀等):影子卡入弃牌堆时引擎用原卡(shadowOf)替换并删除影子,
      // 须记录原卡 id 才能在弃牌堆中找到并拿取(同界双雄)
      const effectiveId: string = hasCard
        ? effectiveCardId(ctx.state, damageCardId)
        : (damageCardId as string);

      const choice = await askConfirm(ctx.state, chooseRt, ownerId, {
        confirmedKey: CHOICE_KEY,
        title: drawOne
          ? hasCard
            ? `${SKILL_ID}:是否发动?(摸一张牌并获得造成此伤害的牌)`
            : `${SKILL_ID}:是否发动?(无伤害牌可获得,仅摸一张牌)`
          : `${SKILL_ID}:是否获得造成此伤害的牌?`,
        confirmLabel: drawOne ? '发动' : '获得',
        cancelLabel: '不发动',
        defaultChoice: false,
        timeout: 10,
      });
      if (choice) {
        // 界版两项效果都执行:先摸一张,获得走延迟拿取(见下方 移动牌 after hook);
        // 标版仅获得伤害牌(官方逐字)。无伤害牌时界版只摸一张。
        if (drawOne) {
          await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
        }
        if (hasCard) {
          ctx.state.localVars[WANTCARD_KEY] = effectiveId;
        }
      }
      delete ctx.state.localVars[CHOICE_KEY];
    });

    // 移动牌 after:延迟拿取伤害牌——当 wantCard 指定的牌被移入弃牌堆时,转为曹操手牌
    registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
      const wantCard = ctx.state.localVars[WANTCARD_KEY];
      if (typeof wantCard !== 'string') return;
      const atom = ctx.atom;
      if (atom.to?.zone !== '弃牌堆') return;
      // 该伤害牌(或其原卡)刚被父结算移入弃牌堆——转给曹操。
      // 用 discardPile.includes 判定而非 atom.cardId===wantCard:转化影子卡入弃牌堆时
      // 引擎用原卡替换,atom.cardId(影子 id)≠ wantCard(原卡 id),按 cardId 匹配会漏掉。
      // 若原卡已被其他技能拿走(不在弃牌堆)→ 跳过,不强行获取避免状态损坏。
      if (!ctx.state.zones.discardPile.includes(wantCard)) return;
      if (!ctx.state.cardMap[wantCard]) return;

      await applyAtom(ctx.state, {
        type: '移动牌',
        cardId: wantCard,
        from: { zone: '弃牌堆' },
        to: { zone: '手牌', player: ownerId },
      });
    });

    return () => {};
  }

  function onMount(_skill: Skill, api: FrontendAPI): void {
    defineConfirmAction(api, 'respond', {
      label: SKILL_ID,
      title: '是否发动奸雄?',
      style: 'default',
    });
  }

  return { createSkill, onInit, onMount };
}

export const { createSkill, onInit, onMount } = createJianxiongSkill({
  skillId: '奸雄',
  chooseRt: '奸雄/choose',
  description: '当你受到伤害后,你可以获得造成此伤害的牌',
  drawOne: false,
});
