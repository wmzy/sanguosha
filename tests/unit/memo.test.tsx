import { Profiler, useCallback, useState, type ProfilerOnRenderCallback } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionPanel } from '../../src/components/ActionPanel';
import { HandCards } from '../../src/components/HandCards';
import { LogPanel } from '../../src/components/LogPanel';
import { PlayerPanel, type PlayerPanelData } from '../../src/components/PlayerPanel';
import type { Card } from '../../shared/types';
import type { Operation } from '../../shared/log';

interface RenderRecord {
  phase: string;
  actualDuration: number;
  baseDuration: number;
}

function createProfilerRecorder(id: string) {
  const records: RenderRecord[] = [];
  const onRender: ProfilerOnRenderCallback = (renderId, phase, actualDuration, baseDuration) => {
    if (renderId === id) {
      records.push({ phase, actualDuration, baseDuration });
    }
  };
  return { records, onRender };
}

function makeCard(id: string, name: string): Card {
  return { id, name, type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' };
}

function makeOp(seq: number, description: string): Operation {
  return { seq, timestamp: 0, type: 'play', data: {}, description };
}

const selfPanelData: PlayerPanelData = {
  kind: 'self',
  data: {
    characterId: '曹操',
    hand: [],
    equipment: { weapon: null, armor: null, mount: null },
    health: 4,
    maxHealth: 4,
    pendingTricks: [],
    tags: [],
    vars: {},
    alive: true,
  },
};

const otherPanelData: PlayerPanelData = {
  kind: 'other',
  data: {
    characterId: '张飞',
    handCount: 2,
    equipment: { weapon: null, armor: null, mount: null },
    health: 4,
    maxHealth: 4,
    pendingTrickCount: 0,
    alive: true,
  },
};

const emptyCardMap: Record<string, never> = {};

function expectMemoWorked(records: RenderRecord[]) {
  // memo 真正生效时，update 阶段的 actualDuration 应远低于 mount 阶段。
  // 0.05ms 阈值用于过滤 memo 命中时的零耗时虚拟渲染。
  const updates = records.filter(r => r.phase === 'update');
  expect(updates.length).toBeGreaterThan(0);
  for (const update of updates) {
    expect(update.actualDuration).toBeLessThan(0.05);
  }
}

describe('React.memo 包裹验证', () => {
  it('PlayerPanel: 父 re-render 时 props 稳定 → memo 生效', () => {
    const { records, onRender } = createProfilerRecorder('PlayerPanel');

    function Parent() {
      const [tick, setTick] = useState(0);
      return (
        <div>
          <button data-testid="rerender" onClick={() => setTick(t => t + 1)}>
            rerender {tick}
          </button>
          <Profiler id="PlayerPanel" onRender={onRender}>
            <PlayerPanel
              playerName="P1"
              data={selfPanelData}
              cardMap={emptyCardMap}
              isCurrentPlayer={false}
              isSelf={true}
              role="主公"
            />
          </Profiler>
        </div>
      );
    }

    render(<Parent />);
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));

    expectMemoWorked(records);
  });

  it('PlayerPanel: data prop 引用变化时正常重新渲染', () => {
    const { records, onRender } = createProfilerRecorder('PlayerPanel');

    function Parent({ data }: { data: PlayerPanelData }) {
      return (
        <Profiler id="PlayerPanel" onRender={onRender}>
          <PlayerPanel
            playerName="P1"
            data={data}
            cardMap={emptyCardMap}
            isCurrentPlayer={false}
            isSelf={true}
            role="主公"
          />
        </Profiler>
      );
    }

    const { rerender } = render(<Parent data={selfPanelData} />);

    rerender(<Parent data={otherPanelData} />);
    const updateRecord = records[records.length - 1];
    expect(updateRecord.phase).toBe('update');
    expect(updateRecord.actualDuration).toBeGreaterThan(0.05);
  });

  it('HandCards: 父 re-render 时 props 稳定 → memo 生效', () => {
    const { records, onRender } = createProfilerRecorder('HandCards');
    const hand: Card[] = [makeCard('c1', '杀'), makeCard('c2', '闪')];

    function Parent({ hand }: { hand: Card[] }) {
      const [tick, setTick] = useState(0);
      const onSelectCard = useCallback(() => {}, []);
      return (
        <div>
          <button data-testid="rerender" onClick={() => setTick(t => t + 1)}>
            rerender {tick}
          </button>
          <Profiler id="HandCards" onRender={onRender}>
            <HandCards hand={hand} selectedIndex={null} onSelectCard={onSelectCard} />
          </Profiler>
        </div>
      );
    }

    render(<Parent hand={hand} />);
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));

    expectMemoWorked(records);
  });

  it('HandCards: hand 数组引用变化时正常重新渲染', () => {
    const { records, onRender } = createProfilerRecorder('HandCards');

    function Parent({ hand }: { hand: Card[] }) {
      const onSelectCard = useCallback(() => {}, []);
      return (
        <Profiler id="HandCards" onRender={onRender}>
          <HandCards hand={hand} selectedIndex={null} onSelectCard={onSelectCard} />
        </Profiler>
      );
    }

    const { rerender } = render(<Parent hand={[makeCard('c1', '杀')]} />);

    rerender(<Parent hand={[makeCard('c1', '杀'), makeCard('c2', '闪')]} />);
    const updateRecord = records[records.length - 1];
    expect(updateRecord.phase).toBe('update');
    expect(updateRecord.actualDuration).toBeGreaterThan(0.05);
  });

  it('ActionPanel: 父 re-render 时 props 稳定 → memo 生效', () => {
    const { records, onRender } = createProfilerRecorder('ActionPanel');

    function Parent() {
      const [tick, setTick] = useState(0);
      const onPlayCard = useCallback(() => {}, []);
      const onEndTurn = useCallback(() => {}, []);
      return (
        <div>
          <button data-testid="rerender" onClick={() => setTick(t => t + 1)}>
            rerender {tick}
          </button>
          <Profiler id="ActionPanel" onRender={onRender}>
            <ActionPanel
              canPlay={true}
              canEndTurn={true}
              onPlayCard={onPlayCard}
              onEndTurn={onEndTurn}
            />
          </Profiler>
        </div>
      );
    }

    render(<Parent />);
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));

    expectMemoWorked(records);
  });

  it('ActionPanel: canPlay 变化时正常重新渲染', () => {
    const { records, onRender } = createProfilerRecorder('ActionPanel');

    function Parent({ canPlay }: { canPlay: boolean }) {
      const onPlayCard = useCallback(() => {}, []);
      const onEndTurn = useCallback(() => {}, []);
      return (
        <Profiler id="ActionPanel" onRender={onRender}>
          <ActionPanel
            canPlay={canPlay}
            canEndTurn={true}
            onPlayCard={onPlayCard}
            onEndTurn={onEndTurn}
          />
        </Profiler>
      );
    }

    const { rerender } = render(<Parent canPlay={true} />);

    rerender(<Parent canPlay={false} />);
    const updateRecord = records[records.length - 1];
    expect(updateRecord.phase).toBe('update');
    expect(updateRecord.actualDuration).toBeGreaterThan(0.05);
  });

  it('LogPanel: 父 re-render 时 operations 引用稳定 → memo 生效', () => {
    const { records, onRender } = createProfilerRecorder('LogPanel');

    function Parent({ operations }: { operations: Operation[] }) {
      const [tick, setTick] = useState(0);
      return (
        <div>
          <button data-testid="rerender" onClick={() => setTick(t => t + 1)}>
            rerender {tick}
          </button>
          <Profiler id="LogPanel" onRender={onRender}>
            <LogPanel operations={operations} />
          </Profiler>
        </div>
      );
    }

    const operations: Operation[] = [makeOp(1, '操作 1')];

    render(<Parent operations={operations} />);
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));

    expectMemoWorked(records);
  });

  it('LogPanel: operations 引用变化时正常重新渲染', () => {
    const { records, onRender } = createProfilerRecorder('LogPanel');

    function Parent({ operations }: { operations: Operation[] }) {
      return (
        <Profiler id="LogPanel" onRender={onRender}>
          <LogPanel operations={operations} />
        </Profiler>
      );
    }

    const { rerender } = render(<Parent operations={[makeOp(1, '操作 1')]} />);

    rerender(<Parent operations={[makeOp(1, '操作 1'), makeOp(2, '操作 2')]} />);
    const updateRecord = records[records.length - 1];
    expect(updateRecord.phase).toBe('update');
    expect(updateRecord.actualDuration).toBeGreaterThan(0.05);
  });
});
