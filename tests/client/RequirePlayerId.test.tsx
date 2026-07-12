// @vitest-environment jsdom
// tests/client/RequirePlayerId.test.tsx
// 身份门禁组件测试:无身份时显示设置表单,设置后渲染子内容。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequirePlayerId } from '../../src/client/components/RequirePlayerId';

describe('RequirePlayerId 身份门禁', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('无身份时不渲染子内容,显示设置表单', () => {
    render(
      <RequirePlayerId>
        <div data-testid="protected">受保护内容</div>
      </RequirePlayerId>,
    );
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入昵称')).toBeInTheDocument();
    expect(screen.getByText('确认进入')).toBeInTheDocument();
  });

  it('已有身份时直接渲染子内容', () => {
    localStorage.setItem('sgs:playerId', '赵子龙');
    render(
      <RequirePlayerId>
        <div data-testid="protected">受保护内容</div>
      </RequirePlayerId>,
    );
    expect(screen.getByTestId('protected')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入昵称')).not.toBeInTheDocument();
  });

  it('输入昵称确认后渲染子内容并持久化身份', () => {
    render(
      <RequirePlayerId>
        <div data-testid="protected">受保护内容</div>
      </RequirePlayerId>,
    );
    const input = screen.getByPlaceholderText('输入昵称');
    fireEvent.change(input, { target: { value: '  孔明  ' } });
    fireEvent.click(screen.getByText('确认进入'));
    expect(screen.getByTestId('protected')).toBeInTheDocument();
    expect(localStorage.getItem('sgs:playerId')).toBe('孔明');
  });

  it('空昵称时确认按钮禁用,不进入', () => {
    render(
      <RequirePlayerId>
        <div data-testid="protected">受保护内容</div>
      </RequirePlayerId>,
    );
    const btn = screen.getByText('确认进入');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });
});
