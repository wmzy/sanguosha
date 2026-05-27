import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HandCards } from '../../src/components/HandCards';
import type { Card } from '../../shared/types';

const mockCards: Card[] = [
  { name: '杀', 类型: '基本牌', 子类型: '杀', 花色: '♠', 点数: '3', 描述: '' },
  { name: '闪', 类型: '基本牌', 子类型: '闪', 花色: '♥', 点数: '5', 描述: '' },
  { name: '桃', 类型: '基本牌', 子类型: '桃', 花色: '♥', 点数: '7', 描述: '' },
];

describe('HandCards', () => {
  it('显示所有手牌', () => {
    render(<HandCards 手牌={mockCards} 选中索引={null} 选择卡牌={() => {}} />);
    expect(screen.getByText('杀')).toBeInTheDocument();
    expect(screen.getByText('闪')).toBeInTheDocument();
    expect(screen.getByText('桃')).toBeInTheDocument();
  });

  it('空手牌显示提示', () => {
    render(<HandCards 手牌={[]} 选中索引={null} 选择卡牌={() => {}} />);
    expect(screen.getByText('没有手牌')).toBeInTheDocument();
  });

  it('点击卡牌调用选择回调', () => {
    const onSelect = vi.fn();
    render(<HandCards 手牌={mockCards} 选中索引={null} 选择卡牌={onSelect} />);
    fireEvent.click(screen.getByText('杀'));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('选中的卡牌有高亮样式', () => {
    const { container } = render(<HandCards 手牌={mockCards} 选中索引={0} 选择卡牌={() => {}} />);
    const cards = container.querySelectorAll('div[style]');
    // cards[0] is the outer flex container; cards[1] is the first card div
    const firstCard = cards[1] as HTMLElement;
    expect(firstCard.style.border).toContain('rgb(231, 76, 60)');
  });
});
