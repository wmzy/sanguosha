// src/client/components/CancelButton.tsx
// 通用取消按钮:消除 GameView 中 3 处结构相同的「取消」按钮重复代码。
// 样式固定使用 cancelBtn;文案和点击行为由 props 传入。
import * as styles from './gameViewStyles';

export interface CancelButtonProps {
  /** 按钮文案(默认"取消") */
  label?: string;
  onClick: () => void;
}

export function CancelButton({ label = '取消', onClick }: CancelButtonProps) {
  return (
    <button className={styles.cancelBtn} onClick={onClick}>{label}</button>
  );
}
