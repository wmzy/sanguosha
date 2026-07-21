// 移出至暂存区:把指定玩家的若干牌(手牌/装备)移出游戏,暂存于 player.vars[varsKey]。
//
// 通用操作,服务于所有"暂时移出→到时归还"型技能:
//   - 界徐盛·界破军:用杀指定目标后,把目标的至多 X 张牌(手牌+装备)移出,
//     回合结束用 归还暂存牌 归还。varsKey='界破军/移出'。
//   - 界陆逊·界谦逊:延时/普通锦囊对自己生效且为唯一目标时,把全部手牌移出,
//     回合结束归还。varsKey='界谦逊/移出'。
//   - 未来:神吕蒙·攻心 / 钟会·权计 / 王元姬·隐识 等同构技能可复用本 atom。
//
// 旧实现 破军移出 / 移出游戏 是两份几乎同构的代码,差异仅:
//   ① 来源 zone(谦逊只手牌,破军手牌+装备);
//   ② source/target 是否同一人(谦逊=自己,破军=source 选 target 的牌);
//   ③ vars key 字面值。
// 本 atom 把三者都参数化,合并为一份。
//
// 设计(与 置创牌 / 移动牌 同构的"zone 外暂存"模式):
//   - 移出的牌不属于任何标准 zone(牌堆/弃牌堆/手牌/处理区),仅存于 target.vars[varsKey]
//     (cardId 列表,引擎权威)。buildView 不投影此字段。
//   - apply:逐个从 target.hand 或 target.equipment 移除,追加到 vars[varsKey]。
//     装备移除时同步清空对应槽位的距离 vars(武器)——与 卸下 atom 一致。
//   - toViewEvents:在 apply 之前调用,广播移出事件。信息分级——
//       source(选牌者)与 target(牌主)看到 cardIds + 牌面;
//       其他人只看到 handCount(hand 本就隐藏)+ 公开的装备 slot 变化。
//   - applyView:从 target 视图移除手牌/装备槽;同步 handCount;source/target 视图记录 cardIds 供前端动画。
//   - 归还由 归还暂存牌 atom 处理(由具体技能的 回合结束 after-hook 触发)。
//
// 调用约定:
//   - source: 操作者(谁在选牌);target: 牌主(被移出的牌归谁)。
//     谦逊 source===target(自己选自己的牌);破军 source≠target(徐盛选目标牌)。
//   - varsKey: 暂存键名,由调用方技能自行定义(如 '界破军/移出'),归还方须用同一键。
import type { AtomDefinition, Card, EquipSlot, GameView, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 移出至暂存区: AtomDefinition<{
  source: number;
  target: number;
  cardIds: string[];
  varsKey: string;
}> = {
  type: '移出至暂存区',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    if (typeof atom.varsKey !== 'string' || atom.varsKey.length === 0) return `varsKey 不能为空`;
    if (!Array.isArray(atom.cardIds) || atom.cardIds.length === 0) return `cardIds 不能为空`;
    const target = state.players[atom.target];
    const equipValues = new Set(
      Object.values(target.equipment).filter((id): id is string => !!id),
    );
    for (const id of atom.cardIds) {
      if (!target.hand.includes(id) && !equipValues.has(id)) {
        return `card ${id} not in target ${atom.target} hand or equipment`;
      }
    }
    if (new Set(atom.cardIds).size !== atom.cardIds.length) return `cardIds 不能重复`;
    return null;
  },
  apply(state, atom) {
    const target = state.players[atom.target];
    const removeSet = new Set(atom.cardIds);
    // 手牌移除
    target.hand = target.hand.filter((id) => !removeSet.has(id));
    // 装备区移除(逐槽检查)
    for (const slot of Object.keys(target.equipment) as EquipSlot[]) {
      const id = target.equipment[slot];
      if (id && removeSet.has(id)) {
        delete target.equipment[slot];
        // 武器:清距离 vars(与 卸下 atom 一致)
        if (slot === '武器') {
          delete target.vars['距离/出杀范围'];
        }
      }
    }
    // 追加到 vars[varsKey]
    const list = (target.vars[atom.varsKey] as string[] | undefined) ?? [];
    for (const id of atom.cardIds) {
      if (!list.includes(id)) list.push(id);
    }
    target.vars[atom.varsKey] = list;
  },
  effect: { sound: 'discard', animation: 'slide', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    const target = state.players[atom.target];
    const cards: Card[] = atom.cardIds
      .map((id) => state.cardMap[id])
      .filter((c): c is Card => !!c);
    const cardInfos = cards.map((c) => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank }));
    // 区分手牌/装备(装备公开,所有人可见 cardId;手牌仅 target/source 可见)
    const equipSlotOf = (id: string): EquipSlot | undefined => {
      for (const slot of Object.keys(target.equipment) as EquipSlot[]) {
        if (target.equipment[slot] === id) return slot;
      }
      return undefined;
    };
    const handIds: string[] = [];
    const equipEntries: Array<{ slot: EquipSlot; cardId: string }> = [];
    for (const id of atom.cardIds) {
      const slot = equipSlotOf(id);
      if (slot) equipEntries.push({ slot, cardId: id });
      else handIds.push(id);
    }
    // source 与 target 视角:看到所有 cardIds + 牌面
    const privView: ViewEvent = {
      type: '移出至暂存区',
      source: atom.source,
      target: atom.target,
      cardIds: atom.cardIds,
      cards: cardInfos,
      handIds,
      equipEntries,
    };
    // 其他人视角:手牌只见 count,装备可见 cardId+slot(公开信息)
    const othersView: ViewEvent = {
      type: '移出至暂存区',
      source: atom.source,
      target: atom.target,
      handCount: handIds.length,
      equipEntries,
    };
    return {
      ownerViews: new Map([
        [atom.source, privView],
        [atom.target, privView],
      ]),
      othersView,
    };
  },
  applyView(view: GameView, event: ViewEvent) {
    const pi = view.players.findIndex((p) => p.index === (event.target as number));
    if (pi < 0) return;
    // 手牌:handCount 减
    const handIds = event.handIds as string[] | undefined;
    const handCount = handIds
      ? handIds.length
      : ((event.handCount as number) ?? 0);
    if (handCount > 0) {
      view.players[pi].handCount = Math.max(0, view.players[pi].handCount - handCount);
    }
    // 手牌:owner 视图按 cardIds 精确移除(若 handIds 提供)
    if (handIds && view.players[pi].hand) {
      const removeSet = new Set(handIds);
      view.players[pi].hand = view.players[pi].hand.filter((c: Card) => !removeSet.has(c.id));
    }
    // 装备槽:清除
    const equipEntries = event.equipEntries as
      | Array<{ slot: EquipSlot; cardId: string }>
      | undefined;
    if (equipEntries) {
      for (const e of equipEntries) {
        delete view.players[pi].equipment[e.slot];
        // 武器:同步清 distanceVars.attackRange(与 卸下 atom applyView 一致)
        if (e.slot === '武器' && view.players[pi].distanceVars) {
          view.players[pi].distanceVars = {
            ...view.players[pi].distanceVars,
            attackRange: undefined,
          };
        }
      }
    }
  },
  toViewLog(event) {
    const handCount = ((event.handIds as unknown[] | undefined)?.length) ??
      (event.handCount as number) ??
      0;
    const equipCount = (event.equipEntries as unknown[] | undefined)?.length ?? 0;
    const total = handCount + equipCount;
    return {
      player: event.source as number,
      text: `将 P${event.target as number} 的 ${total} 张牌移出游戏(手牌${handCount} 装备${equipCount})`,
    };
  },
};

registerAtom(移出至暂存区);
