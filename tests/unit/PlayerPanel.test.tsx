import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlayerPanel } from '../../src/components/PlayerPanel';
import type { PlayerState } from '../../engine/types';

const mockPlayer: PlayerState = {
  info: {
    name: '曹操',
    characterId: '曹操',
    alive: true,
    gender: '男',
    role: '主公',
    faction: '魏',
  },
  health: 4,
  maxHealth: 4,
  hand: [],
  equipment: {},
  pendingTricks: [],
  vars: {},
  tags: [],
};

const emptyCardMap: Record<string, unknown> = {};

describe('PlayerPanel', () => {
  it('显示角色名', () => {
    render(<PlayerPanel playerName="曹操" player={mockPlayer} cardMap={emptyCardMap} isCurrentPlayer={false} isSelf={false} />);
    expect(screen.getByText('曹操')).toBeInTheDocument();
  });

  it('显示体力', () => {
    render(<PlayerPanel playerName="曹操" player={mockPlayer} cardMap={emptyCardMap} isCurrentPlayer={false} isSelf={false} />);
    expect(screen.getByText(/体力/)).toBeInTheDocument();
  });

  it('自己视角显示身份', () => {
    render(<PlayerPanel playerName="曹操" player={mockPlayer} cardMap={emptyCardMap} isCurrentPlayer={false} isSelf={true} />);
    expect(screen.getByText(/主公/)).toBeInTheDocument();
  });

  it('他人视角隐藏身份', () => {
    render(<PlayerPanel playerName="曹操" player={mockPlayer} cardMap={emptyCardMap} isCurrentPlayer={false} isSelf={false} />);
    expect(screen.getByText(/\?\?\?/)).toBeInTheDocument();
  });

  it('当前玩家有高亮边框', () => {
    const { container } = render(<PlayerPanel playerName="曹操" player={mockPlayer} cardMap={emptyCardMap} isCurrentPlayer={true} isSelf={false} />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.border).toContain('rgb(231, 76, 60)');
  });

  it('死亡玩家有半透明效果', () => {
    const deadPlayer: PlayerState = { ...mockPlayer, info: { ...mockPlayer.info, alive: false } };
    const { container } = render(<PlayerPanel playerName="曹操" player={deadPlayer} cardMap={emptyCardMap} isCurrentPlayer={false} isSelf={false} />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.opacity).toBe('0.5');
  });
});
