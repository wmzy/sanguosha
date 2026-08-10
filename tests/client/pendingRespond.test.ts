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
import { suitColor } from '../../src/engine/types';
import type { SkillActionDef } from '../../src/client/skillActionRegistry';

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

// ═══════════════════════════════════════════════════════════════════════
// 求桃(桃/求桃)救援路由 —— Bug2/Bug8 根因复现
//
// Bug2:血量 1 被闪电命中(3 点伤害濒死),手中有酒,不能用酒自救。
// Bug8:濒死求桃询问自己时,酒可高亮可选,但点酒后提交被拒。
//
// 根因:桃/酒是 CardEffect 型卡牌(src/engine/skills/cards/桃.ts、酒.ts),respond 定义在
// CardEffect.respond 字段,无前端 onMount → 不注册到 skillActionRegistry。故求桃特判里
// rescueActions(只含 registry 转化型救援技,如急救/界醇醪)不含字面桃/酒。
// 旧兜底 skillId='桃'(由 '桃/求桃' 取首段),rescueSkillForCard 未覆盖酒 → handleRespond
// 退回 skillId='桃' → 发到 桃:respond 带酒的 cardId → 桃 validate 拒绝(牌不是桃)。
// ═══════════════════════════════════════════════════════════════════════
describe('resolvePendingRespond: 求桃 rescue 路由(Bug2/Bug8)', () => {
  it('字面酒(自救) → rescueSkillForCard 路由到 "酒"(而非误路由到桃/undefined)', () => {
    // 引擎 candidates 已含自救酒(canRescueWith:酒仅自救)。registry 无救援 action
    // (桃/酒是 CardEffect,不在 registry)。
    const wine = mkCard('w1', '酒');
    const pending = mkUseCardPending('桃/求桃', ['w1'], 0);
    const info = resolvePendingRespond(pending, []);
    expect(info).not.toBeNull();
    expect(info!.skillId).toBe('桃'); // 求桃兜底 skillId 仍是桃
    expect(info!.cardFilter?.(wine)).toBe(true); // 酒可高亮可选
    // 关键:点酒时路由到 '酒'(酒:respond 校验通过),而非 '桃'(会被拒)
    expect(info!.rescueSkillForCard?.(wine)).toBe('酒');
  });

  it('字面桃 → rescueSkillForCard 路由到 "桃"', () => {
    const peach = mkCard('p1', '桃');
    const pending = mkUseCardPending('桃/求桃', ['p1'], 0);
    const info = resolvePendingRespond(pending, []);
    expect(info!.rescueSkillForCard?.(peach)).toBe('桃');
  });

  it('无 candidates(registry 加载窗口) → derive 兜底仍高亮桃/酒,且 rescueSkillForCard 正确路由', () => {
    const wine = mkCard('w1', '酒');
    const peach = mkCard('p1', '桃');
    const pending = mkUseCardPending('桃/求桃', undefined, 0);
    const info = resolvePendingRespond(pending, []);
    expect(info!.cardFilter?.(wine)).toBe(true);
    expect(info!.cardFilter?.(peach)).toBe(true);
    expect(info!.rescueSkillForCard?.(wine)).toBe('酒');
    expect(info!.rescueSkillForCard?.(peach)).toBe('桃');
  });

  it('转化型救援技(急救红牌)与字面桃/酒共存:各自正确路由,不互相干扰', () => {
    // 急救:华佗技能,onMount defineAction respond,respondFor='桃/求桃',filter=c.color==='红'。
    // 桃(♥/♦ 红)同时满足急救 filter,但字面桃应优先路由到 '桃'(非急救)。
    // 红色非桃非酒牌(如红杀)路由到急救。字面酒(♠/♣ 黑)路由到酒。
    const firstAid: SkillActionDef = {
      skillId: '急救',
      ownerId: 0,
      actionType: 'respond',
      label: '急救',
      style: 'primary',
      respondFor: '桃/求桃',
      prompt: {
        type: 'useCard',
        title: '急救',
        cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
      },
    };
    const wine = mkCard('w1', '酒'); // ♠ 黑
    const peach = { id: 'p1', name: '桃', suit: '♥', color: '红', rank: 'A', type: '基本牌' } as Card;
    const redSlash = { id: 'r1', name: '杀', suit: '♥', color: '红', rank: '7', type: '基本牌' } as Card;
    // candidates 仅字面桃/酒(canRescueBy 不含急救红牌);急救红牌由 transformRescue filter 补
    const pending = mkUseCardPending('桃/求桃', ['w1', 'p1'], 0);
    const info = resolvePendingRespond(pending, [firstAid]);
    // 路由:字面优先(桃→桃、酒→酒),红杀→急救
    expect(info!.rescueSkillForCard?.(wine)).toBe('酒');
    expect(info!.rescueSkillForCard?.(peach)).toBe('桃');
    expect(info!.rescueSkillForCard?.(redSlash)).toBe('急救');
    // cardFilter 并集:字面桃/酒(经 candidates) + 急救红牌(经 filter)
    expect(info!.cardFilter?.(wine)).toBe(true);
    expect(info!.cardFilter?.(peach)).toBe(true);
    expect(info!.cardFilter?.(redSlash)).toBe(true);
  });
});
