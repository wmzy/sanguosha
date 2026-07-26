// tests/client/PackManagerPanel.test.tsx
// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PackManagerPanel } from '../../src/client/components/PackManagerPanel';
import type { PackInfo } from '../../src/client/resources/types';

const makePack = (over: Partial<PackInfo> = {}): PackInfo => ({
  id: 'base', name: '基础资源包', version: '1.0.0', author: '内置',
  priority: 0, resourceCount: 10, enabled: true, ...over,
});

describe('PackManagerPanel', () => {
  it('渲染包列表', () => {
    const packs = [makePack(), makePack({ id: 'skin', name: '皮肤包', priority: 100, enabled: false })];
    render(<PackManagerPanel packs={packs} onToggle={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('基础资源包')).toBeInTheDocument();
    expect(screen.getByText('皮肤包')).toBeInTheDocument();
  });

  it('点击 checkbox 触发 onToggle', () => {
    const onToggle = vi.fn();
    render(<PackManagerPanel packs={[makePack()]} onToggle={onToggle} onRefresh={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: /基础资源包/ });
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith('base', false);
  });

  it('点击刷新按钮触发 onRefresh', () => {
    const onRefresh = vi.fn();
    render(<PackManagerPanel packs={[makePack()]} onToggle={vi.fn()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText('重新发现'));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('显示 priority 和资源数', () => {
    render(<PackManagerPanel packs={[makePack({ priority: 100, resourceCount: 25 })]} onToggle={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText(/P100/)).toBeInTheDocument();
    expect(screen.getByText(/25项/)).toBeInTheDocument();
  });
});
