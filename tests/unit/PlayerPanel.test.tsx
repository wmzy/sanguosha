import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlayerPanel } from '../../src/components/PlayerPanel';
import type { Player } from '../../shared/types';
import { 曹操 } from '../../shared/characters';

const mockPlayer: Player = {
  name: '曹操',
  角色: 曹操,
  身份: '主公',
  体力: 4,
  体力上限: 4,
  手牌: [],
  装备: {},
  存活: true,
};

describe('PlayerPanel', () => {
  it('显示角色名', () => {
    render(<PlayerPanel 玩家={mockPlayer} 是当前玩家={false} 是自己={false} />);
    expect(screen.getByText('曹操')).toBeInTheDocument();
  });

  it('显示体力', () => {
    render(<PlayerPanel 玩家={mockPlayer} 是当前玩家={false} 是自己={false} />);
    expect(screen.getByText(/体力/)).toBeInTheDocument();
  });

  it('自己视角显示身份', () => {
    render(<PlayerPanel 玩家={mockPlayer} 是当前玩家={false} 是自己={true} />);
    expect(screen.getByText(/主公/)).toBeInTheDocument();
  });

  it('他人视角隐藏身份', () => {
    render(<PlayerPanel 玩家={mockPlayer} 是当前玩家={false} 是自己={false} />);
    expect(screen.getByText(/\?\?\?/)).toBeInTheDocument();
  });

  it('当前玩家有高亮边框', () => {
    const { container } = render(<PlayerPanel 玩家={mockPlayer} 是当前玩家={true} 是自己={false} />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.border).toContain('rgb(231, 76, 60)');
  });

  it('死亡玩家有半透明效果', () => {
    const deadPlayer = { ...mockPlayer, 存活: false, 体力: 0 };
    const { container } = render(<PlayerPanel 玩家={deadPlayer} 是当前玩家={false} 是自己={false} />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.opacity).toBe('0.5');
  });
});
