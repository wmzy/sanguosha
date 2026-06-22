// src/client/components/EventOverlay.tsx
// 事件延时展示 overlay(非阻塞)。
//
// 根据 useEventPlayback 的 current event,按 event.type 渲染对应的延时动画/UI。
// pointer-events: none —— 不拦截玩家交互(非阻塞语义)。
// overlay 位于顶层(z-index 高),展示一段时间后由 playback 队列推进下一个。
//
// 渲染策略按 event.type 分发:
//   判定 → 中央大卡翻牌 + 结果
//   摸牌 → 牌堆滑入提示
//   阶段/回合切换 → 顶部/全屏横幅
//   伤害/回复/击杀 → 座位局部动效
//   出牌/拼点/延时锦囊 → 中央结算区
//
// 简化实现:统一用顶部横幅展示事件摘要 + 关键信息(花色点数/伤害值等)。
// 精细动画(翻牌/飞行/粒子)后续逐步增强,先保证"能看清发生了什么"。

import type { GameView, ViewEvent, Card } from '../../engine/types';
import type { QueuedEvent } from '../hooks/useEventPlayback';
import * as styles from './gameViewStyles';

export interface EventOverlayProps {
  /** 当前播放的事件(null = 空闲,不渲染) */
  current: QueuedEvent | null;
  view: GameView;
  perspective: number;
}

/** 安全读取 ViewEvent 的字段 */
function field<T = unknown>(event: ViewEvent, key: string): T | undefined {
  return (event as Record<string, unknown>)[key] as T | undefined;
}

/** 从 ViewEvent 提取人类可读摘要 */
function summarizeEvent(event: ViewEvent, view: GameView): { title: string; detail?: string } {
  const type = event.type;
  const playerName = (idx: number) => view.players[idx]?.name ?? `P${idx}`;
  const num = (key: string) => field<number>(event, key);
  const str = (key: string) => field<string>(event, key);
  const cardField = field<Card>(event, 'card');

  switch (type) {
    case '判定': {
      const cardStr = cardField ? `${cardField.suit}${cardField.rank} ${cardField.name}` : '';
      return { title: '判定结果', detail: cardStr };
    }
    case '摸牌': {
      const player = num('player') ?? -1;
      const count = num('count');
      const cards = field<Card[]>(event, 'cards');
      if (cards && cards.length > 0) {
        return { title: `${playerName(player)} 摸牌`, detail: cards.map(c => `${c.suit}${c.rank} ${c.name}`).join('、') };
      }
      return { title: `${playerName(player)} 摸牌`, detail: count ? `${count} 张` : undefined };
    }
    case '阶段开始':
    case '阶段结束': {
      const player = num('player') ?? -1;
      const phase = str('phase') ?? '';
      return { title: `${playerName(player)} · ${phase}阶段` };
    }
    case '回合开始': {
      const player = num('player') ?? -1;
      return { title: `${playerName(player)} 的回合` };
    }
    case '回合结束': {
      const player = num('player') ?? -1;
      return { title: `${playerName(player)} 回合结束` };
    }
    case '造成伤害': {
      const target = num('target') ?? -1;
      const amount = num('amount');
      const source = num('source') ?? -1;
      return { title: `${playerName(source)} → ${playerName(target)}`, detail: `造成 ${amount} 点伤害` };
    }
    case '回复体力': {
      const target = num('target') ?? -1;
      const amount = num('amount');
      return { title: `${playerName(target)}`, detail: `回复 ${amount} 点体力` };
    }
    case '失去体力': {
      const target = num('target') ?? -1;
      const amount = num('amount');
      return { title: `${playerName(target)}`, detail: `失去 ${amount} 点体力` };
    }
    case '击杀': {
      const player = num('player') ?? -1;
      return { title: `${playerName(player)} 阵亡` };
    }
    case '打出':
    case '弃牌': {
      const player = num('player') ?? -1;
      const cardStr = cardField ? `${cardField.suit}${cardField.rank} ${cardField.name}` : '';
      return { title: `${playerName(player)} ${type === '打出' ? '打出' : '弃置'}`, detail: cardStr };
    }
    case '拼点': {
      const initiator = num('initiator') ?? -1;
      const target = num('target') ?? -1;
      return { title: '拼点', detail: `${playerName(initiator)} vs ${playerName(target)}` };
    }
    case '添加延时锦囊': {
      const player = num('player') ?? -1;
      return { title: `${playerName(player)} 判定区`, detail: '延时锦囊生效' };
    }
    case '指定目标':
    case '成为目标': {
      const source = num('source') ?? -1;
      const target = num('target') ?? -1;
      return { title: `${playerName(source)} → ${playerName(target)}` };
    }
    default:
      return { title: type };
  }
}

export function EventOverlay({ current, view, perspective: _perspective }: EventOverlayProps) {
  if (!current) return null;
  const { title, detail } = summarizeEvent(current.event, view);
  return (
    <div
      style={{
        position: 'fixed',
        top: '18%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9000,
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.85)',
        border: '2px solid #c9a227',
        borderRadius: '12px',
        padding: '16px 32px',
        color: '#f0e6d2',
        textAlign: 'center',
        boxShadow: '0 0 24px rgba(201,162,39,0.4)',
        animation: 'fadeIn 0.2s ease-out',
        maxWidth: '80vw',
      }}
      className={styles.eventOverlay as string}
    >
      <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: detail ? '4px' : 0 }}>
        {title}
      </div>
      {detail && <div style={{ fontSize: '14px', color: '#c9a227' }}>{detail}</div>}
    </div>
  );
}
