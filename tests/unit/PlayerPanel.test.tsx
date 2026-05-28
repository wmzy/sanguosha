import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlayerPanel } from '../../src/components/PlayerPanel';
import type { Player } from '../../shared/types';
import { 曹操 } from '../../shared/characters';

const mockPlayer: Player = {
  name: '曹操',
  character: 曹操,
  role: '主公',
  health: 4,
  maxHealth: 4,
  hand: [],
  equipment: {},
  alive: true,
};

describe('PlayerPanel', () => {
  it('显示角色名', () => {
    render(<PlayerPanel player={mockPlayer} isCurrentPlayer={false} isSelf={false} />);
    expect(screen.getByText('曹操')).toBeInTheDocument();
  });

  it('显示体力', () => {
    render(<PlayerPanel player={mockPlayer} isCurrentPlayer={false} isSelf={false} />);
    expect(screen.getByText(/health/)).toBeInTheDocument();
  });

  it('自己视角显示身份', () => {
    render(<PlayerPanel player={mockPlayer} isCurrentPlayer={false} isSelf={true} />);
    expect(screen.getByText(/主公/)).toBeInTheDocument();
  });

  it('他人视角隐藏身份', () => {
    render(<PlayerPanel player={mockPlayer} isCurrentPlayer={false} isSelf={false} />);
    expect(screen.getByText(/\?\?\?/)).toBeInTheDocument();
  });

  it('当前玩家有高亮边框', () => {
    const { container } = render(<PlayerPanel player={mockPlayer} isCurrentPlayer={true} isSelf={false} />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.border).toContain('rgb(231, 76, 60)');
  });

  it('死亡玩家有半透明效果', () => {
    const deadPlayer = { ...mockPlayer, alive: false, health: 0 };
    const { container } = render(<PlayerPanel player={deadPlayer} isCurrentPlayer={false} isSelf={false} />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.opacity).toBe('0.5');
  });
});
