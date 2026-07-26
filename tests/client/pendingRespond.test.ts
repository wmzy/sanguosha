// resolvePendingRespond 纯函数单测。
// 覆盖:引擎投影层下发的 cardFilter.candidates 被优先用于重建 cardFilter,
// 解决技能代价弃牌(界放权/放权/据守 等 requestType 前缀为技能名而非卡名)时
// derive 兜底误推 c.name===技能名、匹配 0 张导致玩家无法弃牌的问题。
//
// 归并建议:若未来出现更多 client/utils 纯函数单测,可并入 tests/client/utils.test.ts。
import { describe, it, expect } from 'vitest';
import {
  resolvePendingRespond,
  getBroadcastKey,
} from '../../src/client/utils/pendingRespond';
import type { Card, PendingView } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';

function mkCard(id: string, name: string): Card {
  return { id, name, suit: '♠', color: suitColor('♠'), rank: 'A', type: '基本牌' };
}

/** 构造 useCard 类 pending(requestType + 可选 candidates) */
function mkUseCardPending(
  requestType: string,
  candidates: string[] | undefined,
  target = 0,
): PendingView {
  const prompt = {
    type: 'useCard' as const,
    title: '弃牌代价',
    cardFilter: { min: 1, max: 1, ...(candidates ? { candidates } : {}) },
  };
  return {
    type: 'awaits',
    atom: { type: '请求回应', requestType, target, prompt } as unknown as PendingView['atom'],
    prompt,
    target,
    isBlocking: true,
  };
}

/** 构造无懈可击广播型 pending(请求回应 + requestType='无懈可击' + cancelTarget) */
function mkWuxiePending(target: number, cancelTarget: number): PendingView {
  const prompt = {
    type: 'useCard' as const,
    title: '是否打出无懈可击?',
    cardFilter: { min: 1, max: 1 },
  };
  return {
    type: 'awaits',
    atom: {
      type: '请求回应',
      requestType: '无懈可击',
      target,
      cancelTarget,
      prompt,
    } as unknown as PendingView['atom'],
    prompt,
    target,
    isBlocking: true,
  };
}

describe('getBroadcastKey: target/cancelTarget 区分多目标询问', () => {
  it('铁索连环两个目标:仅 cancelTarget 不同 → 返回不同 key(第二个目标不再被误判已跳过)', () => {
    // 回归:旧实现只用 atomType+requestType,两次「无懈可击」广播 key 完全相同,
    // 玩家对目标1点「不回应」后,目标2的询问被误判为已跳过而隐藏。
    const p1 = mkWuxiePending(-1, 2); // 广播 target<0,cancelTarget=目标1
    const p2 = mkWuxiePending(-1, 3); // 同样广播,cancelTarget=目标2
    expect(getBroadcastKey(p1)).not.toBe(getBroadcastKey(p2));
  });

  it('同一目标 close-reopen 循环:cancelTarget 相同 → key 不变(保持去重语义,不重复弹窗)', () => {
    // 玩家对该目标说过不回应就不再被反复弹窗——这是正确行为,必须保留。
    const a = mkWuxiePending(-1, 2);
    const b = mkWuxiePending(-1, 2);
    expect(getBroadcastKey(a)).toBe(getBroadcastKey(b));
  });

  it('仅 target 不同(非广播型) → 返回不同 key', () => {
    const p1 = mkUseCardPending('杀', undefined, 1);
    const p2 = mkUseCardPending('杀', undefined, 2);
    expect(getBroadcastKey(p1)).not.toBe(getBroadcastKey(p2));
  });

  it('key 包含 atomType 与 requestType(可读性与调试性)', () => {
    const p = mkWuxiePending(-1, 2);
    const key = getBroadcastKey(p);
    expect(key).toContain('请求回应');
    expect(key).toContain('无懈可击');
    expect(key).toContain('c=2');
  });
});

describe('resolvePendingRespond: cardFilter.candidates 优先', () => {
  it('requestType 前缀为技能名(界放权/discard)+ candidates → cardFilter 按候选 id 成员判断', () => {
    // 回归:derive 兜底会推 cardName='界放权' → c.name==='界放权' 匹配 0 张。
    // 引擎投影层已注入 candidates=['c1','c2'],前端应据此重建成员判断 filter。
    const pending = mkUseCardPending('界放权/discard', ['c1', 'c2']);
    const info = resolvePendingRespond(pending, []);
    expect(info).not.toBeNull();
    expect(info!.skillId).toBe('界放权');
    const c1 = mkCard('c1', '杀');
    const c2 = mkCard('c2', '闪');
    const c3 = mkCard('c3', '杀');
    expect(info!.cardFilter?.(c1)).toBe(true);
    expect(info!.cardFilter?.(c2)).toBe(true);
    expect(info!.cardFilter?.(c3)).toBe(false); // 非 candidate
  });

  it('candidates 为空数组 → cardFilter 恒假(确无可弃,前端提示"点不回应")', () => {
    const pending = mkUseCardPending('放权/discard', []);
    const info = resolvePendingRespond(pending, []);
    expect(info).not.toBeNull();
    expect(info!.cardFilter?.(mkCard('c1', '杀'))).toBe(false);
  });

  it('无 candidates → 回退到 derive 兜底(按 requestType 前缀推 cardName)', () => {
    // 无 candidates 时行为不变:derive 推 cardName='杀' → 仅匹配 name==='杀'
    const pending = mkUseCardPending('杀/respondKill', undefined);
    const info = resolvePendingRespond(pending, []);
    expect(info).not.toBeNull();
    expect(info!.skillId).toBe('杀');
    expect(info!.cardFilter?.(mkCard('c1', '杀'))).toBe(true);
    expect(info!.cardFilter?.(mkCard('c2', '闪'))).toBe(false);
  });

  it('pending 为 null → 返回 null', () => {
    expect(resolvePendingRespond(null, [])).toBeNull();
  });
});
