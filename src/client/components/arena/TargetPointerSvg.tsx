import React from 'react';

export interface TargetPointerSvgProps {
  sourcePos: [number, number];
  targetPositions: [number, number][];
}

/**
 * 战术目标指向连线 SVG (TargetPointerSvg)
 * 在出杀、决斗、顺手牵羊、过河拆桥等单体操作时，
 * 在发起方座次与目标座次之间绘制动态半透明 SVG 战术虚线连线与箭头。
 */
export function TargetPointerSvg({ sourcePos, targetPositions }: TargetPointerSvgProps) {
  if (!targetPositions.length) return null;

  return (
    <svg
      className="arena-targeting-svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="arena-targeting-svg"
    >
      <defs>
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
        <filter id="arena-line-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {targetPositions.map((targetPos, idx) => (
        <g key={`target-pointer-${idx}`}>
          {/* 红色发光战术底线 */}
          <line
            x1={sourcePos[0]}
            y1={sourcePos[1]}
            x2={targetPos[0]}
            y2={targetPos[1]}
            stroke="#ff4757"
            strokeWidth="0.9"
            strokeOpacity="0.4"
            strokeLinecap="round"
          />
          {/* 动态流动虚线与箭头 */}
          <line
            x1={sourcePos[0]}
            y1={sourcePos[1]}
            x2={targetPos[0]}
            y2={targetPos[1]}
            stroke="#ff6b81"
            strokeWidth="0.5"
            strokeDasharray="1.5 1"
            strokeLinecap="round"
            markerEnd="url(#arena-target-arrow)"
            filter="url(#arena-line-glow)"
            className="arena-target-line"
          />
        </g>
      ))}
    </svg>
  );
}
