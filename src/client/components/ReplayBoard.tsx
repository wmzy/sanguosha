// src/components/ReplayBoard.tsx — 录像回放(暂不可用)
//
// 老 replay 系统依赖 _legacy/ 引擎(ReplayEngine / SequencedEvent)。
// 新 ENGINE-DESIGN 的回放系统待重写(ActionLogEntry + createEngine 回放)。
import type { GameLog } from '../../shared/log';
import { colors } from '../theme';

interface ReplayBoardProps {
  log: GameLog;
  onClose: () => void;
}

export function ReplayBoard({ onClose }: ReplayBoardProps) {
  return (
    <div style={pageStyle}>
      <h2 style={titleStyle}>录像回放</h2>
      <p style={descStyle}>
        回放系统正在重写中——新 ENGINE-DESIGN 的 ActionLogEntry 回放尚未实现。
      </p>
      <p style={descStyle}>
        老引擎的 ReplayEngine 依赖 SequencedEvent 事件流,与新引擎不兼容。
      </p>
      <button style={backBtnStyle} onClick={onClose}>返回</button>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  backgroundColor: colors.bg.page,
  color: colors.text.primary,
  gap: 16,
};

const titleStyle: React.CSSProperties = {
  fontSize: 24,
  margin: 0,
};

const descStyle: React.CSSProperties = {
  color: colors.text.secondary,
  fontSize: 14,
  maxWidth: 400,
  textAlign: 'center',
};

const backBtnStyle: React.CSSProperties = {
  padding: '10px 24px',
  backgroundColor: colors.accent.blue,
  color: colors.white,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 15,
};
