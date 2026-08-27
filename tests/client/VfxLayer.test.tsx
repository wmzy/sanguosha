// @vitest-environment jsdom
// VfxLayer 特效渲染层测试。
// 来源:修复"吃桃展示了杀的特效"——根因是 useVfxPlayback 的 items 为累积式
// （每批新 vfx 追加,从不缩减),而 VfxLayer 每次 items 变化都把整个数组并入 active,
// 导致历史特效被重复播放(出杀后吃桃,杀的特效再次触发)。
// 归并建议:此文件是特效渲染层(VfxLayer + useVfxPlayback)的测试基座,
//   后续特效播放/回收/格式选择/目标定位相关回归均应追加到此处,勿再为单个 bug 新建孤岛文件。
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, renderHook } from '@testing-library/react';
import { VfxLayer } from '@/components/VfxLayer';
import { useVfxPlayback } from '@/hooks/useVfxPlayback';
import type { VfxPlaybackItem } from '@/hooks/useVfxPlayback';
import type { GameView } from '../../src/engine/types';
import { resourceManager } from '@/resources';

// 资源 mock 说明:不用 vi.mock('@/resources')。isolate:false 下所有测试文件共享
// worker 模块缓存,若其它 client 测试先真实加载了 '@/resources',本文件的模块工厂
// mock 对已缓存的 useVfxPlayback(闭包持有真实单例)不再生效 → 偶发失败。
// 改为 spyOn 单例方法:对象属性修改对所有持有引用者可见,与模块加载顺序无关。
// (restoreMocks:true 每个测试前自动还原,故在 beforeEach 中重新 spy。)

/** 让 useVfxPlayback 对所有 anim/* id 返回固定 url,无需真实资源。 */
function spyResourceManager(): void {
  vi.spyOn(resourceManager, 'get').mockImplementation(
    (id: string) =>
      typeof id === 'string' && id.startsWith('anim/') ? `/fake${id.slice(5)}.apng` : null,
  );
}

/** 最小化 view:VfxLayer 仅用 view.players 查座次 DOM。无目标动效不查 DOM。 */
function makeView(players: { index: number; name: string }[] = []): GameView {
  return { players } as unknown as GameView;
}

afterEach(cleanup);

describe('VfxLayer', () => {
  // VfxLayer 根已改为 createPortal(document.body) 挂载(脱离 GameViewScaler 的
  // transform 祖先,fixed+视口坐标天然对齐),渲染产物不在 render() 的 container
  // 内,统一改查 document.body;cleanup 卸载组件时 portal 子树一并从 body 移除。
  it('items 累积时不重复播放已处理的特效(出杀后吃桃,杀不再次触发)', () => {
    const slash: VfxPlaybackItem = { key: '1-card/slash_red', url: '/slash.apng' };
    const peach: VfxPlaybackItem = { key: '2-card/peach', url: '/peach.apng' };
    const view = makeView();

    const { rerender } = render(<VfxLayer items={[slash]} view={view} />);
    // 首批:1 个特效 → 1 个 APNG <img>(挂在 document.body 的 portal 根下)
    expect(document.body.querySelectorAll('img')).toHaveLength(1);

    // 第二批:useVfxPlayback 累积式返回 [slash, peach],仅 peach 是新增。
    // 修复前会把整个数组并入 active,导致杀的特效重复(3 个 img);修复后只新增 peach(2 个 img)。
    rerender(<VfxLayer items={[slash, peach]} view={view} />);
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
  });

  it('单批次多个特效全部播放', () => {
    const items: VfxPlaybackItem[] = [
      { key: '1-card/slash_red', url: '/slash.apng' },
      { key: '2-card/peach', url: '/peach.apng' },
    ];
    render(<VfxLayer items={items} view={makeView()} />);
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
  });

  it('有目标的动效定位到对应座次中心(伤害特效落在受伤武将卡上)', () => {
    const view = makeView([{ index: 1, name: '张角' }]);
    // 模拟座次 DOM:findSeatEl 查 [data-player-name="张角"]。
    const seat = document.createElement('div');
    seat.setAttribute('data-player-name', '张角');
    seat.getBoundingClientRect = () =>
      ({ left: 100, top: 200, width: 120, height: 160, right: 220, bottom: 360, x: 100, y: 200, toJSON: () => ({}) });
    document.body.appendChild(seat);

    const item: VfxPlaybackItem = { key: '1-card/damage', url: '/damage.apng', target: 1 };
    const { unmount } = render(<VfxLayer items={[item]} view={view} />);

    // APNG <img> 的父级是 VfxSlot 定位槽,应落在座次中心(160, 280)。
    const slot = document.body.querySelector('img')?.parentElement;
    expect(slot?.style.position).toBe('absolute');
    expect(slot?.style.left).toBe('160px');
    expect(slot?.style.top).toBe('280px');

    unmount();
    seat.remove();
  });

  it('无目标的动效居中播放(left/top = 50%)', () => {
    const item: VfxPlaybackItem = { key: '1-misc/turn', url: '/turn.apng' };
    render(<VfxLayer items={[item]} view={makeView()} />);
    const slot = document.body.querySelector('img')?.parentElement;
    expect(slot?.style.left).toBe('50%');
    expect(slot?.style.top).toBe('50%');
  });
});

describe('useVfxPlayback · target 提取优先级', () => {
  // useVfxPlayback 监听 ingested 批次,按 effect.vfx 查 resourceManager 生成 item。
  // target 提取优先级:target(伤害等) > player(自效型/判定) > source(使用牌) > undefined(居中)。
  // 使用时/打出牌时 事件只携带 source(使用者),回退到 source 让牌的特效定位到使用者武将卡。

  beforeEach(spyResourceManager);
  afterEach(cleanup);

  it('使用时事件(只有 source)回退到 source——桃/酒特效定位到使用者武将卡', () => {
    // 模拟桃使用:使用时事件携带 source=2(使用者),无 target/player。
    const ingested = [
      {
        seq: 1,
        event: {
          type: '使用时',
          source: 2,
          cardId: 'c1',
          cardName: '桃',
          effect: { vfx: 'card/peach' },
        },
      },
    ];
    const { result } = renderHook(() => useVfxPlayback(ingested as never, {}));
    expect(result.current).toHaveLength(1);
    // source 回退:桃/酒 selfTarget,使用者即目标 → target=2
    expect(result.current[0].target).toBe(2);
  });

  it('伤害事件携带 target,优先于 source/player', () => {
    // 模拟扣减体力:携带 target(受伤害者),优先于 source/player。
    const ingested = [
      {
        seq: 1,
        event: {
          type: '扣减体力',
          source: 0,
          target: 3,
          player: 1,
          amount: 1,
          effect: { vfx: 'card/damage' },
        },
      },
    ];
    const { result } = renderHook(() => useVfxPlayback(ingested as never, {}));
    expect(result.current[0].target).toBe(3);
  });

  it('无 target/player/source 的动效 target=undefined(居中)', () => {
    const ingested = [
      { seq: 1, event: { type: '回合', effect: { vfx: 'misc/turn' } } },
    ];
    const { result } = renderHook(() => useVfxPlayback(ingested as never, {}));
    expect(result.current[0].target).toBeUndefined();
  });
});
