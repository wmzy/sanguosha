// @ts-nocheck
import type { GameAction, GameState } from '../types';
import type { Operation, OperationType } from '../../shared/log';

function describeAction(action: GameAction, state: GameState): { type: OperationType; description: string; data: unknown } {
  const p = (action as { player?: string }).player;
  const cardId = (action as { cardId?: string }).cardId;
  const cardName = cardId ? state.cardMap[cardId]?.name : undefined;
  const target = (action as { target?: string }).target;

  switch (action.type) {
    case '开始':
      return { type: '游戏开始', description: '游戏开始', data: {} };
    case '结束回合':
      return { type: '回合变更', description: `${p} 结束回合`, data: { player: p } };
    case '打出一张牌':
      return {
        type: '出牌',
        description: `${p} 使用了${cardName ?? '一张牌'}${target ? `（目标：${target}）` : ''}`,
        data: { player: p, cardId, target },
      };
    case '弃置': {
      const cardIds = (action as { cardIds: string[] }).cardIds;
      const names = cardIds.map(id => state.cardMap[id]?.name ?? '?').join('、');
      return {
        type: '弃置',
        description: `${p} 弃了 ${cardIds.length} 张牌（${names}）`,
        data: { player: p, cardIds },
      };
    }
    case '使用技能': {
      const skillId = (action as { skillId: string }).skillId;
      return { type: '技能发动', description: `${p} 发动技能【${skillId}】`, data: { player: p, skillId } };
    }
    case '打出': {
      const cardIds = (action as { cardIds?: string[] }).cardIds;
      const rCard = cardId ?? cardIds?.[0];
      const rName = rCard ? state.cardMap[rCard]?.name : undefined;
      return { type: '出牌', description: `${p} 打出${rName ?? '一张牌'}响应`, data: { player: p, cardId: rCard } };
    }
    case '技能选择':
      return { type: '技能发动', description: `${p} 选择技能选项`, data: { player: p } };
    case '切换自动跳过无懈可击':
      return { type: '游戏开始', description: '切换自动跳过无懈可击', data: {} };
    default: {
      const t = (action as { type: string }).type;
      return { type: '阶段变更', description: `${p ?? '系统'} 执行 ${t}`, data: { player: p } };
    }
  }
}

export function actionLogToOperations(actions: GameAction[], state: GameState): Operation[] {
  return actions.map((action, i) => {
    const described = describeAction(action, state);
    return {
      seq: i + 1,
      timestamp: Date.now(),
      type: described.type,
      data: described.data,
      description: described.description,
    };
  });
}

/**
 * 接受带 seq 的 ActionLogEntry[]，生成的 Operation.seq 取自 entry.clientSeq。
 * 用于右侧操作流水：序号由客户端在 sendGameAction 时分配，更稳定。
 */
export function actionLogEntriesToOperations(
  entries: ReadonlyArray<{ action: GameAction; clientSeq: number }>,
  state: GameState,
): Operation[] {
  return entries.map((entry) => {
    const described = describeAction(entry.action, state);
    return {
      seq: entry.clientSeq,
      timestamp: Date.now(),
      type: described.type,
      data: described.data,
      description: described.description,
    };
  });
}
