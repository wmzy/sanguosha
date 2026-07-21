// Atom 类型:原子操作联合类型 + 定义接口 + 视图事件 + 钩子上下文。
// 原 src/engine/types.ts 的 `==================== Atom ====================` 段及 hook 上下文。

import type { DamageType } from '../../shared/types';
import type { EquipSlot, GameState, Json, Mark, PendingTrick, TurnPhase } from './state';
import type { ActionPrompt } from './prompt';
import type { GameView } from './view';
import type { SettlementFrame } from './skill';

/** Atom 等待配置(pending)。有此字段 = 等待型 atom。apply 流程走完后进 pending 区。
 等待型 atom 不可被取消——必走完(响应/超时)之一(没有 drop 机制)。
 `timeout` 与 `onTimeout` 都是必填,无合理默认值。 */
export interface AtomPending<A = Atom> {
  /** 超时后的行为。**必填**——一个 async 函数,引擎在 slot 超时时调用。
   *  内部可自由编排 applyAtom(支持多步操作),每个 applyAtom 照常走完整 pipeline(hooks 正常触发)。
   *  典型:无副作用 `async () => {}`;自动弃牌 `async (s, a) => { await applyAtom(s, 弃牌atom) }` */
  onTimeout: (state: GameState, atom: A) => Promise<void>;
  /** 前端提示(告诉前端渲染什么 UI) */
  prompt: ActionPrompt;
  /** 超时毫秒。**必填**——无合理默认值,常见值:询问闪/询问杀 15s,请求回应 30s */
  timeout: number;
  /** 是否为阻塞型 pending(需要玩家先回应才能继续)。默认 true。
   *  非阻塞型 pending 表示一个"控制权 token"——玩家可在其期间自由操作(如出牌阶段的 出牌窗口),
   *  出牌/用技的 validate 只检查阻塞型 pending。 */
  isBlocking?: boolean;
}

export interface AtomEffect {
  sound?: string;
  animation?: string;
  screenEffect?: string;
  particles?: string;
  duration?: number;
  volume?: number;
  blockUntilDone?: boolean;
}

/** 前端视图事件——后端 atom 的前端投影。纯数据，可序列化。
 *  索引签名值类型用 unknown 而非 Json:pending 内含 ActionPrompt
 *  (带函数类型),非纯 Json;各 atom 塞任意字段,前端 applyView 用 as 断言读取。
 *  动画/音效(effect)不下发,前端通过 AtomDefinition.effect 静态查表获取。 */
export interface ViewEvent {
  /** 事件类型（与后端 atom type 一致，可按需别名，如 移动牌→弃牌） */
  type: string;
  /**
   * 原始 atom 类型。当 ViewEvent.type 与 atom.type 不同时设置，
   * 前端据此查找 AtomDefinition.applyView。
   * 相同时省略（前端 fallback 到 type）。
   */
  atomType?: string;
  /** 事件数据（已脱敏，只含前端需要的字段） */
  [key: string]: unknown;
  /** 等待信息（仅等待型 atom） */
  pending?: { startTime: number; deadline: number; prompt: ActionPrompt };
}

/** Per-player 视图分叉——toViewEvents 的返回值。key 是座次下标(引擎只认座次) */
export interface ViewEventSplit {
  /** 指定玩家看到的专属视图事件。值为 null = 该玩家看不到此事件 */
  ownerViews: ReadonlyMap<number, ViewEvent | null>;
  /** 其余玩家看到的通用视图事件。null = 其他人不感知此 atom */
  othersView: ViewEvent | null;
}

export type ZoneLoc =
  | { zone: '牌堆' }
  | { zone: '弃牌堆' }
  | { zone: '手牌'; player: number }
  | { zone: '处理区' };

