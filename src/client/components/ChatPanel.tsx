// src/client/components/ChatPanel.tsx — 浮动聊天面板
//
// 在游戏界面右下角浮动的聊天窗口。支持折叠/展开、白名单快选、字数限制提示。
// 由 RoomConfig.chat 控制行为（是否开启、白名单模式、每局/每分钟/字数限制）。
// 通过 onSend 发送消息，messages 驱动显示。

import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { css } from '@linaria/core';
import type { ChatConfig } from '../../server/protocol';
import type { ChatMessage } from '../headless/types';
import { colors } from '../theme';

interface ChatPanelProps {
  messages: ChatMessage[];
  config: ChatConfig | undefined;
  onSend: (text: string) => void;
  /** 当前玩家座次（用于高亮自己的消息） */
  mySeatIndex: number;
}
const panelRoot = css`
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 9000;
  width: 320px;
  max-height: 400px;
  display: flex;
  flex-direction: column;
  background-color: rgba(44, 62, 80, 0.95);
  border: 1px solid #446;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  overflow: hidden;
`;

const panelRootCollapsed = css`
  ${panelRoot}
  max-height: 40px;
`;

const header = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background-color: ${colors.bg.nav};
  border-bottom: 1px solid #334;
`;

const headerTitle = css`
  font-size: 13px;
  font-weight: bold;
  color: ${colors.accent.gold};
`;

const headerIcon = css`
  font-size: 14px;
  color: ${colors.text.secondary};
`;

const messageList = css`
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

const msgRow = css`
  font-size: 13px;
  line-height: 1.4;
  word-break: break-word;
`;

const msgRowMine = css`
  ${msgRow}
  text-align: right;
  color: ${colors.accent.green};
`;

const msgName = css`
  font-weight: bold;
  margin-right: 4px;
`;

const emptyHint = css`
  font-size: 12px;
  color: ${colors.text.muted};
  text-align: center;
  padding: 20px 0;
`;

const whitelistRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #334;
  max-height: 80px;
  overflow-y: auto;
`;

const whitelistChip = css`
  padding: 2px 8px;
  font-size: 12px;
  background-color: ${colors.bg.input};
  border: 1px solid #556;
  border-radius: 12px;
  cursor: pointer;
  color: ${colors.text.secondary};

  &:hover {
    background-color: ${colors.accent.blue};
    color: white;
  }
`;

const inputRow = css`
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

const sendBtn = css`
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

const limitHint = css`
  font-size: 10px;
  color: ${colors.text.muted};
  padding: 0 8px 4px;
  text-align: right;
`;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const ChatPanel = memo(
  ({ messages, config, onSend, mySeatIndex }: ChatPanelProps) => {
    const [collapsed, setCollapsed] = useState(false);
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // 自动滚动到底部
    useEffect(() => {
      if (listRef.current && !collapsed) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    }, [messages, collapsed]);

    const handleSend = useCallback(() => {
      const trimmed = input.trim();
      if (!trimmed) return;
      onSend(trimmed);
      setInput('');
      setError(null);
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

    const handleWhitelistClick = useCallback(
      (text: string) => {
        onSend(text);
        setInput('');
        setError(null);
      },
      [onSend],
    );

    // 聊天未开启时不显示（必须在所有 hook 调用之后，遵守 Rules of Hooks）
    if (!config?.enabled) return null;

    const maxChars = config?.maxChars ?? 0;
    const overLimit = maxChars > 0 && input.length > maxChars;

    const playerLabel = (seatIndex: number) => {
      if (seatIndex === mySeatIndex) return '我';
      return `P${seatIndex + 1}`;
    };

    return (
      <div className={collapsed ? panelRootCollapsed : panelRoot}>
        <div className={header} onClick={() => setCollapsed((c) => !c)}>
          <span className={headerTitle}>
            💬 聊天 {messages.length > 0 && !collapsed && `(${messages.length})`}
          </span>
          <span className={headerIcon}>{collapsed ? '▲' : '▼'}</span>
        </div>

        {!collapsed && (
          <>
            <div className={messageList} ref={listRef}>
              {messages.length === 0 ? (
                <div className={emptyHint}>
                  {config?.whitelistOnly ? '点击下方短语发送' : '暂无消息'}
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isMine = msg.seatIndex === mySeatIndex;
                  return (
                    <div key={i} className={isMine ? msgRowMine : msgRow}>
                      <span className={msgName}>
                        {isMine ? '' : playerLabel(msg.seatIndex)}
                      </span>
                      {msg.text}
                      <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '4px' }}>
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* 白名单快捷短语 */}
            {config?.whitelistOnly && config.whitelist.length > 0 && (
              <div className={whitelistRow}>
                {config.whitelist.map((phrase, i) => (
                  <span
                    key={i}
                    className={whitelistChip}
                    onClick={() => handleWhitelistClick(phrase)}
                  >
                    {phrase}
                  </span>
                ))}
              </div>
            )}

            {/* 输入框（白名单模式下隐藏，只用快捷短语） */}
            {!config?.whitelistOnly && (
              <>
                <div className={inputRow}>
                  <input
                    className={chatInput}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={overLimit ? `超出 ${maxChars} 字限制` : '输入消息…'}
                    maxLength={maxChars > 0 ? maxChars : 200}
                  />
                  <button
                    className={sendBtn}
                    onClick={handleSend}
                    disabled={!input.trim() || overLimit}
                  >
                    发送
                  </button>
                </div>
                {maxChars > 0 && (
                  <div className={limitHint} style={{ color: overLimit ? colors.accent.red : undefined }}>
                    {input.length}/{maxChars}
                  </div>
                )}
              </>
            )}

            {error && (
              <div className={limitHint} style={{ color: colors.accent.red, textAlign: 'center' }}>
                {error}
              </div>
            )}
          </>
        )}
      </div>
    );
  },
);
