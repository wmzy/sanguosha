// src/client/pages/multiplayer/ErrorToast.tsx
// 错误提示 toast:统一各 stage 分支的错误反馈展示(固定右上角,样式来自 errorToastStyle)。
// 传 onClose 时可点击关闭(cursor + title);不传则为纯静态提示(如"录像生成中")。
import { errorToastStyle } from '../../theme';

export function ErrorToast({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div
      className={errorToastStyle}
      style={onClose ? { cursor: 'pointer' } : undefined}
      title={onClose ? '点击关闭' : undefined}
      onClick={onClose}
    >
      {message}
    </div>
  );
}
