// src/engine/atoms/index.ts
// 静态 atom 注册表:所有 AtomDefinition 的具名导出聚合为 atomMap。
// core/atom.ts 的 getAtomDef 从此查表。类型 Record<AtomName, AtomDefinition>
// 保证 Atom 联合的每个 type 都有定义——新增 atom 必须同时加 Atom 联合成员
// 和此处条目,否则编译报错(消灭"atom 未注册"运行时错误)。
import type { AtomDefinition, AtomName } from '../types';
import { 伤害结算开始时, 造成伤害时, 受到伤害时, 造成伤害后, 受到伤害后, 伤害结算结束时, 伤害结算结束后 } from './damage-timing';
import { 亮身份牌前, 亮身份牌, 死亡时, 系统处理牌, 死亡后, 进入濒死状态时, 新的濒死状态时 } from './death-timing';
import { 判定时, 判定牌生效前, 判定牌生效后 } from './judge-timing';
import { 扣减体力, 确定回复数值时, 回复体力后, 失去体力时, 失去体力后, 扣减体力前, 扣减体力时, 扣减体力后, 减上限后, 加上限后 } from './life-timing';
import { 移动到目标区域前, 移动到目标区域后 } from './move-timing';
import { 拼点扣置, 拼点亮出, 拼点后 } from './rank-timing';
import { 翻面后, 横置后, 武将牌明置后, 武将牌移除后, 游戏牌亮出后 } from './statechange-timing';
import { 下一玩家 } from './下一玩家';
import { 使用时 } from './使用时';
import { 使用结算结束后 } from './使用结算结束后';
import { 使用结算结束时 } from './使用结算结束时';
import { 出牌窗口 } from './出牌窗口';
import { 分配武将 } from './分配武将';
import { 判定 } from './判定';
import { 加标签 } from './加标签';
import { 加标记 } from './加标记';
import { 卸下 } from './卸下';
import { 去标签 } from './去标签';
import { 去标记 } from './去标记';
import { 回合开始 } from './回合开始';
import { 回合用量 } from './回合用量';
import { 回合结束 } from './回合结束';
import { 回合结束后 } from './回合结束后';
import { 回复体力 } from './回复体力';
import { 声明打出时 } from './声明打出时';
import { 失去体力 } from './失去体力';
import { 展示 } from './展示';
import { 展示结束 } from './展示结束';
import { 帧参数赋值 } from './帧参数赋值';
import { 弃置 } from './弃置';
import { 归还暂存牌 } from './归还暂存牌';
import { 当作 } from './当作';
import { 成为目标 } from './成为目标';
import { 成为目标后 } from './成为目标后';
import { 打出牌时 } from './打出牌时';
import { 扣牌 } from './扣牌';
import { 指定目标 } from './指定目标';
import { 指定目标后 } from './指定目标后';
import { 摸牌 } from './摸牌';
import { 整理牌堆 } from './整理牌堆';
import { 检测有效性 } from './检测有效性';
import { 添加延时锦囊 } from './添加延时锦囊';
import { 添加技能 } from './添加技能';
import { 清过期标记 } from './清过期标记';
import { 生效前 } from './生效前';
import { 生效后 } from './生效后';
import { 生效时 } from './生效时';
import { 移出至暂存区 } from './移出至暂存区';
import { 移动牌 } from './移动牌';
import { 移除延时锦囊 } from './移除延时锦囊';
import { 移除技能 } from './移除技能';
import { 结算帧入栈 } from './结算帧入栈';
import { 结算帧出栈 } from './结算帧出栈';
import { 给予 } from './给予';
import { 置创牌 } from './置创牌';
import { 获得 } from './获得';
import { 被抵消 } from './被抵消';
import { 装备 } from './装备';
import { 设上限 } from './设上限';
import { 设横置 } from './设横置';
import { 询问杀 } from './询问杀';
import { 询问闪 } from './询问闪';
import { 请求回应 } from './请求回应';
import { 抽身份, 初始化洗牌, 发牌, 选将询问, 并行选将 } from './选将';
import { 选择目标时 } from './选择目标时';
import { 重洗 } from './重洗';
import { 阶段开始 } from './阶段开始';
import { 阶段结束 } from './阶段结束';
import { 阶段间 } from './阶段间';
import { 陷入濒死 } from './陷入濒死';

export { 展示型atoms } from './展示事件';

// AtomDefinition<A> 在 A 上逆变(validate/apply 形参),无法直接装入 AtomDefinition<unknown>;
// 用 any 放宽存储类型(键完整性检查不受影响)。
export const atomMap: Record<AtomName, AtomDefinition<any>> = {
  伤害结算开始时,
  造成伤害时,
  受到伤害时,
  造成伤害后,
  受到伤害后,
  伤害结算结束时,
  伤害结算结束后,
  亮身份牌前,
  亮身份牌,
  死亡时,
  系统处理牌,
  死亡后,
  进入濒死状态时,
  新的濒死状态时,
  判定时,
  判定牌生效前,
  判定牌生效后,
  扣减体力,
  确定回复数值时,
  回复体力后,
  失去体力时,
  失去体力后,
  扣减体力前,
  扣减体力时,
  扣减体力后,
  减上限后,
  加上限后,
  移动到目标区域前,
  移动到目标区域后,
  拼点扣置,
  拼点亮出,
  拼点后,
  翻面后,
  横置后,
  武将牌明置后,
  武将牌移除后,
  游戏牌亮出后,
  下一玩家,
  使用时,
  使用结算结束后,
  使用结算结束时,
  出牌窗口,
  分配武将,
  判定,
  加标签,
  加标记,
  卸下,
  去标签,
  去标记,
  回合开始,
  回合用量,
  回合结束,
  回合结束后,
  回复体力,
  声明打出时,
  失去体力,
  展示,
  展示结束,
  帧参数赋值,
  弃置,
  归还暂存牌,
  当作,
  成为目标,
  成为目标后,
  打出牌时,
  扣牌,
  指定目标,
  指定目标后,
  摸牌,
  整理牌堆,
  检测有效性,
  添加延时锦囊,
  添加技能,
  清过期标记,
  生效前,
  生效后,
  生效时,
  移出至暂存区,
  移动牌,
  移除延时锦囊,
  移除技能,
  结算帧入栈,
  结算帧出栈,
  给予,
  置创牌,
  获得,
  被抵消,
  装备,
  设上限,
  设横置,
  询问杀,
  询问闪,
  请求回应,
  抽身份,
  初始化洗牌,
  发牌,
  选将询问,
  并行选将,
  选择目标时,
  重洗,
  阶段开始,
  阶段结束,
  阶段间,
  陷入濒死,
};
