// 展示结束:通知前端收起「粘性展示卡」的收尾信号,与 展示 atom 对偶。
//
// 背景:展示 atom 只广播「亮出牌面」,不携带结束时机。前端粘性展示卡此前仅在本地
// 视角提交动作(send)时消失——旁观者/回放/其他座次永远等不到本地 send;且火攻
// 「不弃/超时」路径的后续事件流中再无任何事件,前端无从推断展示交互已收尾。
//
// 设计(纯视图事件):
//   - apply/applyView: no-op。不改 state、不改持久 view(与 展示 一致)。
//   - toViewEvents:全员广播 { type:'展示结束', player, cardId }(对应刚展示的牌,
//     供未来精确匹配/日志扩展;前端当前只持一张粘性卡,无条件收起)。
//   - 无 effect(无声无动画,不进横幅队列)、无 toViewLog(不进游戏日志/历史条)——纯控制信号。
//
// 发射方:火攻(所有收尾路径,见 skills/cards/火攻.ts);其他展示类技能
// (界火计/义绝/攻心/蛊惑)按需采用同一契约。
import type { AtomDefinition, ViewEvent, ViewEventSplit } from '../types';

export const 展示结束: AtomDefinition<{ player: number; cardId: string }> = {
  type: '展示结束',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply() {
    // 纯视图事件:不改 state。
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = { type: '展示结束', player: atom.player, cardId: atom.cardId };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // no-op:无持久 view 字段。
  },
};
