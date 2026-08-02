// @vitest-environment jsdom
// tests/client/AutoSkipManager.test.tsx
// AutoSkipManager 组件契约测试:已勾选自动跳过项的列表/取消入口。
// 归并说明(AGENTS.md):AutoSkipManager 是通用客户端组件(非具体技能),独立成文件。
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AutoSkipManager } from '../../src/client/components/AutoSkipManager';

describe('AutoSkipManager', () => {
  it('无勾选 → 不渲染(返回 null)', () => {
    const { container } = render(
      <AutoSkipManager prefs={{ optInSkip: {} }} onToggle={() => {}} />,
    );
    expect(container.querySelector('[data-autoskip-dropdown]')).toBeNull();
  });

  it('仅 false 项 → 同样不渲染', () => {
    const { container } = render(
      <AutoSkipManager prefs={{ optInSkip: { 无懈可击: false } }} onToggle={() => {}} />,
    );
    expect(container.querySelector('[data-autoskip-dropdown]')).toBeNull();
  });

  it('有勾选 → 渲染 trigger 按钮 + badge 数量(只计 true 项)', () => {
    const { container } = render(
      <AutoSkipManager
        prefs={{ optInSkip: { 无懈可击: true, 杀: false, 火攻: true } }}
        onToggle={() => {}}
      />,
    );
    const trigger = container.querySelector('button[aria-label^="自动跳过管理"]');
    expect(trigger).not.toBeNull();
    // badge 数量 = 2(无懈可击 + 火攻)
    expect(trigger!.textContent).toMatch(/2/);
  });

  it('点击某项「取消」→ onToggle 收到对应 requestType', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <AutoSkipManager
        prefs={{ optInSkip: { 无懈可击: true } }}
        onToggle={onToggle}
      />,
    );
    const dropdown = container.querySelector('[data-autoskip-dropdown]')!;
    const cancelBtn = dropdown.querySelector('button') as HTMLElement;
    fireEvent.click(cancelBtn);
    expect(onToggle).toHaveBeenCalledWith('无懈可击');
  });

  it('多项 → 每项独立取消按钮,各传各自 requestType', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <AutoSkipManager
        prefs={{ optInSkip: { 无懈可击: true, 火攻: true } }}
        onToggle={onToggle}
      />,
    );
    const cancelBtns = container.querySelector('[data-autoskip-dropdown]')!.querySelectorAll('button');
    expect(cancelBtns.length).toBe(2);
    fireEvent.click(cancelBtns[1]); // 第二项(火攻)
    expect(onToggle).toHaveBeenCalledWith('火攻');
  });
});
