import { useState, useCallback } from 'react';
import type { GameState } from '../../shared/types';
import { 创建游戏, 开始游戏, 获取当前玩家 } from '../../engine/state';
import { 进入下一阶段, 摸牌阶段, 弃牌阶段检查, 弃牌阶段执行 } from '../../engine/turn';
import {
  useKill, usePeach,
  useDismantle, useSteal, useDrawTwo,
  useArrowBarrage, useBarbarianInvasion, usePeachGarden,
} from '../../engine/effect';
import { GameLogger } from '../../engine/logger';
import { 曹操, 刘备 } from '../../shared/characters';
import type { Operation } from '../../shared/log';
import { saveLog } from '../utils/logFile';

function advanceToPlayPhase(游戏: GameState, logger: InstanceType<typeof GameLogger>): GameState {
  let state = 游戏;
  // 自动跳过准备和判定阶段，摸牌阶段自动摸牌
  while (state.phase !== '出牌') {
    if (state.phase === '摸牌') {
      const result = 摸牌阶段(state, logger);
      state = result.status;
    }
    state = 进入下一阶段(state, logger);
  }
  return state;
}

export function useGame() {
  const [logger] = useState(() => new GameLogger({
    version: '1.0.0',
    createdAt: Date.now(),
    playerCount: 2,
    characters: ['曹操', '刘备'],
    seed: Date.now(),
  }));
  const [playerOps, setPlayerOps] = useState<Operation[]>([]);

  const [游戏, set游戏] = useState<GameState>(() => {
    const 初始 = 创建游戏([曹操, 刘备], undefined, logger);
    const started = 开始游戏(初始);
    const advanced = advanceToPlayPhase(started, logger);
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
    return advanced;
  });

  const [选中的卡牌, set选中的卡牌] = useState<number | null>(null);

  const 更新操作记录 = useCallback(() => {
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
  }, [logger]);

  const 当前玩家 = 获取当前玩家(游戏);
  const 我自己 = 游戏.players.find(p => p.name === '曹操')!;

  const handleSaveLog = useCallback(() => {
    saveLog(logger.export());
  }, [logger]);

  const 是我的回合 = 游戏.currentPlayer === '曹操';

  const 处理出牌 = useCallback(() => {
    if (选中的卡牌 === null || !是我的回合) return;

    const 卡牌 = 我自己.hand[选中的卡牌];
    if (!卡牌) return;

    let 新游戏 = 游戏;
    let 成功 = false;

    if (卡牌.name === '杀') {
      const 目标 = 游戏.players.find(p => p.name !== 我自己.name && p.alive);
      if (目标) {
        const 结果 = useKill(游戏, 我自己.name, 目标.name, logger);
        if (结果.success) {
          新游戏 = 结果.status;
          成功 = true;
        }
      }
    } else if (卡牌.name === '桃') {
      const 结果 = usePeach(游戏, 我自己.name, logger);
      if (结果.success) {
        新游戏 = 结果.status;
        成功 = true;
      }
    } else if (卡牌.subtype === '武器' || 卡牌.subtype === '防具' || 卡牌.subtype === '进攻马' || 卡牌.subtype === '防御马') {
      成功 = true;
      const 装备更新 = { ...我自己.equipment };
      if (卡牌.subtype === '武器') 装备更新.weapon = 卡牌;
      else if (卡牌.subtype === '防具') 装备更新.armor = 卡牌;
      else if (卡牌.subtype === '进攻马') 装备更新.horseMinus = 卡牌;
      else if (卡牌.subtype === '防御马') 装备更新.horsePlus = 卡牌;

      新游戏 = {
        ...游戏,
        players: 游戏.players.map(p =>
          p.name === 我自己.name ? { ...p, equipment: 装备更新 } : p,
        ),
      };
      logger.logServerOp('equip', { player: 我自己.name, card: 卡牌.name }, `${我自己.name} 装备了 ${卡牌.name}`);
      logger.logPlayerOp(我自己.name, 'equip', { player: 我自己.name, card: 卡牌.name }, `你装备了 ${卡牌.name}`);
    } else if (卡牌.name === '过河拆桥') {
      const 目标 = 游戏.players.find(p => p.name !== 我自己.name && p.alive && p.hand.length > 0);
      if (目标) {
        const 结果 = useDismantle(游戏, 我自己.name, 目标.name, logger);
        if (结果.success) {
          新游戏 = 结果.status;
          成功 = true;
        }
      }
    } else if (卡牌.name === '顺手牵羊') {
      const 目标 = 游戏.players.find(p => p.name !== 我自己.name && p.alive && p.hand.length > 0);
      if (目标) {
        const 结果 = useSteal(游戏, 我自己.name, 目标.name, logger);
        if (结果.success) {
          新游戏 = 结果.status;
          成功 = true;
        }
      }
    } else if (卡牌.name === '无中生有') {
      const 结果 = useDrawTwo(游戏, 我自己.name, logger);
      if (结果.success) {
        新游戏 = 结果.status;
        成功 = true;
      }
    } else if (卡牌.name === '桃园结义') {
      const 结果 = usePeachGarden(游戏, 我自己.name, logger);
      if (结果.success) {
        新游戏 = 结果.status;
        成功 = true;
      }
    } else if (卡牌.name === '万箭齐发') {
      const 结果 = useArrowBarrage(游戏, 我自己.name, logger);
      if (结果.success) {
        新游戏 = 结果.status;
        成功 = true;
      }
    } else if (卡牌.name === '南蛮入侵') {
      const 结果 = useBarbarianInvasion(游戏, 我自己.name, logger);
      if (结果.success) {
        新游戏 = 结果.status;
        成功 = true;
      }
    }

    if (成功) {
      const 新手牌 = [...我自己.hand];
      新手牌.splice(选中的卡牌, 1);
      set游戏(prev => ({
        ...新游戏,
        players: prev.players.map(p =>
          p.name === 我自己.name ? { ...p, hand: 新手牌 } : p,
        ),
      }));
      更新操作记录();
    }

    set选中的卡牌(null);
  }, [游戏, 选中的卡牌, 我自己, 是我的回合, logger, 更新操作记录]);

  const 处理结束回合 = useCallback(() => {
    if (!是我的回合) return;
    let 新游戏 = 游戏;
    // 弃牌阶段检查
    if (新游戏.phase === '弃牌') {
      const 需要弃牌 = 弃牌阶段检查(新游戏);
      if (需要弃牌) {
        新游戏 = 弃牌阶段执行(新游戏, [0], logger);
      }
    }
    // 推进到下一个玩家的出牌阶段
    新游戏 = 进入下一阶段(新游戏, logger); // 出牌 → 弃牌
    新游戏 = 进入下一阶段(新游戏, logger); // 弃牌 → 结束
    新游戏 = 进入下一阶段(新游戏, logger); // 结束 → 准备
    // 自动跳过下一个玩家的准备和判定阶段，摸牌
    新游戏 = advanceToPlayPhase(新游戏, logger);
    set游戏(新游戏);
    set选中的卡牌(null);
    更新操作记录();
  }, [游戏, 是我的回合, logger, 更新操作记录]);

  return {
    游戏,
    当前玩家,
    我自己,
    是我的回合,
    选中的卡牌,
    set选中的卡牌,
    playerOps,
    处理出牌,
    处理结束回合,
    handleSaveLog,
  };
}
