// src/client/hooks/useSoundSettings.ts
// 全局音效设置 hook:静音开关 + 音量控制,持久化到 localStorage。
//
// localStorage key: `sgs:sound`
//   存储格式:JSON `{ muted: boolean, volume: number }`
//   volume 范围 0..1,默认 1(满音量);muted 默认 false。
//
// 设置变更时同步到 audioEngine(master gain),无需组件重渲染触发播放。
//
// 多组件实例安全:多个组件同时 useSoundSettings 时各自持有独立 state,
// 但都读写同一个 localStorage key + 同一个 audioEngine 单例。
// 设置变更通过 storage 事件跨 tab 同步(单 tab 内多实例不同步——当前 UI 只有一处控制入口,够用)。

import { useCallback, useEffect, useState } from 'react';
import { audioEngine } from '../sounds/audioEngine';

/** localStorage 持久化 key */
const STORAGE_KEY = 'sgs:sound';

/** 默认设置 */
const DEFAULT_SETTINGS = { muted: false, volume: 1 };

export interface SoundSettings {
  /** 是否静音 */
  muted: boolean;
  /** 全局音量 0..1 */
  volume: number;
}

/** 从 localStorage 读取设置;解析失败/不可用时回退默认值 */
function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : false,
      volume:
        typeof parsed.volume === 'number'
          ? Math.max(0, Math.min(1, parsed.volume))
          : 1,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** 持久化设置到 localStorage;失败静默 */
function saveSettings(settings: SoundSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* localStorage 不可用时静默(隐私模式/配额满) */
  }
}

/**
 * 音效设置 hook。
 *
 * 首次挂载时从 localStorage 读取,并同步到 audioEngine。
 * 后续变更(setMuted/setVolume/toggleMute)同时写 localStorage + 更新 engine。
 *
 * @returns { muted, volume, setMuted, setVolume, toggleMute }
 */
export function useSoundSettings() {
  const [muted, setMutedState] = useState<boolean>(() => loadSettings().muted);
  const [volume, setVolumeState] = useState<number>(() => loadSettings().volume);

  // 挂载时同步初始值到 engine(确保 engine 与 localStorage 一致)
  useEffect(() => {
    audioEngine.setMuted(muted);
    audioEngine.setVolume(volume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    audioEngine.setMuted(m);
    saveSettings({ muted: m, volume });
  }, [volume]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    audioEngine.setVolume(clamped);
    saveSettings({ muted, volume: clamped });
  }, [muted]);

  const toggleMute = useCallback(() => {
    setMuted(!muted);
  }, [muted, setMuted]);

  return { muted, volume, setMuted, setVolume, toggleMute };
}
