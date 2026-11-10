export interface TargetPointerSvgProps {
  sourcePos: [number, number];
  targetPositions: [number, number][];
  variant?: 'default' | 'chain';
}

/**
 * 战术目标指向连线 SVG (TargetPointerSvg)
 * 支持一对多（1 对 1 或 1 对 2+）同时绘制指向箭头与动态虚线流光，
 * 覆盖普通单体出牌（杀、决斗、顺拆）以及铁索连环双目标等场景。
 */
export function TargetPointerSvg({
  sourcePos,
  targetPositions,
  variant = 'default',
}: TargetPointerSvgProps) {
  if (!targetPositions.length) return null;

  const isChain = variant === 'chain';

  return (
    <svg
      className={`arena-targeting-svg ${isChain ? 'variant-chain' : ''}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="arena-targeting-svg"
      data-target-count={targetPositions.length}
      data-variant={variant}
    >
      <defs>
        {/* 常规红色战术箭头 */}
        <marker
          id="arena-target-arrow"
          markerWidth="4"
          markerHeight="4"
          refX="3"
          refY="2"
          orient="auto"
        >
          <path d="M 0 0 L 4 2 L 0 4 L 1 2 Z" fill="#ff4757" />
        </marker>

        {/* 铁索连环冷银蓝战术箭头 */}
        <marker
          id="arena-chain-arrow"
          markerWidth="4"
          markerHeight="4"
          refX="3"
          refY="2"
          orient="auto"
        >
          <path d="M 0 0 L 4 2 L 0 4 L 1 2 Z" fill="#38bdf8" />
        </marker>

        {/* 常规红色流光滤镜 */}
        <filter id="arena-line-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* 铁索连环冷银蓝流光滤镜 */}
        <filter id="arena-chain-line-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.45" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {targetPositions.map((targetPos, idx) => {
        const isSelf = sourcePos[0] === targetPos[0] && sourcePos[1] === targetPos[1];
        // 出牌方自身不绘制红圈，出牌方通过座次边框金光常亮标识
        if (isSelf) return null;

        return (
          <g
            key={`target-pointer-${idx}`}
            data-testid={`arena-target-line-${idx}`}
            className="arena-target-line-group"
          >
            {/* 底部发光战术底线 */}
            <line
              x1={sourcePos[0]}
              y1={sourcePos[1]}
              x2={targetPos[0]}
              y2={targetPos[1]}
              stroke={isChain ? '#0284c7' : '#ff4757'}
              strokeWidth="0.9"
              strokeOpacity="0.4"
              strokeLinecap="round"
            />
            {/* 动态流动虚线与战术箭头 */}
            <line
              x1={sourcePos[0]}
              y1={sourcePos[1]}
              x2={targetPos[0]}
              y2={targetPos[1]}
              stroke={isChain ? '#38bdf8' : '#ff6b81'}
              strokeWidth="0.5"
              strokeDasharray="1.5 1"
              strokeLinecap="round"
              markerEnd={isChain ? 'url(#arena-chain-arrow)' : 'url(#arena-target-arrow)'}
              filter={isChain ? 'url(#arena-chain-line-glow)' : 'url(#arena-line-glow)'}
              className={`arena-target-line ${isChain ? 'is-chain' : ''}`}
            />
          </g>
        );
      })}
    </svg>
  );
}
