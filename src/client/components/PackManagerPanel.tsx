// src/client/components/PackManagerPanel.tsx
// 资源包管理面板：列出所有已发现包，toggle 启停，刷新发现。
//
// 由 GameView 顶部「📦」按钮浮层调用。状态由 useResourcePacks 管理
// (fetch /packs/index.json + localStorage 启停)。本组件纯展示 + 事件回调。

import type { PackInfo } from '../resources/types';
import type { CSSProperties } from 'react';

export interface PackManagerPanelProps {
  packs: PackInfo[];
  onToggle: (packId: string, enabled: boolean) => void;
  onRefresh: () => void;
}

export function PackManagerPanel({ packs, onToggle, onRefresh }: PackManagerPanelProps) {
  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <h3 style={{ margin: 0 }}>资源包管理</h3>
        <button onClick={onRefresh} style={btnStyle}>重新发现</button>
      </div>
      {packs.length === 0 && <div style={{ opacity: 0.6 }}>未发现任何资源包</div>}
      {packs.map((p) => (
        <label key={p.id} style={rowStyle}>
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={(e) => onToggle(p.id, e.target.checked)}
            aria-label={p.name}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>
              {p.name}
              <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 12 }}>P{p.priority} {p.resourceCount}项</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              作者:{p.author} v{p.version}
              {p.homepage && <> <a href={p.homepage} target="_blank" rel="noreferrer" style={{ color: '#6cf' }}>[来源]</a></>}
            </div>
          </div>
        </label>
      ))}
    </div>
  );
}

const panelStyle: CSSProperties = {
  padding: 16, background: '#1a1a2e', color: '#eee', borderRadius: 8, minWidth: 320,
};
const headerStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
};
const btnStyle: CSSProperties = {
  padding: '4px 10px', background: '#333', color: '#eee', border: '1px solid #555',
  borderRadius: 4, cursor: 'pointer',
};
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
  borderBottom: '1px solid #333',
};
