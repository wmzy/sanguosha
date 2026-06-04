import { memo, useEffect, useRef } from 'react';
import type { Operation } from '../../shared/log';
import { colors } from '../theme';

interface LogPanelProps {
  operations: Operation[];
  maxHeight?: number;
}

function LogPanelInner({ operations, maxHeight = 200 }: LogPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [operations.length]);

  return (
    <div
      ref={containerRef}
      style={{
        maxHeight,
        overflow: 'auto',
        backgroundColor: colors.bg.panel,
        borderRadius: 8,
        padding: 12,
      }}
    >
      {operations.length === 0 && (
        <div style={{ color: colors.text.dim, fontSize: 13 }}>暂无操作记录</div>
      )}
      {operations.map((op, i) => (
        <div
          key={i}
          style={{
            fontSize: 13,
            color: colors.text.secondary,
            marginBottom: 4,
            padding: '2px 0',
            borderBottom: `1px solid ${colors.bg.input}`,
          }}
        >
          <span style={{ color: colors.text.dim, marginRight: 8 }}>{op.seq}.</span>
          {op.description}
        </div>
      ))}
    </div>
  );
}

export const LogPanel = memo(LogPanelInner);
