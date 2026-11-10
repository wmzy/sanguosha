import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Card, GameView } from '../../../engine/types';
import { CardFace } from '../CardFace';
import { CardBack } from '../CardBack';

export type FlyingTrajectoryType = 'draw' | 'play' | 'respond' | 'snatch' | 'discard';

export interface FlyingCardItem {
  id: string;
  key: string;
  type: FlyingTrajectoryType;
  card?: Card;
  cardName?: string;
  fromPos: [number, number];
  toPos: [number, number];
  createdAt: number;
}

export interface FlyingCardLayerProps {
  view: GameView;
  positions?: Record<number, number[][]>;
}

const DEFAULT_POSITIONS: Record<number, number[][]> = {
  2: [
    [50, 82],
    [50, 17],
  ],
  3: [
    [50, 82],
    [24, 17],
    [76, 17],
  ],
  4: [
    [50, 82],
    [14, 48],
    [50, 17],
    [86, 48],
  ],
  5: [
    [50, 82],
    [14, 48],
    [29, 17],
    [71, 17],
    [86, 48],
  ],
  6: [
    [32, 82],
    [14, 48],
    [29, 17],
    [71, 17],
    [86, 48],
    [68, 82],
  ],
  7: [
    [32, 82],
    [13, 48],
    [21, 17],
    [50, 17],
    [79, 17],
    [87, 48],
    [68, 82],
  ],
  8: [
    [50, 82],
    [21, 82],
    [13, 48],
    [21, 17],
    [50, 17],
    [79, 17],
    [87, 48],
    [79, 82],
  ],
};

