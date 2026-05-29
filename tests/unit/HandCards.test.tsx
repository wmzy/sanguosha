import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HandCards } from '../../src/components/HandCards';
import type { Card } from '../../shared/types';

const mockCards: Card[] = [
  { id: '杀-♠-3', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '3', description: '' },
  { id: '闪-♥-5', name: '闪', type: '基本牌', subtype: '闪', suit: '♥', rank: '5', description: '' },
  { id: '桃-♥-7', name: '桃', type: '基本牌', subtype: '桃', suit: '♥', rank: '7', description: '' },
];

describe('HandCards', () => {
  it('显示所有手牌', () => {
    render(<HandCards hand={mockCards} selectedIndex={null} onSelectCard={() => {}} />);
    expect(screen.getByText('杀')).toBeInTheDocument();
    expect(screen.getByText('闪')).toBeInTheDocument();
    expect(screen.getByText('桃')).toBeInTheDocument();
  });

  it('空手牌显示提示', () => {
    render(<HandCards hand={[]} selectedIndex={null} onSelectCard={() => {}} />);
    expect(screen.getByText('没有手牌')).toBeInTheDocument();
  });

  it('点击卡牌调用选择回调', () => {
    const onSelect = vi.fn();
    render(<HandCards hand={mockCards} selectedIndex={null} onSelectCard={onSelect} />);
    fireEvent.click(screen.getByText('杀'));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('选中的卡牌有高亮样式', () => {
    const { container } = render(<HandCards hand={mockCards} selectedIndex={0} onSelectCard={() => {}} />);
    const cards = container.querySelectorAll('div[style]');
    // cards[0] is the outer flex container; cards[1] is the first card div
    const firstCard = cards[1] as HTMLElement;
    expect(firstCard.style.border).toContain('rgb(231, 76, 60)');
  });
});
