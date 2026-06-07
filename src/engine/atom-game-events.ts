import type { GameState, Atom, GameEvent } from './types';

type DamageAtom = Extract<Atom, { type: '造成伤害' }>;
type HealAtom = Extract<Atom, { type: '回复体力' }>;

type GameEventGenerator = (state: GameState, atom: Atom) => GameEvent[];

const damageEvents: GameEventGenerator = (_state, atom) => {
  const d = atom as DamageAtom;
  const event: GameEvent = {
    type: '受到伤害',
    target: d.target as string,
    source: (d.source as string) ?? '',
    amount: d.amount as number,
    ...(d.cardId != null ? { cardId: d.cardId as string } : {}),
  };
  return [event];
};

const healEvents: GameEventGenerator = (_state, atom) => {
  const h = atom as HealAtom;
  const event: GameEvent = {
    type: '回复体力',
    target: h.target as string,
    amount: h.amount as number,
  };
  if (h.source != null) {
    (event as Record<string, unknown>).source = h.source;
  }
  return [event];
};

export const ATOM_GAME_EVENTS: Record<string, GameEventGenerator> = {
  造成伤害: damageEvents,
  回复体力: healEvents,
  // Phase events
  阶段开始: (_state, atom) => {
    const a = atom as Extract<Atom, { type: '阶段开始' }>;
    return [{ type: '阶段开始' as const, phase: a.phase as string, player: a.player as string }];
  },
  阶段结束: (_state, atom) => {
    const a = atom as Extract<Atom, { type: '阶段结束' }>;
    return [{ type: '阶段结束' as const, phase: a.phase as string, player: a.player as string }];
  },
  回合开始: (_state, atom) => {
    const a = atom as Extract<Atom, { type: '回合开始' }>;
    return [{ type: '回合开始' as const, player: a.player as string }];
  },
  // [P5-T3] 阶段 D 准备：4 个 v2 兼容占位 atom 的 GameEvent 映射
  出牌: (_state, atom) => {
    const a = atom as Extract<Atom, { type: '出牌' }>;
    const event: GameEvent = {
      type: '出牌' as const,
      player: a.player as string,
      cardId: a.cardId as string,
    };
    if (a.target != null) {
      (event as Record<string, unknown>).target = a.target;
    }
    return [event];
  },
  杀命中: (_state, atom) => {
    const a = atom as Extract<Atom, { type: '杀命中' }>;
    return [{ type: '杀命中' as const, attacker: a.attacker as string, defender: a.defender as string }];
  },
  杀被闪避: (_state, atom) => {
    const a = atom as Extract<Atom, { type: '杀被闪避' }>;
    return [{ type: '杀被闪避' as const, attacker: a.attacker as string, defender: a.defender as string }];
  },
  回合结束: (_state, atom) => {
    const a = atom as Extract<Atom, { type: '回合结束' }>;
    return [{ type: '回合结束' as const, player: a.player as string }];
  },
};
