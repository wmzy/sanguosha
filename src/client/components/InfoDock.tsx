// src/client/components/InfoDock.tsx
// 信息浮窗:把「游戏日志」+「聊天」整合到一个右下角多 tab 浮窗。
// 替代原先分别占用底层布局的 GameLog(底部 details)和 ChatPanel(独立浮窗),
// 释放页面中央空间,避免武将卡 / prompt 遮挡处理区。
//
// 设计:
//   - 右下角 fixed 浮窗,可折叠(默认展开),不占用底层布局空间。
//   - 顶部两个 tab:📜 日志 / 💬 聊天。
//     - 日志 tab 直接渲染 GameLog(view.log 已有玩家名映射)。
//     - 聊天 tab 渲染 ChatPanel 的核心(消息列表 + 输入)。
//   - 聊天配置 / 消息 / onSend 均可选:DebugLobby 不传 → 只显示日志 tab。
//
// 复用既有组件:GameLog 的渲染抽到 GameLogContent(下方),ChatPanel 的渲染保留但拆出
// ChatContent 子组件。本组件只做 tab 容器与浮窗外壳。
import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { css, cx } from '@linaria/core';
import type { GameView } from '../../engine/types';
import type { ChatConfig } from '../../server/protocol';
import type { ChatMessage } from '../headless/types';
import { colors } from '../theme';
import { formatTime as fmtGameTime } from './gameViewConstants';

interface InfoDockProps {
  /** 当前 GameView —— 用于渲染日志 */
  view: GameView;
  /** 聊天消息(可选;DebugLobby 不传则只显示日志 tab) */
  chatMessages?: ChatMessage[];
  /** 聊天配置(可选) */
  chatConfig?: ChatConfig;
  /** 发送聊天(可选) */
  onSendChat?: (text: string) => void;
  /** 当前玩家座次(用于高亮自己消息) */
  mySeatIndex?: number;
}

type TabKey = 'log' | 'chat';

const dockRoot = css`
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 9000;
  width: 340px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background-color: rgba(28, 38, 56, 0.96);
  border: 1px solid #446;
  border-radius: 10px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  font-size: 13px;
  color: ${colors.text.primary};
`;
const dockRootCollapsed = css`
  ${dockRoot}
  max-height: 40px;
`;

const tabBar = css`
  display: flex;
  align-items: stretch;
  background-color: ${colors.bg.nav};
  border-bottom: 1px solid #334;
`;

const tabBtn = css`
  flex: 1;
  padding: 8px 10px;
  cursor: pointer;
  background: transparent;
  border: none;
  color: ${colors.text.muted};
  font-size: 13px;
  font-weight: bold;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;

  &:hover {
    color: ${colors.text.primary};
  }
`;
const tabBtnActive = css`
  color: ${colors.accent.gold};
  border-bottom-color: ${colors.accent.gold};
  background: rgba(255, 215, 0, 0.06);
`;

const collapseBtn = css`
  padding: 8px 10px;
  background: transparent;
  border: none;
  color: ${colors.text.secondary};
  cursor: pointer;
  font-size: 14px;
`;

const body = css`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

// ── 日志 tab 内容 ──
const logContent = css`
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 50vh;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: #556;
    border-radius: 2px;
  }
`;
const logEmpty = css`
  color: #555;
  font-style: italic;
  text-align: center;
  padding: 20px 0;
`;
const logEntry = css`
  display: flex;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 12px;
`;
const logTime = css`
  color: #666;
  min-width: 40px;
  flex-shrink: 0;
`;
const logPlayer = css`
  color: #3498db;
  font-weight: bold;
  min-width: 40px;
  flex-shrink: 0;
`;
const logText = css`
  color: #ccc;
  word-break: break-word;
`;

// ── 聊天 tab 内容(直接复用 ChatPanel 的列表+输入样式) ──
const chatList = css`
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 120px;
  max-height: 260px;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: #556;
    border-radius: 2px;
  }
`;
const chatMsgRow = css`
  font-size: 13px;
  line-height: 1.4;
  word-break: break-word;
`;
const chatMsgRowMine = css`
  ${chatMsgRow}
  text-align: right;
  color: ${colors.accent.green};
`;
const chatMsgName = css`
  font-weight: bold;
  margin-right: 4px;
`;
const chatEmpty = css`
  color: ${colors.text.muted};
  font-size: 12px;
  text-align: center;
  padding: 20px 0;
`;
const chatInputRow = css`
  display: flex;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid #334;
`;
const chatInput = css`
  flex: 1;
  padding: 6px 10px;
  background-color: ${colors.bg.input};
  border: 1px solid #445;
  border-radius: 6px;
  color: ${colors.text.input};
  font-size: 13px;
  &:disabled {
    opacity: 0.5;
  }
