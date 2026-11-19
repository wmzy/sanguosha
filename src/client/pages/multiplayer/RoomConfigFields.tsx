// src/client/pages/multiplayer/RoomConfigFields.tsx
// 房间配置表单的公共字段组件:等待大厅(RoomConfigSection)与调试面板
// (components/debug/RoomConfigPanel)双写的四个字段——房间名称/将池/操作倒计时/初始手牌——
// 的单一出处。两处页面的字段排布与表单皮肤不同(布局容器与 label/input 类由调用方注入),
// 故按字段拆分导出、由调用方各自编排;字段控件本身(选项表/maxLength/数值范围/
// 非 standard 倒计时回退选项)与变更/提交接线全部收敛在此。
import { POOL_OPTIONS, TIMEOUT_OPTIONS, timeoutLabel } from './multiplayerStyles';
import type { RoomConfig, CharPoolPreset } from '../../../server/protocol';

/** 可经公共字段组件编辑的配置键 */
export type RoomConfigField = 'name' | 'charPool' | 'timeoutSec' | 'handSize';

/** 公共字段组件的共享 props */
export interface RoomConfigFieldProps {
  /** 当前编辑中的房间配置 */
  config: RoomConfig;
  /** 字段值变更(仅更新调用方编辑态) */
  onFieldChange: <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => void;
  /** 字段提交(输入框失焦提交 / 下拉选中即提交),nextConfig 为提交目标的整份配置;
   *  提交时机语义(如调试面板对下拉字段的 setTimeout 延迟)由调用方提交层决定。 */
  onCommit: (field: RoomConfigField, nextConfig: RoomConfig) => void;
  /** <label> 样式类 */
  labelCls: string;
  /** 输入/下拉控件样式类 */
  inputCls: string;
}

/** 房间名称:text 输入,上限 40 字,失焦提交 */
export function RoomNameField({
  config,
  onFieldChange,
  onCommit,
  labelCls,
  inputCls,
}: RoomConfigFieldProps) {
  return (
    <>
      <label className={labelCls}>房间名称</label>
      <input
        className={inputCls}
        type="text"
        value={config.name}
        maxLength={40}
        onChange={(e) => onFieldChange('name', e.target.value)}
        onBlur={() => onCommit('name', config)}
      />
    </>
  );
}

/** 将池:下拉,选中即提交 */
export function RoomCharPoolField({
  config,
  onFieldChange,
  onCommit,
  labelCls,
  inputCls,
}: RoomConfigFieldProps) {
  return (
    <>
      <label className={labelCls}>将池</label>
      <select
        className={inputCls}
        value={config.charPool}
        onChange={(e) => {
          const v = e.target.value as CharPoolPreset;
          onFieldChange('charPool', v);
          onCommit('charPool', { ...config, charPool: v });
        }}
      >
        {POOL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** 操作倒计时:下拉,选中即提交;当前值不在标准选项内(历史房间)时补一条回退选项 */
export function RoomTimeoutField({
  config,
  onFieldChange,
  onCommit,
  labelCls,
  inputCls,
}: RoomConfigFieldProps) {
  return (
    <>
      <label className={labelCls}>操作倒计时</label>
      <select
        className={inputCls}
        value={config.timeoutSec}
        onChange={(e) => {
          const v = Number(e.target.value);
          onFieldChange('timeoutSec', v);
          onCommit('timeoutSec', { ...config, timeoutSec: v });
        }}
      >
        {TIMEOUT_OPTIONS.map((o) => (
          <option key={o.label} value={o.value}>
            {o.label}
          </option>
        ))}
        {!TIMEOUT_OPTIONS.some((o) => o.value === config.timeoutSec) && (
          <option value={config.timeoutSec}>{timeoutLabel(config.timeoutSec)}</option>
        )}
      </select>
    </>
  );
}

/** 初始手牌:0-10 数值输入,失焦提交 */
export function RoomHandSizeField({
  config,
  onFieldChange,
  onCommit,
  labelCls,
  inputCls,
}: RoomConfigFieldProps) {
  return (
    <>
      <label className={labelCls}>初始手牌</label>
      <input
        className={inputCls}
        type="number"
        min={0}
        max={10}
        value={config.handSize}
        onChange={(e) => onFieldChange('handSize', Number(e.target.value))}
        onBlur={() => onCommit('handSize', config)}
      />
    </>
  );
}
