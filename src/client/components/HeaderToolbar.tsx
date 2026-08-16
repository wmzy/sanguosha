// src/client/components/HeaderToolbar.tsx
// 顶部栏右侧工具组:自动跳过管理 + 音效控制 + 📦资源包管理 + 🐢/🐇事件动效速度 + ⌨快捷键提示。
//
// 职责:承载 GameHeader headerSlot 里与游戏 view 无关的纯 UI 工具栏。
// 性能意图:showPacks/animSpeed/packs 都是与对局状态无关的本地 UI state,
// 收敛在本组件内——点 📦 开关浮层或 🐢 切速度档只重渲染本工具组,
// 不再触发整个 GameView(座位环/手牌区等)重渲染。
//
// prefs/onToggle 经 props 由 GameView 传入,而非本组件自调 useAutoSkipPrefs:
// 该 hook 多实例 state 互不同步(storage 事件仅跨 tab 生效,同页两份实例各持独立
// state),而 GameView 持有的同一份 prefs 还要喂给 useAutoSkip(自动代发 skip)与
// AwaitingPrompt(勾选框展示),必须保持单一数据源。
//
// children:上层注入的 headerSlot 内容(debug 视角控制等)渲染在工具组左侧。

import { useState, useCallback, type ReactNode } from 'react';
import * as styles from './gameViewStyles';
import { SoundControl } from './SoundControl';
import { AutoSkipManager } from './AutoSkipManager';
import { PackManagerPanel } from './PackManagerPanel';
import { useResourcePacks } from '../hooks/useResourcePacks';
import { getAnimSpeed, setAnimSpeed, type AnimSpeed } from '../hooks/useEventPlayback';
import type { AutoSkipPrefs } from '../utils/autoSkip';

interface Props {
  /** 上层 headerSlot 注入内容,渲染在工具组左侧 */
  children?: ReactNode;
  /** 自动跳过偏好(单一数据源在 GameView 的 useAutoSkipPrefs 实例) */
  prefs: AutoSkipPrefs;
  /** 切换指定 requestType 的策略跳过开关 */
  onToggle: (requestType: string) => void;
}

/** 顶部栏右侧工具组(原 GameView headerSlot 内 toolbarGroup 的整体搬移)。 */
export function HeaderToolbar({ children, prefs, onToggle }: Props) {
  // 资源包管理:发现 + 启停(localStorage 持久化),供顶部「📦」浮层调用
  const { packs, refresh, togglePack } = useResourcePacks();
  const [showPacks, setShowPacks] = useState(false);
  // 事件动效速度档位:useEventPlayback 的 playNext 每条事件实时读 localStorage,
  // 这里持 state 仅为了按钮图标即时刷新(不向 hook 传 props)。
  const [animSpeed, setAnimSpeedState] = useState<AnimSpeed>(() => getAnimSpeed());
  const toggleAnimSpeed = useCallback(() => {
    setAnimSpeedState((s) => {
      const next = s === 'fast' ? 'normal' : 'fast';
      setAnimSpeed(next);
      return next;
    });
  }, []);

  return (
    <div className={styles.headerRight}>
      {children}
      <div className={styles.toolbarGroup}>
        <AutoSkipManager prefs={prefs} onToggle={onToggle} />
        <SoundControl />
        <button
          className={styles.toolbarBtn}
          onClick={() => setShowPacks((v) => !v)}
          title="资源包管理"
          aria-label="资源包管理"
        >
          📦
        </button>
        {/* 事件动效播放速度:点按 normal↔fast 切换;playNext 每条事件实时读档,
            当前播放中的事件不打断,下一条起生效 */}
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={toggleAnimSpeed}
          title="事件动效播放速度"
          aria-label="事件动效播放速度"
        >
          {animSpeed === 'fast' ? '🐇' : '🐢'}
        </button>
        {/* 快捷键说明:纯 title 悬停提示,无交互(不做弹窗) */}
        <button
          type="button"
          className={styles.toolbarBtn}
          title={
            '键盘快捷键：\n' +
            'Enter — 出牌 / 打出回应牌\n' +
            'Esc — 取消转化 / 取消选择\n' +
            'Space — 不回应\n' +
            'E — 结束回合\n' +
            '1-9 — 选中第 n 张手牌（自由出牌 / 回应 / 弃牌时）'
          }
          aria-label="键盘快捷键说明"
        >
          ⌨
        </button>
        {showPacks && (
          <div className={styles.packDropdown}>
            <PackManagerPanel packs={packs} onToggle={togglePack} onRefresh={refresh} />
          </div>
        )}
      </div>
    </div>
  );
}
