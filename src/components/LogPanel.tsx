import { useEffect, useRef } from 'react';
import type { Operation } from '../../shared/log';

interface LogPanelProps {
  operations: Operation[];
  maxHeight?: number;
}

export function LogPanel({ operations, maxHeight = 200 }: LogPanelProps) {
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
        backgroundColor: '#2c3e50',
        borderRadius: 8,
        padding: 12,
      }}
    >
      {operations.length === 0 && (
        <div style={{ color: '#7f8c8d', fontSize: 13 }}>暂无操作记录</div>
      )}
      {operations.map((op, i) => (
        <div
          key={i}
          style={{
            fontSize: 13,
            color: '#bdc3c7',
            marginBottom: 4,
            padding: '2px 0',
            borderBottom: '1px solid #34495e',
          }}
        >
          <span style={{ color: '#7f8c8d', marginRight: 8 }}>{op.seq}.</span>
          {op.description}
        </div>
      ))}
    </div>
  );
}
