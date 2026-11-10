import { useEffect, useRef, useState, useId } from 'react';

export interface IronChainOverlayProps {
  chained?: boolean;
  marks?: { id: string }[];
  className?: string;
  onBroken?: () => void;
}

/**
 * 判断玩家是否处于连环/横置状态
 * 兼容 marks 中的 '连环'、'横置' 以及引擎底层 'chained' 标记
 */
export function isPlayerChained(
  player: { marks?: { id: string }[] } | null | undefined,
): boolean {
  if (!player || !player.marks) return false;
  return player.marks.some(
    (m) => m.id === '连环' || m.id === '横置' || m.id === 'chained',
  );
}

/**
 * 实体金属粗铁链覆层组件 (IronChainOverlay)
 * 当角色处于连环/横置状态时，武将头像上以粗铁链呈对角交叉缠绕锁死，
 * 带有冷银蓝色金属脉冲流光与中央铁索锁结；
 * 当状态解除时铁链断裂消隐。
 */
export function IronChainOverlay({
  chained,
  marks,
  className,
  onBroken,
}: IronChainOverlayProps) {
  const uniqueId = useId().replace(/:/g, '');
  const sheenId = `iron-sheen-${uniqueId}`;
  const pulseId = `iron-pulse-${uniqueId}`;
  const glowId = `iron-glow-${uniqueId}`;
  const lockGlowId = `iron-lock-glow-${uniqueId}`;

  const isChained = Boolean(
    chained ||
      marks?.some((m) => m.id === '连环' || m.id === '横置' || m.id === 'chained'),
  );

  const [animState, setAnimState] = useState<'idle' | 'locked' | 'breaking'>(
    isChained ? 'locked' : 'idle',
  );
  const prevChainedRef = useRef(isChained);

  useEffect(() => {
    if (prevChainedRef.current && !isChained) {
      // 连环解除：触发铁链断裂消隐
      setAnimState('breaking');
      const timer = window.setTimeout(() => {
        setAnimState('idle');
        onBroken?.();
      }, 600);
      return () => window.clearTimeout(timer);
    } else if (!prevChainedRef.current && isChained) {
      // 触发连环锁死
      setAnimState('locked');
    }
    prevChainedRef.current = isChained;
  }, [isChained, onBroken]);

  if (animState === 'idle' && !isChained) {
    return null;
  }

  return (
    <div
      className={`arena-iron-chain-overlay ${animState === 'breaking' ? 'is-breaking' : 'is-locked'} ${className ?? ''}`}
      data-testid="arena-iron-chain"
      data-state={animState}
      aria-hidden="true"
    >
      <svg
        className="arena-iron-chain-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          {/* 金属拉丝反光渐变 */}
          <linearGradient id={sheenId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="20%" stopColor="#475569" />
            <stop offset="40%" stopColor="#cbd5e1" />
            <stop offset="55%" stopColor="#f8fafc" />
            <stop offset="70%" stopColor="#94a3b8" />
            <stop offset="85%" stopColor="#334155" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>

          {/* 冷银蓝金属流光渐变 */}
          <linearGradient id={pulseId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.3" />
            <stop offset="35%" stopColor="#7dd3fc" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="65%" stopColor="#38bdf8" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.3" />
          </linearGradient>

          {/* 链条流光发光滤镜 */}
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* 锁心核心流光滤镜 */}
          <filter id={lockGlowId} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 对角线 1：左上至右下粗铁链 */}
        <g className="arena-chain-diagonal arena-chain-diagonal-1">
          {/* 底部投影 */}
          <line
            x1="-5"
            y1="-5"
            x2="105"
            y2="105"
            stroke="#000000"
            strokeWidth="9"
            strokeOpacity="0.65"
            strokeLinecap="round"
          />
          {/* 金属锁链主体 */}
          <line
            x1="-5"
            y1="-5"
            x2="105"
            y2="105"
            stroke={`url(#${sheenId})`}
            strokeWidth="6"
            strokeLinecap="round"
          />
          {/* 实体椭圆链环节 */}
          {[14, 26, 38, 62, 74, 86].map((t) => (
            <g key={`d1-link-${t}`} transform={`translate(${t}, ${t}) rotate(45)`}>
              <rect
                x="-6"
                y="-3"
                width="12"
                height="6"
                rx="3"
                fill="none"
                stroke={`url(#${sheenId})`}
                strokeWidth="2"
              />
              <rect
                x="-3"
                y="-1.5"
                width="6"
                height="3"
                rx="1.5"
                fill="#0f172a"
              />
            </g>
          ))}
          {/* 冷银蓝金属流光流动虚线 */}
          <line
            x1="-5"
            y1="-5"
            x2="105"
            y2="105"
            stroke={`url(#${pulseId})`}
            strokeWidth="2.4"
            strokeDasharray="4 6"
            strokeLinecap="round"
            className="arena-iron-chain-pulse"
            filter={`url(#${glowId})`}
          />
        </g>

        {/* 对角线 2：右上至左下粗铁链 */}
        <g className="arena-chain-diagonal arena-chain-diagonal-2">
          {/* 底部投影 */}
          <line
            x1="105"
            y1="-5"
            x2="-5"
            y2="105"
            stroke="#000000"
            strokeWidth="9"
            strokeOpacity="0.65"
            strokeLinecap="round"
          />
          {/* 金属锁链主体 */}
          <line
            x1="105"
            y1="-5"
            x2="-5"
            y2="105"
            stroke={`url(#${sheenId})`}
            strokeWidth="6"
            strokeLinecap="round"
          />
          {/* 实体椭圆链环节 */}
          {[14, 26, 38, 62, 74, 86].map((t) => (
            <g
              key={`d2-link-${t}`}
              transform={`translate(${100 - t}, ${t}) rotate(-45)`}
            >
              <rect
                x="-6"
                y="-3"
                width="12"
                height="6"
                rx="3"
                fill="none"
                stroke={`url(#${sheenId})`}
                strokeWidth="2"
              />
              <rect
                x="-3"
                y="-1.5"
                width="6"
                height="3"
                rx="1.5"
                fill="#0f172a"
              />
            </g>
          ))}
          {/* 冷银蓝金属流光流动虚线 */}
          <line
            x1="105"
            y1="-5"
            x2="-5"
            y2="105"
            stroke={`url(#${pulseId})`}
            strokeWidth="2.4"
            strokeDasharray="4 6"
            strokeLinecap="round"
            className="arena-iron-chain-pulse"
            filter={`url(#${glowId})`}
          />
        </g>

        {/* 中央重装交叉铁索锁结 / 锁心 */}
        <g className="arena-chain-lock-center" transform="translate(50, 50)">
          {/* 重装八角或圆形锁环 */}
          <circle
            cx="0"
            cy="0"
            r="10.5"
            fill="#0b1120"
            stroke={`url(#${sheenId})`}
            strokeWidth="2.8"
          />
          <circle
            cx="0"
            cy="0"
            r="6.8"
            fill="#1e293b"
            stroke="#64748b"
            strokeWidth="1.2"
          />
          {/* 锁扣铆钉十字 */}
          <rect x="-1" y="-5.5" width="2" height="11" rx="1" fill="#e2e8f0" />
          <rect x="-5.5" y="-1" width="11" height="2" rx="1" fill="#e2e8f0" />
          {/* 锁心冷银蓝脉冲核心 */}
          <circle
            cx="0"
            cy="0"
            r="3.2"
            fill="#38bdf8"
            className="arena-chain-core-pulse"
            filter={`url(#${lockGlowId})`}
          />
        </g>

        {/* 断裂破碎飞溅火花（仅在 is-breaking 状态激活动画） */}
        {animState === 'breaking' && (
          <g className="arena-chain-shatter-sparks">
            <circle cx="44" cy="44" r="1.6" fill="#ffffff" className="arena-spark-1" />
            <circle cx="56" cy="44" r="1.6" fill="#38bdf8" className="arena-spark-2" />
            <circle cx="44" cy="56" r="1.6" fill="#7dd3fc" className="arena-spark-3" />
            <circle cx="56" cy="56" r="1.6" fill="#bae6fd" className="arena-spark-4" />
          </g>
        )}
      </svg>
    </div>
  );
}
