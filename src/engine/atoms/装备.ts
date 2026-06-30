// 装备:玩家装备 cardId(从手牌移除,放入 equipment 槽位)
// 副作用:武器攻击范围写入 vars(距离/出杀范围)。
// 进攻马/防御马的距离修正不再在此硬编码——由马匹技能(赤兔/的卢等)通过
// 添加技能/移除技能 hook 设置 vars(距离/进攻修正|距离/防御修正),与马术等武将技能一致。
// 对应 卸下 atom 负责清除武器范围;马匹 vars 由技能卸载清理。
import type { AtomDefinition, EquipSlot, GameState, ViewEventSplit, ViewEvent, Card } from '../types';
import { registerAtom } from '../atom';

function inferSlot(cardType: string | undefined): EquipSlot | null {
  switch (cardType) {
    case '武器':
      return '武器';
    case '防具':
      return '防具';
    case '进攻马':
      return '进攻马';
    case '防御马':
      return '防御马';
    case '宝物':
      return '宝物';
    default:
      return null;
  }
}

/** 设装备带来的距离修正 vars(仅武器攻击范围;马匹由技能处理) */
function applyEquipVars(
  state: GameState,
  playerIdx: number,
  slot: EquipSlot,
  card: { name: string; range?: number },
): void {
  const vars = state.players[playerIdx].vars;
  if (slot === '武器') {
    vars['距离/出杀范围'] = card.range ?? 1;
  }
}

export const 装备: AtomDefinition<{ player: number; cardId: string }> = {
  type: '装备',
  validate(state, atom) {
    const p = state.players[atom.player];
    if (!p) return `player ${atom.player} not found`;
    if (!p.hand.includes(atom.cardId)) return `card not in player's hand`;
    const card = state.cardMap[atom.cardId];
    if (!card) return `card ${atom.cardId} not found`;
    const slot = inferSlot(card.subtype);
    if (!slot) return `card is not equipment`;
    return null;
  },
  apply(state, atom) {
    const card = state.cardMap[atom.cardId];
    const slot = inferSlot(card.subtype)!;
    const player = state.players[atom.player];
    player.hand = player.hand.filter((id) => id !== atom.cardId);
    player.equipment[slot] = atom.cardId;
    // 设距离修正 vars(卸下 atom 清除)
    applyEquipVars(state, atom.player, slot, card);
  },
  effect: { sound: 'equip', animation: 'glow', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const card = state.cardMap[atom.cardId];
    const slot = inferSlot(card.subtype)!;
    const view: ViewEvent = {
      type: '装备',
      player: atom.player,
      cardId: atom.cardId,
      cardName: card.name,
      slot,
      // 武器攻击范围:applyView 需要同步到 distanceVars.attackRange
      ...(slot === '武器' ? { range: card.range ?? 1 } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    const slot = event.slot as '武器' | '防具' | '进攻马' | '防御马' | '宝物' | undefined;
    if (slot) {
      view.players[pi].equipment[slot] = event.cardId as string;
    }
    // 武器攻击范围同步到 distanceVars
    if (slot === '武器' && typeof event.range === 'number') {
      view.players[pi].distanceVars = {
        ...view.players[pi].distanceVars,
        attackRange: event.range,
      };
    }
    // 装备从手牌移出:handCount - 1
    view.players[pi].handCount = Math.max(0, view.players[pi].handCount - 1);
    if (view.players[pi].hand) {
      view.players[pi].hand = view.players[pi].hand.filter((c: Card) => c.id !== event.cardId);
    }
  },
  toViewLog(event) {
    return { player: event.player as number, text: `装备了 ${event.cardName ?? event.cardId}` };
  },
};

registerAtom(装备);
