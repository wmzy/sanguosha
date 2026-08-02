// 使用时:牌被使用时触发(use.md 时机2)。
// after hook 触发"使用时"摸牌类技能(集智/强识等):使用一张非延时锦囊后摸一牌。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

/** 牌名 → APNG 动效 ID 映射。杀区分火/雷属性。 */
const CARD_VFX: Record<string, string> = {
  杀: 'card/slash_red',
  闪: 'card/jink',
  桃: 'card/peach',
  酒: 'card/analeptic',
  决斗: 'card/duel',
  铁索连环: 'card/chain',
  无懈可击: 'card/skill_nullify',
};

export const 使用时: AtomDefinition<{ source: number; cardId: string }> = {
  type: '使用时',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    return null;
  },
  apply() {
    // 事件标记——after hook 触发集智/强识等"使用时摸牌"技能
  },
  effect: { animation: 'highlight', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    const card = state.cardMap[atom.cardId];
    const cardName = card?.name ?? atom.cardId;
    // 按牌名播报语音(sound/card/{牌名}):打出无中生有响"无中生有!"
    // 无对应语音文件的牌→ audioEngine 404 负缓存静默跳过
    // 出牌动效(vfx):杀(区分火/雷)/闪/桃/酒/决斗/铁索连环 等有 APNG 特效
    let vfx = CARD_VFX[cardName];
    const damageType = (card as { damageType?: string } | undefined)?.damageType;
    if (cardName === '杀') {
      if (damageType === 'fire') vfx = 'card/fire_slash';
      else if (damageType === 'thunder') vfx = 'card/thunder_slash';
    }
    const view: ViewEvent = {
      type: '使用时',
      source: atom.source,
      cardId: atom.cardId,
      cardName,
      effect: {
        sound: `card/${cardName}`,
        animation: 'highlight',
        duration: 600,
        ...(vfx ? { vfx } : {}),
      },
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 事件标记——无 GameView 字段需要直接更新(摸牌由后续 摸牌 atom 的 applyView 体现)。
  },
};

registerAtom(使用时);
