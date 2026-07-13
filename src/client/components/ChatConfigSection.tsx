// src/client/components/ChatConfigSection.tsx — 聊天配置子面板
//
// 在房间配置/等待大厅中显示，供房主设置聊天行为。
// 包括：开关、白名单模式、每局/每分钟/字数限制、白名单编辑。

import { useState, useCallback } from 'react';
import { css, cx } from '@linaria/core';
import type { ChatConfig } from '../../server/protocol';
import { DEFAULT_CHAT_WHITELIST } from '../../server/protocol';
import { colors } from '../theme';

interface ChatConfigSectionProps {
  config: ChatConfig;
  onChange: (config: ChatConfig) => void;
}

const section = css`
  border: 1px solid #445;
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 16px;
  background-color: rgba(0, 0, 0, 0.15);
`;

const sectionTitle = css`
  font-size: 14px;
  font-weight: bold;
  color: ${colors.accent.gold};
  margin-bottom: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const configRow = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  color: ${colors.text.secondary};
`;

const configLabel = css`
  color: ${colors.text.secondary};
`;

const toggle = css`
  position: relative;
  width: 36px;
  height: 20px;
  background-color: ${colors.disabled};
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.2s;
  flex-shrink: 0;

  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }
`;

const toggleOn = css`
  background-color: ${colors.accent.green};

  &::after {
    transform: translateX(16px);
  }
`;

const numberInput = css`
  width: 60px;
  padding: 4px 8px;
  background-color: ${colors.bg.input};
  border: 1px solid #445;
  border-radius: 4px;
  color: ${colors.text.input};
  font-size: 13px;
  text-align: center;
`;

const whitelistEditor = css`
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 30px;
  padding: 6px;
  background-color: ${colors.bg.input};
  border-radius: 6px;
`;

const whitelistChip = css`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px 2px 8px;
  font-size: 12px;
  background-color: rgba(52, 152, 219, 0.2);
  border: 1px solid #456;
  border-radius: 10px;
  color: ${colors.text.secondary};
`;

const whitelistRemoveBtn = css`
  background: none;
  border: none;
  color: ${colors.accent.red};
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
`;

const whitelistAddRow = css`
  display: flex;
  gap: 6px;
  margin-top: 6px;
`;

const whitelistInput = css`
  flex: 1;
  padding: 4px 8px;
  background-color: ${colors.bg.input};
  border: 1px solid #445;
  border-radius: 4px;
  color: ${colors.text.input};
  font-size: 12px;
`;

const whitelistAddBtn = css`
  padding: 4px 12px;
  background-color: ${colors.accent.blue};
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
`;

const resetBtn = css`
  margin-top: 6px;
  padding: 2px 8px;
  background-color: transparent;
  color: ${colors.text.muted};
  border: 1px solid #445;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
`;

const collapsibleBody = css`
  overflow: hidden;
`;

const hint = css`
  font-size: 11px;
  color: ${colors.text.muted};
  margin-top: 4px;
`;

export function ChatConfigSection({ config, onChange }: ChatConfigSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [newPhrase, setNewPhrase] = useState('');

  const update = useCallback(
    <K extends keyof ChatConfig>(key: K, value: ChatConfig[K]) => {
      onChange({ ...config, [key]: value });
    },
    [config, onChange],
  );

  const handleAddPhrase = useCallback(() => {
    const trimmed = newPhrase.trim().slice(0, 50);
    if (trimmed && !config.whitelist.includes(trimmed)) {
      update('whitelist', [...config.whitelist, trimmed]);
    }
    setNewPhrase('');
  }, [newPhrase, config.whitelist, update]);

  const handleRemovePhrase = useCallback(
    (phrase: string) => {
      update(
        'whitelist',
        config.whitelist.filter((p) => p !== phrase),
      );
    },
    [config.whitelist, update],
  );

  const handleResetWhitelist = useCallback(() => {
    update('whitelist', [...DEFAULT_CHAT_WHITELIST]);
  }, [update]);

  return (
    <div className={section}>
      <div className={sectionTitle} onClick={() => setExpanded((e) => !e)}>
        <span>{expanded ? '▼' : '▶'}</span>
        <span>💬 聊天设置</span>
        <span style={{ fontSize: '11px', color: config.enabled ? colors.accent.green : colors.text.muted, marginLeft: 'auto' }}>
          {config.enabled ? (config.whitelistOnly ? '白名单模式' : '自由模式') : '已关闭'}
        </span>
      </div>

      {expanded && (
        <div className={collapsibleBody}>
          <div className={configRow}>
            <span className={configLabel}>开启聊天</span>
            <span
              className={cx(toggle, config.enabled && toggleOn)}
              onClick={() => update('enabled', !config.enabled)}
            />
          </div>

          {config.enabled && (
            <>
              <div className={configRow}>
                <span className={configLabel}>
                  白名单模式
                  <span className={hint} style={{ display: 'block' }}>
                    仅能发送预设短语，增加暗示/欺骗策略
                  </span>
                </span>
                <span
                  className={cx(toggle, config.whitelistOnly && toggleOn)}
                  onClick={() => update('whitelistOnly', !config.whitelistOnly)}
                />
              </div>

              <div className={configRow}>
                <span className={configLabel}>每局最多消息 (0=无限)</span>
                <input
                  className={numberInput}
                  type="number"
                  min={0}
                  max={999}
                  value={config.maxPerGame}
                  onChange={(e) => update('maxPerGame', Math.min(Math.max(Number(e.target.value) || 0, 0), 999))}
                />
              </div>

              <div className={configRow}>
                <span className={configLabel}>每分钟最多消息 (0=无限)</span>
                <input
                  className={numberInput}
                  type="number"
                  min={0}
                  max={999}
                  value={config.maxPerMinute}
                  onChange={(e) => update('maxPerMinute', Math.min(Math.max(Number(e.target.value) || 0, 0), 999))}
                />
              </div>

              <div className={configRow}>
                <span className={configLabel}>每条消息字数 (0=无限)</span>
                <input
                  className={numberInput}
                  type="number"
                  min={0}
                  max={200}
                  value={config.maxChars}
                  onChange={(e) => update('maxChars', Math.min(Math.max(Number(e.target.value) || 0, 0), 200))}
                />
              </div>

              {config.whitelistOnly && (
                <>
                  <div className={configLabel} style={{ marginTop: '10px' }}>白名单短语：</div>
                  <div className={whitelistEditor}>
                    {config.whitelist.length === 0 && (
                      <span className={hint} style={{ padding: '4px' }}>暂无短语</span>
                    )}
                    {config.whitelist.map((phrase) => (
                      <span key={phrase} className={whitelistChip}>
                        {phrase}
                        <button
                          className={whitelistRemoveBtn}
                          onClick={() => handleRemovePhrase(phrase)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className={whitelistAddRow}>
                    <input
                      className={whitelistInput}
                      type="text"
                      value={newPhrase}
                      maxLength={50}
                      placeholder="输入新短语…"
                      onChange={(e) => setNewPhrase(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddPhrase();
                      }}
                    />
                    <button className={whitelistAddBtn} onClick={handleAddPhrase}>
                      添加
                    </button>
                  </div>
                  <button className={resetBtn} onClick={handleResetWhitelist}>
                    重置默认短语
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
