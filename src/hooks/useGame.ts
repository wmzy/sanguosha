import { useState, useCallback } from 'react';
import type { GameState } from '../../shared/types';
import { createGame, startGame, getCurrentPlayer } from '../../engine/state';
import { nextPhase, drawPhase, checkDiscard, executeDiscard } from '../../engine/turn';
import {
  useKill, usePeach,
  useDismantle, useSteal, useDrawTwo,
  useArrowBarrage, useBarbarianInvasion, usePeachGarden,
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
  const [logger] = useState(() => new GameLogger({
    version: '1.0.0',
    createdAt: Date.now(),
    playerCount: 2,
    characters: ['曹操', '刘备'],
    seed: Date.now(),
  }));
  const [playerOps, setPlayerOps] = useState<Operation[]>([]);

  const [game, setGame] = useState<GameState>(() => {
    const initial = createGame([曹操, 刘备], undefined, logger);
    const started = startGame(initial);
    const advanced = advanceToPlayPhase(started, logger);
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
    return advanced;
  });

  const [selectedCard, setSelectedCard] = useState<number | null>(null);

  const updateOps = useCallback(() => {
    setPlayerOps(logger.export().playerOps['曹操'] ?? []);
  }, [logger]);

  const currentPlayer = getCurrentPlayer(game);
  const me = game.players.find(p => p.name === '曹操')!;

  const handleSaveLog = useCallback(() => {
    saveLog(logger.export());
  }, [logger]);

  const isMyTurn = game.currentPlayer === '曹操';

  const handlePlayCard = useCallback(() => {
    if (selectedCard === null || !isMyTurn) return;

    const card = me.hand[selectedCard];
    if (!card) return;

    let newGame = game;
    let success = false;

    if (card.name === '杀') {
      const target = game.players.find(p => p.name !== me.name && p.alive);
      if (target) {
        const result = useKill(game, me.name, target.name, logger);
        if (result.success) {
          newGame = result.status;
          success = true;
        }
      }
    } else if (card.name === '桃') {
      const result = usePeach(game, me.name, logger);
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
      const target = game.players.find(p => p.name !== me.name && p.alive && p.hand.length > 0);
      if (target) {
        const result = useDismantle(game, me.name, target.name, logger);
        if (result.success) {
          newGame = result.status;
          success = true;
        }
      }
    } else if (card.name === '顺手牵羊') {
      const target = game.players.find(p => p.name !== me.name && p.alive && p.hand.length > 0);
      if (target) {
        const result = useSteal(game, me.name, target.name, logger);
        if (result.success) {
          newGame = result.status;
          success = true;
        }
      }
    } else if (card.name === '无中生有') {
      const result = useDrawTwo(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '桃园结义') {
      const result = usePeachGarden(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '万箭齐发') {
      const result = useArrowBarrage(game, me.name, logger);
      if (result.success) {
        newGame = result.status;
        success = true;
      }
    } else if (card.name === '南蛮入侵') {
      const result = useBarbarianInvasion(game, me.name, logger);
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
  }, [game, selectedCard, me, isMyTurn, logger, updateOps]);

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

  return {
    game,
    currentPlayer,
    me,
    isMyTurn,
    selectedCard,
    setSelectedCard,
    playerOps,
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  };
}