export type Atom =
  // 卡牌/资源
  | { type: '摸牌'; player: number; count: number }
  | { type: '弃置'; player: number; cardIds: string[] }
  | { type: '移动牌'; cardId: string; from: ZoneLoc; to: ZoneLoc }
  | { type: '获得'; player: number; cardId: string; from?: number }
  | { type: '给予'; cardId: string; from: number; to: number }
  | { type: '装备'; player: number; cardId: string }
  | { type: '卸下'; player: number; slot: EquipSlot }
  | { type: '洗牌' }
  | { type: '重洗' }
  | { type: '整理牌堆'; cards: string[]; topCount?: number; bottomCount?: number }
  // 角色状态
  | { type: '造成伤害'; target: number; amount: number; source: number; cardId?: string; damageType?: DamageType }
  | { type: '回复体力'; target: number; amount: number; source?: number }
  | { type: '失去体力'; target: number; amount: number }
  | { type: '陷入濒死'; target: number }
  | { type: '击杀'; player: number }
  // 标记/状态
  // distanceVars: 可选的距离修正 view 同步通道(技能如屯田加田时携带,
  //   applyView 据此同步 view.distanceVars——后端 vars 由技能自行维护)。
  | { type: '加标记'; player: number; mark: Mark; distanceVars?: { attackMod?: number; defenseMod?: number; attackRange?: number } }
  | { type: '去标记'; player: number; markId: string; distanceVars?: { attackMod?: number; defenseMod?: number; attackRange?: number } }
  | { type: '清过期标记'; player: number }
  | { type: '设横置'; player: number; chained: boolean }
  | { type: '设上限'; player: number; amount: number }
  | { type: '加标签'; player: number; tag: string }
  | { type: '去标签'; player: number; tag: string }
  // 技能管理
  | { type: '添加技能'; player: number; skillId: string }
  | { type: '移除技能'; player: number; skillId: string }
  // 流程
  | { type: '回合开始'; player: number }
  | { type: '回合结束'; player: number }
  | { type: '阶段开始'; player: number; phase: string }
  | { type: '阶段结束'; player: number; phase: string }
  | { type: '设阶段'; phase: TurnPhase }
  | { type: '下一玩家' }
  // 目标
  | { type: '指定目标'; source: number; cardId?: string; target: number }
  | { type: '成为目标'; source: number; cardId?: string; target: number }
  // 判定
  | { type: '添加延时锦囊'; player: number; trick: PendingTrick }
  | { type: '移除延时锦囊'; player: number; trickName: string }
  // 拼点
  | { type: '拼点'; initiator: number; target: number; initiatorCard: string; targetCard: string }
  // 初始化
  | { type: '抽身份'; playerCount: number; seed: number }
  | {
      type: '选将询问';
      target: number;
      candidates: Array<{ name: string; skills: string[] }>;
      prompt?: ActionPrompt;
    }
  | {
      type: '并行选将';
      selections: Array<{ target: number; candidates: Array<{ name: string; skills: string[] }> }>;
    }
  | { type: '分配武将'; target: number; character: string; skills: string[] }
  | { type: '初始化洗牌'; seed: number }
  | { type: '发牌'; handSize: number }
  | { type: '判定'; player: number; judgeType: string }
  // 使用结算时机(通用:杀/锦囊等)
  | { type: '检测有效性'; source: number; target: number; cardId: string }
  | { type: '被抵消'; source: number; target: number; cardId: string }
  // 等待回应
  | { type: '询问闪'; target: number; source: number }
  | { type: '询问杀'; target: number; source: number }
  | {
      type: '请求回应';
      requestType: string;
      target: number;
      prompt: ActionPrompt;
      defaultChoice?: Json;
      timeout?: number;
      /** 仅用于 requestType='无懈可击':本次无懈抵消的目标座次(-1=整体抵消/单目标锦囊,N=全体锦囊的某个目标)。
       * 无懈 respond execute 据此翻转 localVars[`无懈/被抵消/${cancelTarget}`]。 */
      cancelTarget?: number;
    }
  // 多目标并行盲选(拼点/选将):为每个 target 创建独立 slot,各独立 resolve
  | {
      type: '并行回应';
      requestType: string;
      targets: number[];
      prompt: ActionPrompt;
      defaultChoice?: Json;
      timeout?: number;
    }
  // 出牌阶段的控制权 token——非阻塞型 pending,表示"当前玩家可自由出牌/用技"。
  // 玩家每次操作都 resolve 它(重建),超时则结束回合。不计入 hasBlockingPending。
  | { type: '出牌窗口'; player: number; timeout?: number }
  // 转化包装:将 N 张手牌当【杀】使用(武圣/丈八蛇矛等通用)
  | { type: '当作'; player: number; cardIds: string[]; shadowId: string; outputName: string; outputDamageType?: '普通' | '火焰' | '雷电' }
  // 结算帧管理(走 atom 管线,保证前后端 settlementStack 同步)
  | { type: '结算帧入栈'; skillId: string; from: number; params?: Record<string, Json> }
  | { type: '结算帧出栈' }
  // 结算帧 params 变更(走 atom,保证前端同步)
  | { type: '帧参数赋值'; key: string; value: Json }
  // 回合用量(view 同步):出杀计数/限一次标记同步到前端 turnUsage
  | { type: '回合用量'; player: number; key: string; value: Json }
  // 周泰·不屈:牌堆顶一张牌作为"创"牌置于武将牌上;点数重复则移去(进弃牌堆)
  | { type: '置创牌'; player: number }
  // 于吉·蛊惑:扣置一张手牌(面朝下移入弃牌堆暂存),声明为某基本牌。牌的真实身份对其他人隐藏。
  // apply:手牌→弃牌堆(面朝下)+ localVars['蛊惑/扣牌'] 记录 cardId 供后续揭示/给牌/生效。
  | { type: '扣牌'; player: number; cardId: string; declaredName: string }
  // 于吉·蛊惑:翻开(展示)已扣置的牌,向所有人公开其真实身份。纯视图事件,不改 state(牌仍在弃牌堆)。
  | { type: '展示'; player: number; cardId: string }
  // 移出至暂存区:把指定玩家的若干牌(手牌/装备)移出游戏,暂存于 target.vars[varsKey]。
  // 通用操作,服务于所有「暂时移出→到时归还」型技能:界谦逊(自身手牌) / 界破军(他人手牌+装备) / 未来的攻心·权计·隐识等。
  // source=操作者(谦逊=自己,破军=徐盛);target=牌主;varsKey=暂存键名(由调用方技能自定义)。
  | { type: '移出至暂存区'; source: number; target: number; cardIds: string[]; varsKey: string }
  // 归还暂存牌:把此前 移出至暂存区 暂存的牌(player.vars[varsKey])归还手牌。
  // 与 移出至暂存区 配对;player 已死亡时牌进弃牌堆。
  | { type: '归还暂存牌'; player: number; varsKey: string };