`;
const chatSendBtn = css`
  padding: 6px 14px;
  background-color: ${colors.accent.blue};
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: bold;
  &:disabled {
    background-color: ${colors.disabled};
    cursor: not-allowed;
  }
`;
const chatLimitHint = css`
  font-size: 10px;
  color: ${colors.text.muted};
  padding: 0 8px 4px;
  text-align: right;
`;

function fmtChatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function LogTab({ view }: { view: GameView }) {
  return (
    <div className={logContent}>
      {view.log.length === 0 && <div className={logEmpty}>暂无记录</div>}
      {view.log
        .slice()
        .reverse()
        .map((entry, i) => {
          const isMe = entry.player === view.viewer;
          const playerView = view.players.find((p) => p.index === entry.player);
          const playerName =
            entry.player >= 0
              ? `${playerView?.name ?? `P${entry.player}`}${isMe ? '（我）' : ''}`
              : '系统';
          return (
            <div key={i} className={logEntry}>
              <span className={logTime}>{fmtGameTime(entry.time)}</span>
              <span className={logPlayer}>{playerName}</span>
              <span className={logText}>{entry.text}</span>
            </div>
          );
        })}
    </div>
  );
}

function ChatTab({
  messages,
  config,
  onSend,
  mySeatIndex,
}: {
  messages: ChatMessage[];
  config: ChatConfig | undefined;
  onSend: ((text: string) => void) | undefined;
  mySeatIndex: number | undefined;
}) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend?.(trimmed);
    setInput('');
  }, [input, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const chatEnabled = config?.enabled !== false;
  const disabled = !chatEnabled || !onSend;

  return (
    <div className={body} style={{ display: 'flex' }}>
      <div className={chatList} ref={listRef}>
        {messages.length === 0 && (
          <div className={chatEmpty}>{chatEnabled ? '暂无消息' : '聊天未开启'}</div>
        )}
        {messages.map((m, i) => {
          const mine = mySeatIndex !== undefined && m.seatIndex === mySeatIndex;
          const name =
            mySeatIndex !== undefined && m.seatIndex === mySeatIndex ? '我' : `P${m.seatIndex + 1}`;
          return (
            <div key={i} className={mine ? chatMsgRowMine : chatMsgRow}>
              <span className={chatMsgName}>{name}</span>
              <span>{m.text}</span>
              <span style={{ color: '#666', marginLeft: '6px', fontSize: '11px' }}>
                {fmtChatTime(m.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
      <div className={chatInputRow}>
        <input
          className={chatInput}
          placeholder={disabled ? '聊天未开启' : '输入消息...'}
          disabled={disabled}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className={chatSendBtn} disabled={disabled || !input.trim()} onClick={handleSend}>
          发送
        </button>
      </div>
      {config && (
        <div className={chatLimitHint}>
          {config.maxChars !== undefined ? `≤ ${config.maxChars} 字 / 条` : ''}
          {config.maxPerMinute !== undefined ? ` · ${config.maxPerMinute} 条 / 分` : ''}
        </div>
      )}
    </div>
  );
}

export const InfoDock = memo(function InfoDock({
  view,
  chatMessages,
  chatConfig,
  onSendChat,
  mySeatIndex,
}: InfoDockProps) {
  const hasChat = !!chatMessages;
  const [tab, setTab] = useState<TabKey>(hasChat ? 'chat' : 'log');
  const [collapsed, setCollapsed] = useState(false);
  // 聊天有新消息时切到 chat tab(若当前是 log tab,不切换;只在 collapsed 时展开)
  const prevMsgCountRef = useRef(chatMessages?.length ?? 0);
  useEffect(() => {
    const cur = chatMessages?.length ?? 0;
    if (cur > prevMsgCountRef.current && collapsed) {
      setCollapsed(false);
    }
    prevMsgCountRef.current = cur;
  }, [chatMessages, collapsed]);

  return (
    <div className={collapsed ? dockRootCollapsed : dockRoot}>
      <div className={tabBar}>
        <button
          className={cx(tabBtn, tab === 'log' && tabBtnActive)}
          onClick={() => {
            setTab('log');
            setCollapsed(false);
          }}
        >
          📜 日志 ({view.log.length})
        </button>
        {hasChat && (
          <button
            className={cx(tabBtn, tab === 'chat' && tabBtnActive)}
            onClick={() => {
              setTab('chat');
              setCollapsed(false);
            }}
          >
            💬 聊天 {chatMessages && chatMessages.length > 0 ? `(${chatMessages.length})` : ''}
          </button>
        )}
        <button className={collapseBtn} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? '⤢' : '⤢'}
        </button>
      </div>
      {!collapsed && (
        <div className={body}>
          {tab === 'log' ? (
            <LogTab view={view} />
          ) : (
            <ChatTab
              messages={chatMessages ?? []}
              config={chatConfig}
              onSend={onSendChat}
              mySeatIndex={mySeatIndex}
            />
          )}
        </div>
      )}
    </div>
  );
});
