// gameViewStyles/index.ts — barrel 统一导出。
// 原 src/client/components/gameViewStyles.ts (1225 行) 按区域拆分为 6 个文件:
//   layout / seat / hand / actionBar / prompt / panels
// 本 barrel 聚合全部导出,保持外部 `import * as styles from './gameViewStyles'` 不变。
// 通过 `import * as styles` 使用:
//   className={styles.pageRoot}
//   className={cx(styles.seatCard, isActive && styles.seatCardActive)}
//
// 动画 keyframes (flyCardMove / damageFlash / damageShake / phaseIn / newTurnGlow / damageOverlay)
// 定义在 src/client/animations.css,由 main.tsx 全局引入。

export * from './layout';
export * from './seat';
export * from './hand';
export * from './actionBar';
export * from './prompt';
export * from './panels';
