import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LogPanel } from '../../src/components/LogPanel';
import type { Operation } from '../../shared/log';

const mockOps: Operation[] = [
  { seq: 0, timestamp: Date.now(), type: 'gameStart', data: {}, description: '游戏开始' },
  { seq: 1, timestamp: Date.now(), type: 'draw', data: {}, description: '曹操摸了2张牌' },
  { seq: 2, timestamp: Date.now(), type: 'damage', data: {}, description: '曹操对刘备使用杀' },
];

describe('LogPanel', () => {
  it('显示操作列表', () => {
    render(<LogPanel operations={mockOps} />);
    expect(screen.getByText(/游戏开始/)).toBeInTheDocument();
    expect(screen.getByText(/曹操摸了2张牌/)).toBeInTheDocument();
    expect(screen.getByText(/曹操对刘备使用杀/)).toBeInTheDocument();
  });

  it('空列表显示提示', () => {
    render(<LogPanel operations={[]} />);
    expect(screen.getByText('暂无操作记录')).toBeInTheDocument();
  });

  it('显示序号', () => {
    render(<LogPanel operations={mockOps} />);
    expect(screen.getByText('0.')).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
  });
});
