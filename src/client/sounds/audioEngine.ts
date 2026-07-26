// src/client/sounds/audioEngine.ts
// 单例音频播放引擎(Web Audio API)。
//
// 职责:
//   1. 管理 AudioContext 生命周期(延迟创建,首交后解锁)
//   2. 主音量/静音控制(通过 GainNode)
//   3. 按需加载+解码音频 buffer(带缓存,文件缺失负缓存后不再重试)
//   4. 播放单次音效(支持 per-event volume 与全局音量相乘)
//
// 设计要点:
//   - AudioContext 在浏览器自动播放策略下需用户交互后才能 resume。
//     unlock() 在首次 click/keydown 时调用,创建并 resume context。
//   - 缺失音频静默跳过:首次 fetch 失败(404/解码失败)后缓存"missing"状态,
//     后续不再发请求,console 不输出任何 error/warn(避免刷屏)。
//   - 快速连发(如一帧内多个事件)可重叠播放:每次 play 创建独立 BufferSource。
//   - 非浏览器环境(node 测试/jsdom 无 AudioContext)安全降级:所有方法 no-op。
//
// TODO(可选增强):同一事件声音单调时可加入轻微随机变调(playbackRate 抖动),
//                避免重复听感疲劳。本次不实现。

import { resolveSoundUrl } from './soundMap';

/** 单个音频 buffer 的加载状态 */
type BufferEntry =
  | { status: 'pending'; promise: Promise<AudioBuffer | null> }
  | { status: 'ok'; buffer: AudioBuffer }
  | { status: 'missing' }; // 加载失败(404/解码错误),永久跳过

/** buffer 缓存上限,超过后清空最早的(防止无限增长)。音频文件数量有限(约30个),很少触发。 */
const BUFFER_CACHE_LIMIT = 64;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /** 是否已通过用户交互解锁(AudioContext 已创建且 resume) */
  private unlocked = false;
  /** 全局音量 0..1 */
  private volume = 1;
  /** 是否静音 */
  private muted = false;
  /** soundId → buffer 加载状态 */
  private bufferCache = new Map<string, BufferEntry>();

  /**
   * 解锁音频:在首次用户交互(click/keydown)时调用。
   * 创建 AudioContext + master GainNode,并 resume。
   * 在非浏览器环境或 AudioContext 不可用时安全降级(静默 no-op)。
   */
  unlock(): void {
    if (this.unlocked) return;
    if (typeof window === 'undefined') return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.applyGain();
      this.unlocked = true;
      // resume 在某些浏览器上是 async,但不阻塞播放(start 后自动恢复)
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {
          /* resume 失败静默:后续播放时浏览器会再次尝试 */
        });
      }
    } catch {
      // 创建失败(如浏览器限制):静默降级
      this.ctx = null;
      this.masterGain = null;
    }
  }

  /** 设置全局音量(0..1) */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyGain();
  }

  /** 设置静音 */
  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  /** 是否已解锁(可用于 UI 提示"点击后开启音效")。 */
  isUnlocked(): boolean {
    return this.unlocked;
  }

  /** 应用主音量到 GainNode */
  private applyGain(): void {
    if (this.masterGain && this.ctx) {
      // 用 setTargetAtTime 平滑过渡,避免爆音(click/pop)
      const target = this.muted ? 0 : this.volume;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
    }
  }

  /**
   * 播放一个音效。
   *
   * @param soundId       音效标识符(来自 AtomEffect.sound)
   * @param effectVolume  per-event 音量(来自 AtomEffect.volume,0..1);缺省为 1。
   *                      最终音量 = effectVolume × 全局音量。
   *
   * 静默跳过的场景:
   *   - 尚未解锁(无用户交互)
   *   - 静音状态
   *   - soundId 未在映射表中登记
   *   - 音频文件加载失败(负缓存)
   */
  play(soundId: string, effectVolume?: number): void {
    if (!this.unlocked || !this.ctx || !this.masterGain) return;
    if (this.muted) return;
    const url = resolveSoundUrl(soundId);
    if (!url) return;

    const evVol = effectVolume !== undefined ? Math.max(0, Math.min(1, effectVolume)) : 1;

    // 同步路径:buffer 已就绪 → 立即播放
    const cached = this.bufferCache.get(soundId);
    if (cached?.status === 'ok') {
      this.startSource(cached.buffer, evVol);
      return;
    }
    if (cached?.status === 'missing') return; // 负缓存:跳过

    // 异步路径:首次请求该音效 → 触发加载
    if (!cached) {
      const promise = this.loadBuffer(soundId, url);
      this.bufferCache.set(soundId, { status: 'pending', promise });
      // 缓存上限保护
      if (this.bufferCache.size > BUFFER_CACHE_LIMIT) {
        this.evictOldest();
      }
      void promise.then((buffer) => {
        if (buffer) {
          // 加载成功后立即补播本次(用户延迟感知在可接受范围)
          this.bufferCache.set(soundId, { status: 'ok', buffer });
          if (this.unlocked && !this.muted) {
            this.startSource(buffer, evVol);
          }
        } else {
          this.bufferCache.set(soundId, { status: 'missing' });
        }
      });
    }
    // pending 状态:加载完成后上面的 then 会补播,无需在此重复
  }

  /** 创建并启动一个 BufferSource(per-event gain → master gain → destination) */
  private startSource(buffer: AudioBuffer, effectVolume: number): void {
    if (!this.ctx || !this.masterGain) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      // TODO(可选):随机变调避免单调
      // src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.05;
      if (effectVolume >= 1) {
        // per-event 音量为 1 时直接接 master,省一个 GainNode
        src.connect(this.masterGain);
      } else {
        const evtGain = this.ctx.createGain();
        evtGain.gain.value = effectVolume;
        src.connect(evtGain);
        evtGain.connect(this.masterGain);
      }
      src.start();
      // 自动清理:播放结束后断开(GC 友好)
      src.onended = () => {
        try {
          src.disconnect();
        } catch {
          /* 已断开 */
        }
      };
    } catch {
      /* start 失败静默(如 context 已关闭) */
    }
  }

  /**
   * 加载并解码音频 buffer。
   * 失败(404/网络错误/解码失败)返回 null,不输出 console.error/warn。
   */
  private async loadBuffer(soundId: string, url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null; // 404 等静默处理
      const arrayBuffer = await res.arrayBuffer();
      // decodeAudioData 在某些浏览器返回 Promise,某些用回调;统一 Promise 包装
      return await this.ctx.decodeAudioData(arrayBuffer);
    } catch {
      // 网络/解码失败:静默(文件可能尚未放入,属预期)
      return null;
    }
  }

  /** 清理缓存最早条目(FIFO 淘汰) */
  private evictOldest(): void {
    const firstKey = this.bufferCache.keys().next().value;
    if (firstKey !== undefined) {
      this.bufferCache.delete(firstKey);
    }
  }

  /** 清空所有缓存 buffer(测试/重置用) */
  clearCache(): void {
    this.bufferCache.clear();
  }
}

/**
 * 全局单例。整个应用共享一个 AudioContext + buffer 缓存。
 * 使用方式:
 *   import { audioEngine } from '../sounds/audioEngine';
 *   audioEngine.play('damage_physical', 0.8);
 */
export const audioEngine = new AudioEngine();