export interface AtomDefinition<A = unknown> {
  type: string;
  validate(state: GameState, atom: A): string | null;
  apply(state: GameState, atom: A): void;
  /**
   * atom 自身的后处理——在所有技能 after hooks 执行完毕后调用。
   * 用于清理 atom 创建的临时状态(如判定牌从处理区移入弃牌堆)。
   * 与技能 after hooks 区分:这是 atom 定义自身的职责,不是技能 hook。
   */
  afterHooks?(state: GameState, atom: A): void;
  /**
   * atom 自身的「应用后」阶段——在 apply 与视图广播之后、技能 after hooks 之前执行。
   *
   * 用于需要在所有消费方读取 atom 结果前完成的「就地改写」阶段。典型:判定 atom
   * 在此触发改判钩子(鬼才/鬼道),改判完成后消费方(闪电/兵粮寸断等)的 after hook
   * 读到的即为改判后的最终牌。
   *
   * 与 before hooks 区别:before hooks 在 apply 之前、可 cancel/modify atom;afterApply
   * 在 apply 之后、只能就地 mutate state(如改判直接改写结算帧顶牌)。
   * 与技能 after hooks 区别:afterApply 严格先于后者,且承担 atom 级编排职责而非某技能的结算。
   *
   * 可含异步与嵌套 applyAtom(如改判会发起 请求回应 等待玩家)。仅对 apply 能落地、
   * 无 cancel 语义的 atom 有意义;引擎在等待型 atom 的 pending resolve 后也会调用。
   */
  afterApply?(state: GameState, atom: A): Promise<void>;
  pending?: AtomPending<A>;
  /** 并行等待型 atom:声明如何拆分为多个单-target slot。
   *  引擎据此自动拆分,无需硬编码偏序判断。未实现 = 单 target。
   *  返回值中的 slotAtom 作为子 slot 的 atom,会使用自身 type 对应的 def 做 pending。
   *  典型场景:并行回应(拆成 请求回应)、并行选将(拆成 选将询问)。 */
  parallelSplit?: (atom: A) => Array<{ target: number; slotAtom: Atom }>;
  /**
   * 将后端 atom 转换为前端可消费的视图事件。
   *
   * ⚠️ 在 apply 之前调用——此时 state 尚未变更，可以读取即将被消费的数据
   * （如摸牌前读取牌堆顶的牌面信息）。
   *
   * 返回 ViewEventSplit 实现 per-player 信息分级和参数脱敏。
   * ViewEvent 是纯数据（可序列化），不含函数。
   * 未实现 = fallback 到带 effect 的原始 atom（前端回退到全量 buildView）。 */
  toViewEvents?(state: GameState, atom: A): ViewEventSplit | undefined;
  /**
   * 前端视图状态更新。与后端 apply 对称——apply 修改 GameState，applyView 修改 GameView。
   *
   * 前端收到 ViewEvent 后，按 `event.atomType ?? event.type` 查找 AtomDefinition，
   * 调用此函数增量更新 GameView。
   * 未实现 = 前端回退到全量 buildView。
   */
  applyView?(view: GameView, event: ViewEvent): void;
  /** effect 作为 toViewEvents 未实现时的 fallback。 */
  effect?: AtomEffect;
  /**
   * 前端根据 ViewEvent 生成游戏日志条目。纯展示层，不在网络传输中携带。
   * ViewEvent 已含生成日志所需的所有数据（player/target/amount/cardName 等）。
   *
   * event 已经过 toViewEvents 分叉:当前视角能看到的字段（如 owner 的摸牌 cards）
   * 已包含在 event 中。viewer 为当前视角座次，便于进一步判断「我」相关文案。
   * 返回 null 表示该事件不写日志。
   */
  toViewLog?(event: ViewEvent, viewer: number): { player: number; text: string } | null;
}

