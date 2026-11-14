// src/engine/atoms/回合结束.ts
// 回合结束:清空本回合临时 vars,清 turn 持续 mark
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
import { broadcast, requirePlayer } from './_helpers';
import { clearPerTurnState } from '../rules/vars-keys';

export const 回合结束: AtomDefinition<{ player: number }> = {
  type: '回合结束',
  validate(state, atom) {
    return requirePlayer(state, atom.player, 'player');
  },
  apply(state) {
    // per-turn 清理收敛于 rules/vars-keys(权威实现;博图 cancel 回合结束后 复用同一函数)
    clearPerTurnState(state);
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '回合结束',
      player: atom.player,
    };
    return broadcast(view);
  },
  effect: { sound: 'turn_end', duration: 800 },
  applyView(view: GameView) {
    // 清空本回合临时 vars(与 apply 对称)
    view.turn.vars = {};
    // 清理每个玩家 duration==='turn' 的 marks(view 侧可见)
    for (const p of view.players) {
      p.marks = p.marks.filter((m) => m.duration !== 'turn');
      // 清空本回合用量(出杀计数/限一次标记),与 apply 清 state vars 对称
      p.turnUsage = {};
    }
  },
  toViewLog(event) {
    return { player: event.player as number, text: '回合结束' };
  },
};

