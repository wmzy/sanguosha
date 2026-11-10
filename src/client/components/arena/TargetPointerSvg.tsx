export interface TargetPointerSvgProps {
  sourcePos: [number, number];
  targetPositions: [number, number][];
  variant?: 'default' | 'chain';
}

/**
 * 计算座次边界交点（以座次中心为原点，向来源方向延伸到座次卡片边框）
 * 座次在 16:9 画布下的百分比半宽约为 11%，半高约为 13%
 */
export function getSeatBorderPoint(
  center: [number, number],
  from: [number, number],
  halfWidth = 11.0,
  halfHeight = 13.0,
): [number, number] {
  const dx = from[0] - center[0];
  const dy = from[1] - center[1];
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return center;
  const scaleX = Math.abs(dx) > 1e-4 ? halfWidth / Math.abs(dx) : Infinity;
  const scaleY = Math.abs(dy) > 1e-4 ? halfHeight / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return [
    center[0] + dx * scale,
    center[1] + dy * scale,
  ];
}

/**
 * 计算战术箭头的顶点多边形坐标（横纵比校准后的利刃箭头）
 */
export function getArrowPolygon(
  sourcePos: [number, number],
  targetPos: [number, number],
) {
  const [bx, by] = getSeatBorderPoint(targetPos, sourcePos);
  const dx = targetPos[0] - sourcePos[0];
  const dy = targetPos[1] - sourcePos[1];
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  const arrowLen = 3.6;
  const arrowWidth = 2.4;
  const aspect = 16 / 9;

  const rawPerpX = -uy;
  const rawPerpY = ux * aspect;
  const perpDist = Math.hypot(rawPerpX, rawPerpY) || 1;
  const px = (rawPerpX / perpDist) * arrowWidth;
  const py = (rawPerpY / perpDist) * (arrowWidth / aspect);

  const bcx = bx - ux * arrowLen;
  const bcy = by - uy * arrowLen;

  const p1 = `${bx.toFixed(2)},${by.toFixed(2)}`;
  const p2 = `${(bcx + px).toFixed(2)},${(bcy + py).toFixed(2)}`;
  const p3 = `${(bx - ux * (arrowLen * 0.62)).toFixed(2)},${(by - uy * (arrowLen * 0.62)).toFixed(2)}`;
  const p4 = `${(bcx - px).toFixed(2)},${(bcy - py).toFixed(2)}`;

  return {
    tip: [bx, by] as [number, number],
    points: `${p1} ${p2} ${p3} ${p4}`,
  };
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
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M 0 0 L 6 3 L 0 6 L 1.5 3 Z" fill="#ff4757" />
        </marker>

        {/* 铁索连环冷银蓝战术箭头 */}
        <marker
          id="arena-chain-arrow"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M 0 0 L 6 3 L 0 6 L 1.5 3 Z" fill="#38bdf8" />
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

        const arrow = getArrowPolygon(sourcePos, targetPos);

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
            {/* 动态流动虚线 */}
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
            {/* 显式座次边界战术箭头（保证横向、纵向及各类角度均有高亮箭头，不被卡片背景覆盖） */}
            <polygon
              data-testid={`arena-target-arrowhead-${idx}`}
              className={`arena-target-arrowhead ${isChain ? 'is-chain' : ''}`}
              points={arrow.points}
              fill={isChain ? '#38bdf8' : '#ff4757'}
              filter={isChain ? 'url(#arena-chain-line-glow)' : 'url(#arena-line-glow)'}
            />
            {/* 目标边界战术准星圆环 */}
            <circle
              data-testid={`arena-target-reticle-${idx}`}
              cx={arrow.tip[0]}
              cy={arrow.tip[1]}
              r="1.4"
              className={`arena-target-reticle ${isChain ? 'is-chain' : ''}`}
              fill="none"
              stroke={isChain ? '#38bdf8' : '#ff4757'}
              strokeWidth="0.35"
              strokeDasharray="0.8 0.5"
              filter={isChain ? 'url(#arena-chain-line-glow)' : 'url(#arena-line-glow)'}
            />
          </g>
        );
      })}
    </svg>
  );
}