export function FlyingCardLayer({ view, positions }: FlyingCardLayerProps) {
  const activePositions = positions ?? DEFAULT_POSITIONS;
  const [flyingCards, setFlyingCards] = useState<FlyingCardItem[]>([]);

  const prevProcessingRef = useRef<string[]>(view.zones?.processing ?? []);
  const prevLogLenRef = useRef<number>(view.log?.length ?? 0);
  const prevDeckCountRef = useRef<number>(view.zones?.deckCount ?? 0);
  const prevPlayerHandsRef = useRef<Map<number, number>>(
    new Map(view.players.map((p) => [p.index, p.handCount])),
  );
  const activeTimersRef = useRef<Set<number>>(new Set());

  // 组件卸载时清理所有正在进行的动画定时器
  useEffect(() => {
    const timers = activeTimersRef.current;
    return () => {
      for (const t of timers) {
        window.clearTimeout(t);
      }
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const newItems: FlyingCardItem[] = [];
    const playerCount = view.players.length;

    // 1. 处理区卡牌新增（出牌与响应打出）
    const currentProcessing = view.zones?.processing ?? [];
    const prevProcessing = prevProcessingRef.current;
    const newProcessingCards = currentProcessing.filter((id) => !prevProcessing.includes(id));
    prevProcessingRef.current = currentProcessing;

    if (newProcessingCards.length > 0) {
      for (const id of newProcessingCards) {
        const card = view.cardMap[id];
        let fromPlayer: number | null = null;
        let isRespond = false;

        // 优先在结算栈中寻找打出该牌的玩家
        if (view.settlementStack?.length) {
          for (let i = view.settlementStack.length - 1; i >= 0; i--) {
            const frame = view.settlementStack[i];
            if (frame?.cards?.includes(id)) {
              fromPlayer = frame.from;
              if (frame.skillId === '闪' || fromPlayer !== view.currentPlayerIndex) {
                isRespond = true;
              }
              break;
            }
          }
        }

        // 结算栈未命中时，检查最近日志
        if (fromPlayer === null) {
          const recentLogs = (view.log ?? []).slice(-6);
          for (let i = recentLogs.length - 1; i >= 0; i--) {
            const l = recentLogs[i];
            if (card && (l.text.includes(card.name) || l.text.includes(`【${card.name}】`))) {
              fromPlayer = l.player;
              if (l.text.includes('打出') || fromPlayer !== view.currentPlayerIndex) {
                isRespond = true;
              }
              break;
            }
          }
        }

        if (fromPlayer === null) {
          fromPlayer = view.currentPlayerIndex;
        }

        const fromPos = activePositions[playerCount]?.[fromPlayer] ?? [50, 82];
        const toPos: [number, number] = [50, 48];
        const type: FlyingTrajectoryType = isRespond ? 'respond' : 'play';

        newItems.push({
          id,
          key: `${id}-${type}-${Date.now()}-${Math.random()}`,
          type,
          card,
          cardName: card?.name,
          fromPos: fromPos as [number, number],
          toPos,
          createdAt: Date.now(),
        });
      }
    }

    // 2. 日志增量解析（摸牌、顺手牵羊、弃牌/拆桥）
    const currentLogs = view.log ?? [];
    const prevLen = prevLogLenRef.current;
    prevLogLenRef.current = currentLogs.length;

    let drawDetectedFromLog = false;

    if (currentLogs.length > prevLen) {
      const newEntries = currentLogs.slice(prevLen);
      for (const entry of newEntries) {
        // A. 顺手牵羊 / 从他人处获得
        const snatchMatch = /从 (.+?) 处获得(了一张牌|了 (.+))/.exec(entry.text);
        if (snatchMatch && entry.player >= 0 && entry.player < playerCount) {
          const victimName = snatchMatch[1]?.trim();
          const victim = view.players.find(
            (p) =>
              p.name === victimName ||
              p.character === victimName ||
              `P${p.index}` === victimName,
          );
          if (victim) {
            const specificCardName = snatchMatch[3]?.trim();
            const fromPos = activePositions[playerCount]?.[victim.index] ?? [50, 17];
            const toPos = activePositions[playerCount]?.[entry.player] ?? [50, 82];
            const foundCard = specificCardName
              ? Object.values(view.cardMap).find((c) => c.name === specificCardName)
              : undefined;

            newItems.push({
              id: `snatch-${entry.player}-${victim.index}-${Date.now()}`,
              key: `snatch-${entry.player}-${victim.index}-${Date.now()}-${Math.random()}`,
              type: 'snatch',
              card: foundCard,
              cardName: specificCardName,
              fromPos: fromPos as [number, number],
              toPos: toPos as [number, number],
              createdAt: Date.now(),
            });
            continue;
          }
        }

        // B. 弃置 / 过河拆桥
        const discardMatch = /弃置了 (\d+) 张牌(?:：(.+))?/.exec(entry.text);
        if (discardMatch && entry.player >= 0 && entry.player < playerCount) {
          const count = parseInt(discardMatch[1], 10) || 1;
          const names = discardMatch[2] ? discardMatch[2].split('、').map((s) => s.trim()) : [];
          const fromPos = activePositions[playerCount]?.[entry.player] ?? [50, 82];
          const toPos: [number, number] = [50, 50];

          for (let i = 0; i < count; i++) {
            const cName = names[i];
            const foundCard = cName
              ? Object.values(view.cardMap).find((c) => c.name === cName)
              : undefined;
            newItems.push({
              id: `discard-${entry.player}-${i}-${Date.now()}`,
              key: `discard-${entry.player}-${i}-${Date.now()}-${Math.random()}`,
              type: 'discard',
              card: foundCard,
              cardName: cName,
              fromPos: fromPos as [number, number],
              toPos,
              createdAt: Date.now(),
            });
          }
          continue;
        }

        // C. 摸牌
        const drawMatch = /摸了 (\d+) 张牌(?:：(.+))?/.exec(entry.text);
        if (drawMatch && entry.player >= 0 && entry.player < playerCount) {
          drawDetectedFromLog = true;
          const count = parseInt(drawMatch[1], 10) || 1;
          const names = drawMatch[2] ? drawMatch[2].split('、').map((s) => s.trim()) : [];
          const fromPos: [number, number] = [50, 50];
          const toPos = activePositions[playerCount]?.[entry.player] ?? [50, 82];

          for (let i = 0; i < count; i++) {
            const cName = names[i];
            const foundCard = cName
              ? Object.values(view.cardMap).find((c) => c.name === cName)
              : undefined;
            newItems.push({
              id: `draw-${entry.player}-${i}-${Date.now()}`,
              key: `draw-${entry.player}-${i}-${Date.now()}-${Math.random()}`,
              type: 'draw',
              card: foundCard,
              cardName: cName,
              fromPos,
              toPos: toPos as [number, number],
              createdAt: Date.now(),
            });
          }
          continue;
        }
      }
    }

    // 3. 牌堆数减少与手牌增加回退补偿检测（在无日志触发时的兜底）
    const currentDeckCount = view.zones?.deckCount ?? 0;
    const prevDeckCount = prevDeckCountRef.current;
    prevDeckCountRef.current = currentDeckCount;

    if (!drawDetectedFromLog && prevDeckCount > currentDeckCount) {
      const diff = prevDeckCount - currentDeckCount;
      for (const p of view.players) {
        const prevH = prevPlayerHandsRef.current.get(p.index) ?? p.handCount;
        if (p.handCount > prevH) {
          const count = Math.min(diff, p.handCount - prevH);
          const fromPos: [number, number] = [50, 50];
          const toPos = activePositions[playerCount]?.[p.index] ?? [50, 82];
          for (let i = 0; i < count; i++) {
            newItems.push({
              id: `draw-${p.index}-${i}-${Date.now()}`,
              key: `draw-${p.index}-${i}-${Date.now()}-${Math.random()}`,
              type: 'draw',
              fromPos,
              toPos: toPos as [number, number],
              createdAt: Date.now(),
            });
          }
        }
      }
    }

    for (const p of view.players) {
      prevPlayerHandsRef.current.set(p.index, p.handCount);
    }

    // 4. 队列更新与短时定时自动清理（独立生命周期，避免后续批次取消前续批次计时）
    if (newItems.length > 0) {
      const now = Date.now();
      setFlyingCards((prev) => {
        const active = prev.filter((item) => now - item.createdAt < 750);
        return [...active, ...newItems].slice(-24);
      });

      const timer = window.setTimeout(() => {
        activeTimersRef.current.delete(timer);
        const itemKeys = new Set(newItems.map((it) => it.key));
        setFlyingCards((prev) => prev.filter((item) => !itemKeys.has(item.key)));
      }, 600);

      activeTimersRef.current.add(timer);
    }
  }, [view, activePositions]);

  if (flyingCards.length === 0) return null;

  return (
    <div className="arena-flying-card-layer" aria-hidden="true">
      {flyingCards.map((fc) => (
        <div
          key={fc.key}
          className={`arena-flying-card arena-flying-${fc.type}`}
          data-testid="arena-flying-card"
          data-trajectory={fc.type}
          style={
            {
              '--fly-from-x': `${fc.fromPos[0]}%`,
              '--fly-from-y': `${fc.fromPos[1]}%`,
              '--fly-to-x': `${fc.toPos[0]}%`,
              '--fly-to-y': `${fc.toPos[1]}%`,
            } as CSSProperties
          }
        >
          {fc.card ? (
            <CardFace
              name={fc.card.name}
              suit={fc.card.suit}
              rank={fc.card.rank}
              damageType={fc.card.damageType}
              size="large"
            />
          ) : fc.cardName ? (
            <CardFace name={fc.cardName} size="large" />
          ) : (
            <CardBack />
          )}
        </div>
      ))}
    </div>
  );
}
