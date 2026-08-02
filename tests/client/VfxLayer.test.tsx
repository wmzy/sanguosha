// @vitest-environment jsdom
// VfxLayer 特效渲染层测试。
// 来源:修复"吃桃展示了杀的特效"——根因是 useVfxPlayback 的 items 为累积式
// （每批新 vfx 追加,从不缩减),而 VfxLayer 每次 items 变化都把整个数组并入 active,
// 导致历史特效被重复播放(出杀后吃桃,杀的特效再次触发)。
// 归并建议:此文件是特效渲染层(VfxLayer + useVfxPlayback)的测试基座,
//   后续特效播放/回收/格式选择相关回归均应追加到此处,勿再为单个 bug 新建孤岛文件。
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { VfxLayer } from '@/components/VfxLayer';
import type { VfxPlaybackItem } from '@/hooks/useVfxPlayback';

afterEach(cleanup);

describe('VfxLayer', () => {
  it('items 累积时不重复播放已处理的特效(出杀后吃桃,杀不再次触发)', () => {
    const slash: VfxPlaybackItem = { key: '1-card/slash_red', url: '/slash.apng' };
    const peach: VfxPlaybackItem = { key: '2-card/peach', url: '/peach.apng' };

    const { rerender, container } = render(<VfxLayer items={[slash]} />);
    // 首批:1 个特效 → 1 个 APNG <img>
    expect(container.querySelectorAll('img')).toHaveLength(1);

    // 第二批:useVfxPlayback 累积式返回 [slash, peach],仅 peach 是新增。
    // 修复前会把整个数组并入 active,导致杀的特效重复(3 个 img);修复后只新增 peach(2 个 img)。
    rerender(<VfxLayer items={[slash, peach]} />);
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('单批次多个特效全部播放', () => {
    const items: VfxPlaybackItem[] = [
      { key: '1-card/slash_red', url: '/slash.apng' },
      { key: '2-card/peach', url: '/peach.apng' },
    ];
    const { container } = render(<VfxLayer items={items} />);
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });
});