/**
 * 引擎原子操作管线说明:
 *
 * "操作 gameState 的函数"全部为顶层 export,skill 通过 import 直接调用,
 * 参数显式传 state + 调用参数。例如:`applyAtom(state, atom)` / `pushFrame(state, ...)`。
 */

/**
 * before 钩子对当前 atom 的干预结果。
 * - pass:不干预,管线继续(默认;返回 void 也视为 pass)
 * - modify:修改 atom 参数,管线用新 atom 继续 validate/apply。后续 before 钩子收到修改后的 atom。
 *   典型:藤甲减伤、护甲减伤、酒加伤——叠加生效(座次序)。
 * - cancel:取消当前 atom,不进入 validate/apply/after hooks。
 *   典型:仁王盾黑杀无效、寒冰剑改为弃牌、检测有效性目标无效。后续 before 钩子不再跑。
 *   cancel 是确定性事件:管线推一个 notify 事件让前端感知(非静默)。
 *   调用方可通过 applyAtom 返回值(false)感知 cancel,据此跳过后续逻辑(如杀跳过无效目标)。
 */
export type HookResult = { kind: 'pass' } | { kind: 'modify'; atom: Atom } | { kind: 'cancel' };

/** before 钩子上下文:atom 执行前调用 */
export interface AtomBeforeContext {
  state: GameState;
  atom: Atom;
  /** 钩子注册时的 ownerId(skill 实例的所属玩家,座次下标) */
  ownerId: number;
  /** 当前结算帧(只读) */
  readonly frame: SettlementFrame;
  /** 当前结算帧 params 的只读快照(回应数据通过 dispatch 注入) */
  readonly params: Record<string, Json>;
}

export interface AtomAfterContext {
  state: GameState;
  atom: Atom;
  /** 钩子注册时的 ownerId(skill 实例的所属玩家,座次下标) */
  ownerId: number;
  /** 当前结算帧(只读) */
  readonly frame: SettlementFrame;
  /** 当前结算帧 params 的只读快照(回应数据通过 dispatch 注入) */
  readonly params: Record<string, Json>;
}
