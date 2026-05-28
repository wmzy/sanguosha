import { useState, useCallback, useRef } from 'react';
import type { GameState } from '../../shared/types';
import { createGame, startGame, getCurrentPlayer } from '../../engine/state';
import { nextPhase, drawPhase, checkDiscard, executeDiscard } from '../../engine/turn';
import {
  playKill, playPeach,
  playDismantle, playSteal, playDrawTwo,
  playArrowBarrage, playBarbarianInvasion, playPeachGarden,
} from '../../engine/effect';
import { GameLogger } from '../../engine/logger';
import { 曹操, 刘备 } from '../../shared/characters';
import type { Operation } from '../../shared/log';
import { saveLog } from '../utils/logFile';

function advanceToPlayPhase(game: GameState, logger: InstanceType<typeof GameLogger>): GameState {
  let state = game;
  // 自动跳过准备和判定阶段，摸牌阶段自动摸牌
  while (state.phase !== '出牌') {
    if (state.phase === '摸牌') {
      const result = drawPhase(state, logger);
      state = result.status;
    }
    state = nextPhase(state, logger);
  }
  return state;
}

export function useGame() {
  const loggerRef = useRef<GameLogger | null>(null);
  if (!loggerRef.current) {
    loggerRef.current = new GameLogger({
      version: '1.0.0',
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['曹操', '刘备'],
      seed: Date.now(),
    });
  }
  const logger = loggerRef.current;

  const initRef = useRef(false);
  const [playerOps, setPlayerOps] = useState<Operation[]>([]);

  const [game, setGame] = useState<GameState>(() => {
    if (initRef.current) {
      // StrictMode double-init: return a dummy, will be overwritten
      return createGame([曹操, 刘备]);
    }
    initRef.current = true;
    const initial = createGame([曹操, 刘备]);
    const started = startGame(initial, logger);
    const advanced = advanceToPlayPhase(started, logger);
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
    return advanced;
  });

  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const updateOps = useCallback(() => {
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
  }, [logger]);

  const currentPlayer = getCurrentPlayer(game);
  const me = game.players.find(p => p.name === '曹操')!;

  const handleSaveLog = useCallback(() => {
    saveLog(logger.export());
  }, [logger]);

  const isMyTurn = game.currentPlayer === '曹操';

  // 判断选中的牌是否需要选择目标
  const needsTarget = useCallback((cardName: string): boolean => {
    return ['杀', '过河拆桥', '顺手牵羊', '决斗'].includes(cardName);
  }, []);

  // 判断选中的牌是否可以主动使用
  const isPlayable = useCallback((card: typeof me.hand[0]): boolean => {
    if (card.name === '杀') return true; // 需要目标，但可以出
    if (card.name === '桃') return me.health < me.maxHealth; // 满血不能用
    if (card.name === '闪') return false; // 响应牌，不能主动出
    if (card.name === '无懈可击') return false; // 响应牌
    if (card.subtype === '武器' || card.subtype === '防具' || card.subtype === '进攻马' || card.subtype === '防御马') return true;
    if (['过河拆桥', '顺手牵羊', '无中生有', '决斗', '万箭齐发', '南蛮入侵', '桃园结义', '五谷丰登'].includes(card.name)) return true;
    return false;
  }, [me.health, me.maxHealth]);

  // 当前选中的牌是否可以出
  const canPlay = selectedCard !== null && isMyTurn && game.phase === '出牌' && (() => {
    const card = me.hand[selectedCard];
    if (!card) return false;
    if (!isPlayable(card)) return false;
    if (needsTarget(card.name) && !selectedTarget) return false;
    return true;
  })();

  const handlePlayCard = useCallback(() => {
    if (selectedCard === null || !isMyTurn) return;

    const card = me.hand[selectedCard];
    if (!card || !isPlayable(card)) return;

    let newGame = game;
    let success = false;

    if (card.name === '杀') {
      const target = selectedTarget || game.players.find(p => p.name !== me.name && p.alive)?.name;
      if (target) {
        const result = playKill(game, me.name, target, logger);
        if (result.success) {
          newGame = result.status;
          success = true;
        }
      }
    } else if (card.name === '桃') {
      const result = playPeach(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.subtype === '武器' || card.subtype === '防具' || card.subtype === '进攻马' || card.subtype === '防御马') {
      success = true;
      const equipmentUpdate = { ...me.equipment };
      if (card.subtype === '武器') equipmentUpdate.weapon = card;
      else if (card.subtype === '防具') equipmentUpdate.armor = card;
      else if (card.subtype === '进攻马') equipmentUpdate.horseMinus = card;
      else if (card.subtype === '防御马') equipmentUpdate.horsePlus = card;

      newGame = {
        ...game,
        players: game.players.map(p =>
          p.name === me.name ? { ...p, equipment: equipmentUpdate } : p,
        ),
      };
      logger.logServerOp('equip', { player: me.name, card: card.name }, `${me.name} 装备了 ${card.name}`);
      logger.logPlayerOp(me.name, 'equip', { player: me.name, card: card.name }, `你装备了 ${card.name}`);
    } else if (card.name === '过河拆桥') {
      const target = selectedTarget || game.players.find(p => p.name !== me.name && p.alive && p.hand.length > 0)?.name;
      if (target) {
        const result = playDismantle(game, me.name, target, logger);
        if (result.success) {
          newGame = result.status;
          success = true;
        }
      }
    } else if (card.name === '顺手牵羊') {
      const target = selectedTarget || game.players.find(p => p.name !== me.name && p.alive && p.hand.length > 0)?.name;
      if (target) {
        const result = playSteal(game, me.name, target, logger);
        if (result.success) {
          newGame = result.status;
          success = true;
        }
      }
    } else if (card.name === '无中生有') {
      const result = playDrawTwo(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '桃园结义') {
      const result = playPeachGarden(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '万箭齐发') {
      const result = playArrowBarrage(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '南蛮入侵') {
      const result = playBarbarianInvasion(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    }

    if (success) {
      const newHand = [...me.hand];
      newHand.splice(selectedCard, 1);
      setGame(prev => ({
        ...newGame,
        players: prev.players.map(p =>
          p.name === me.name ? { ...p, hand: newHand } : p,
        ),
      }));
      updateOps();
    }

    setSelectedCard(null);
    setSelectedTarget(null);
  }, [game, selectedCard, selectedTarget, me, isMyTurn, logger, updateOps, isPlayable]);

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn) return;
    let newGame = game;
    // 弃牌阶段检查
    if (newGame.phase === '弃牌') {
      const needsDiscard = checkDiscard(newGame);
      if (needsDiscard) {
        newGame = executeDiscard(newGame, [0], logger);
      }
    }
    // 推进到下一个玩家的出牌阶段
    newGame = nextPhase(newGame, logger); // 出牌 → 弃牌
    newGame = nextPhase(newGame, logger); // 弃牌 → 结束
    newGame = nextPhase(newGame, logger); // 结束 → 准备
    // 自动跳过下一个玩家的准备和判定阶段，摸牌
    newGame = advanceToPlayPhase(newGame, logger);
    setGame(newGame);
    setSelectedCard(null);
    updateOps();
  }, [game, isMyTurn, logger, updateOps]);

  const selectCard = useCallback((index: number | null) => {
    setSelectedCard(index);
    setSelectedTarget(null); // 切换卡牌时清除目标选择
  }, []);

  return {
    game,
    currentPlayer,
    me,
    isMyTurn,
    selectedCard,
    selectCard,
    selectedTarget,
    setSelectedTarget,
    canPlay,
    playerOps,
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  };
}
