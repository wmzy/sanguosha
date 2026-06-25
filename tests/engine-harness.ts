// tests/engine-harness.ts
// 技能集成测试 harness(用新顶层 API):
//   SkillTestHarness  → state 生命周期 + 玩家索引
//   PlayerSession     → 玩家操作/查询/断言
//   FakeFrontendAPI   → 收集 defineAction 声明
//
// 设计原则:
//   - 用玩家术语(pass / respond / useCard),不暴露 timer/pending/atom 机制
//   - 断言可观察游戏状态(health / hand / zone),不断言内部 atom 序列
//   - 不 mock 任何引擎组件:复用真实 dispatch / apply pipeline
//   - 走 fireTimeout() 触发 onTimeout(语义最准,不需 fake timers)

import type {
  ActionPrompt,
  Atom,
  AtomEffect,
  Card,
  CardWrapper,
  ClientMessage,
  FrontendAPI,
  GameEvent,
  GameState,
  GameView,
  Json,
  TargetFilter,
  ViewEvent,
} from '../src/engine/types';
import {
  dispatch as engineDispatch,
  fireTimeout as engineFireTimeout,
  buildView as engineBuildView,
  resetForTest,
  registerSkillsFromState,
} from '../src/engine/create-engine';

import { getAtomDef } from '../src/engine/atom';
import { getSkillModule } from '../src/engine/skill';

// ─── 引擎异常收集器(消灭盲区 2)──────────────────────────────
// dispatch 的 execute 是 fire-and-forget:其 .catch 调 state.onError?.(e) 后 throw,
// 但该 throw 无人 await → unhandledRejection,在 vitest forks pool 下可能被吞。
// 收集器在首次接触 state 时注入 onError,把异常存到 WeakMap,在断言点统一检查。
// 幂等:同一 state 只注入一次(WeakSet 标记),避免多次调用链式叠加 onError。

const engineErrorMap = new WeakMap<GameState, Error[]>();
const trackedStates = new WeakSet<GameState>();

/** 为 state 注入引擎异常收集器(幂等)。已注入过则 no-op。 */
function trackEngineErrorsIfNotTracked(state: GameState): void {
  if (trackedStates.has(state)) return;
  trackedStates.add(state);
  engineErrorMap.set(state, []);
  const prevOnError = state.onError;
  state.onError = (e: Error) => {
    engineErrorMap.get(state)?.push(e);
    prevOnError?.(e);
  };
}

/** 断言 state 无引擎异常,有则抛出聚合错误。检查后清除(避免重复报)。 */
export function assertNoEngineErrors(state: GameState): void {
  const errors = engineErrorMap.get(state);
  if (!errors || errors.length === 0) return;
  engineErrorMap.set(state, []);  // clear after read
  const msgs = errors.map((e, i) =>
    `  ${i + 1}. ${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}`,
  ).join('\n');
  throw new Error(
    `检测到引擎异常(fire-and-forget execute 抛错,之前会被静默吞掉):\n${msgs}`,
  );
}

// ─── 公开类型 ──────────────────────────────────────────────────

export interface ActionDef {
  skillId: string;
  ownerId: number;
  actionType: string;
  label: string;
  prompt: ActionPrompt;
  transform?: (card: Card) => CardWrapper;
  activeWhen?: (ctx: { view: GameView; perspectiveIdx: number }) => boolean;
}

// ─── FakeFrontendAPI ──────────────────────────────────────────

class FakeFrontendAPI implements FrontendAPI {
  viewer: number;
  private skillId = '';
  private actions: ActionDef[] = [];

  constructor(viewer: number) {
    this.viewer = viewer;
  }

  setCurrentSkill(skillId: string): void {
    this.skillId = skillId;
  }

  defineAction(actionType: string, opts: {
    label: string;
    style?: string;
    prompt: ActionPrompt;
    transform?: (card: Card) => CardWrapper;
    activeWhen?: (ctx: { view: GameView; perspectiveIdx: number }) => boolean;
  }): void {
    this.actions.push({
      skillId: this.skillId,
      ownerId: this.viewer,
      actionType,
      label: opts.label,
      prompt: opts.prompt,
      transform: opts.transform,
      activeWhen: opts.activeWhen,
    });
  }

  onEvent(): () => void { return () => {}; }
  playEffect(): void { /* no-op */ }

  getActions(): ActionDef[] { return this.actions; }
  clearActions(): void { this.actions = []; }
}

// ─── PlayerSession ──────────────────────────────────────────

export class PlayerSession {
  readonly playerIndex: number;
  private harness: SkillTestHarness;
  private frontend: FakeFrontendAPI;
  private lastEventIndex = 0;
  /** 增量维护的 view(通过 viewReducer + applyView 更新) */
  private _processedView: GameView | null = null;

  constructor(playerIndex: number, harness: SkillTestHarness) {
    this.playerIndex = playerIndex;
    this.harness = harness;
    this.frontend = new FakeFrontendAPI(playerIndex);
  }

  /** 在 setup 完成后调用,用当前 state 创建 baseline view */
  initProcessedView(): void {
    this._processedView = engineBuildView(this.harness.state, this.playerIndex);
  }

  /** 从当前 state 重建 processedView 并重置事件游标。
   *  用于测试中手动 mutate state 后重新同步视图。 */
  rebuildView(): void {
    this._processedView = engineBuildView(this.harness.state, this.playerIndex);
    this.lastEventIndex = this.harness.state.atomHistory.length;
  }

  // ─── 视图 ─────────────────────────────────────

  /** 从 state 重建的完整 view(向后兼容,不走 event 路径) */
  get view(): GameView {
    return engineBuildView(this.harness.state, this.playerIndex);
  }

  /** 通过 event + applyView 增量维护的 view。setup 后自动初始化。 */
  get processedView(): GameView {
    if (!this._processedView) {
      throw new Error('processedView: 请先在 setup 后调用 initProcessedView()');
    }
    return this._processedView;
  }

  /** 取自上次以来的新事件(per-player 分叉:toViewEvents → 按 viewer 过滤) */
  newEvents(): ViewEvent[] {
    const all = this.harness.state.atomHistory.slice(this.lastEventIndex);
    this.lastEventIndex = this.harness.state.atomHistory.length;
    return this.splitEventsForPlayer(all as unknown as GameEvent[]);
  }

  /** 将全局 GameEvent 按 toViewEvents 分叉为当前玩家可见的 ViewEvent[] */
  private splitEventsForPlayer(events: GameEvent[]): ViewEvent[] {
    const result: ViewEvent[] = [];
    for (const e of events) {
      if (e.kind === 'atom' && e.viewEvents) {
        const owner = e.viewEvents.ownerViews.get(this.playerIndex);
        if (owner === null) continue;  // 隐藏
        const viewEvent = owner ?? e.viewEvents.othersView;
        if (viewEvent) result.push(viewEvent);
      } else if (e.kind === 'atom') {
        const viewEvent = e.viewEvents?.othersView;
        if (viewEvent) result.push(viewEvent);
      } else if (e.kind === 'notify') {
        const data = e.views ? (e.views.get(String(this.playerIndex)) ?? null) : e.data;
        if (data !== null) {
          result.push({ type: 'notify', skillId: e.skillId, eventType: e.eventType, data } as unknown as ViewEvent);
        }
      }
    }
    return result;
  }

  private applyViewErrors: string[] = [];

  /**
   * 处理新事件:取 per-player 分叉事件,通过 viewReducer(applyView) 增量更新 processedView。
   * 每次 dispatch/pass 后自动调用。断言前必须先 processEvents()。
   * applyView 抛错不静默吞:收集到 applyViewErrors,在 processAllEvents 末尾统一检查。
   */
  processEvents(): ViewEvent[] {
    const events = this.newEvents();
    for (const evt of events) {
      const raw = evt as Record<string, unknown>;
      const type = typeof raw.atomType === 'string' ? raw.atomType : (typeof raw.type === 'string' ? raw.type : '');
      // notify 事件(pendingResolved 等):单独处理
      if (type === 'notify') {
        const eventType = raw.eventType as string | undefined;
        if (eventType === 'pendingResolved') {
          const data = raw.data as { target?: number } | undefined;
          const target = data?.target;
          if (target === undefined) continue;
          if (target < 0) {
            this.processedView.pending = null;
          } else if (this.processedView.pending && this.processedView.pending.target === target) {
            this.processedView.pending = null;
          }
        }
        continue;
      }
      if (!type) continue;
      try {
        const def = getAtomDef(type);
        if (def.applyView) {
          def.applyView(this.processedView, evt);
        }
        // 与真实前端 src/client/view/reducer.ts:viewReducer 对齐:
        // applyView 后调 toViewLog 生成日志条目。time 取事件 seq 近似(测试不需要真实时间)。
        const logEntry = def.toViewLog?.(evt);
        if (logEntry) {
          this.processedView.log.push({
            time: (evt as Record<string, unknown>).seq as number ?? 0,
            player: logEntry.player,
            text: logEntry.text,
          });
        }
      } catch (e) {
        // 不再静默吞:记录错误,processAllEvents 末尾统一抛出
        const msg = e instanceof Error ? e.message : String(e);
        this.applyViewErrors.push(`atom '${type}': ${msg}`);
      }
    }
    return events;
  }

  /** 取出并清除收集到的 applyView 错误。空则返回 null。 */
  drainApplyViewErrors(): string[] | null {
    if (this.applyViewErrors.length === 0) return null;
    const errs = this.applyViewErrors;
    this.applyViewErrors = [];
    return errs;
  }

  availableActions(): ActionDef[] {
    return this.frontend.getActions();
  }

  // ─── 操作 ─────────────────────────────────────

  async useCardAndTarget(skillId: string, cardId: string, targets: number[]): Promise<void> {
    return this.dispatch({ skillId, actionType: 'use', params: { cardId, targets } });
  }

  async useCard(skillId: string, cardId: string): Promise<void> {
    return this.dispatch({ skillId, actionType: 'use', params: { cardId } });
  }

  async respond(skillId: string, params?: Record<string, Json>): Promise<void> {
    return this.dispatch({ skillId, actionType: 'respond', params: params ?? {} });
  }

  /**
   * 不出牌 / 不发动(放弃当前 pending)。
   * 用 fireTimeout 触发 onTimeout(resolve 当前 pending,不依赖具体技能注册)。
   * 这是通用路径——不要求玩家拥有被询问的技能(如不出闪不要求有闪技能)。
   * 弃牌阶段超时会自动弃(与真实游戏一致),其他询问 onTimeout 无副作用。
   */
  async pass(): Promise<void> {
    await engineFireTimeout(this.harness.state);
    await this.harness.waitForStable();
    this.harness.processAllEvents();
  }

  /** 确认/取消(八卦阵、遗计确认等)。choice=false 等同 pass()。 */
  async confirm(choice: boolean): Promise<void> {
    if (!choice) {
      await this.pass();
      return;
    }
    const slot = [...this.harness.state.pendingSlots.values()][0];
    if (!slot) throw new Error('confirm() 但无 pending');
    await this.dispatch({
      skillId: (slot.atom as Record<string, Json>).requestType as string ?? '请求回应',
      actionType: 'confirm',
      params: { choice: true },
    });
  }

  /** 分配(遗计分配牌等)。通过 ClientMessage 的 preceding merge 到 localVars。 */
  async distribute(
    skillId: string,
    allocation: Array<{ target: number; cardIds: string[] }>,
  ): Promise<void> {
    return this.dispatch({ skillId, actionType: 'distribute', params: { allocation } });
  }

  async triggerAction(
    skillId: string,
    actionType: string,
    params?: Record<string, Json>,
  ): Promise<void> {
    return this.dispatch({ skillId, actionType, params: params ?? {} });
  }

  // ─── 辅助选择 ─────────────────────────────────

  findValidCard(actionType: string, extraFilter?: (card: Card) => boolean): Card | null {
    const actions = this.frontend.getActions().filter(a => a.actionType === actionType);
    for (const action of actions) {
      const filter = extractCardFilter(action.prompt);
      if (!filter) continue;
      const player = this.harness.state.players[this.playerIndex];
      for (const cardId of player?.hand ?? []) {
        const card = this.harness.state.cardMap[cardId];
        if (card && filter(card) && (!extraFilter || extraFilter(card))) {
          return card;
        }
      }
    }
    return null;
  }

  findValidTargets(actionType: string, count?: number): number[] {
    const actions = this.frontend.getActions().filter(a => a.actionType === actionType);
    for (const action of actions) {
      const filter = extractTargetFilter(action.prompt);
      if (!filter) continue;
      const result: number[] = [];
      for (const player of this.harness.state.players) {
        if (player.index === this.playerIndex) continue;
        if (!filter.filter || filter.filter(this.view, player.index)) {
          result.push(player.index);
        }
      }
      if (result.length >= (count ?? 1)) return result.slice(0, count ?? result.length);
    }
    return [];
  }

  // ─── 断言 ─────────────────────────────────────

  expectPending(atomType: string): void {
    const slots = this.harness.state.pendingSlots;
    if (slots.size === 0) throw new Error(`expectPending('${atomType}'): 无 pending`);
    const slot = [...slots.values()][0];
    const type = (slot.atom as { type: string }).type;
    if (type !== atomType) throw new Error(`expectPending('${atomType}'): 实际 pending 是 '${type}'`);
  }

  expectNoPending(): void {
    if (this.harness.state.pendingSlots.size > 0) {
      const slot = [...this.harness.state.pendingSlots.values()][0];
      const type = (slot.atom as { type: string }).type;
      throw new Error(`expectNoPending(): 实际有 pending '${type}'`);
    }
  }

  // ─── 断言:validate 拒绝 ─────────────────────

  /**
   * 发出一个 action,断言它被 validate 拒绝(dispatch 返回 false,state.seq 不增加)。
   * 用于负面测试:不自己回合出牌 / pending 期间出牌 / 死人出牌 / 无牌出牌等。
   */
  async expectRejected(
    msg: Omit<ClientMessage, 'ownerId' | 'baseSeq'>,
  ): Promise<void> {
    const accepted = await this.tryDispatch(msg);
    if (accepted) {
      throw new Error(`期望 action 被拒绝,但被接受了: ${msg.skillId}/${msg.actionType} ${JSON.stringify(msg.params)}`);
    }
  }

  /** 发出一个 action,断言它被接受(state.seq 增加) */
  async expectAccepted(
    msg: Omit<ClientMessage, 'ownerId' | 'baseSeq'>,
  ): Promise<void> {
    const accepted = await this.tryDispatch(msg);
    if (!accepted) {
      throw new Error(`期望 action 被接受,但被拒绝了: ${msg.skillId}/${msg.actionType} ${JSON.stringify(msg.params)}`);
    }
  }

  /** 断言事件流中包含指定 atom 类型(子序列匹配,忽略 notify 事件) */
  expectAtoms(...types: string[]): void {
    const atoms = (this.harness.state.atomHistory as Array<{ kind: string; atom?: { type: string } }>)
      .filter(e => e.kind === 'atom')
      .map(e => e.atom?.type ?? '')
      .filter(t => t !== '');
    let searchFrom = 0;
    for (const t of types) {
      const idx = atoms.indexOf(t, searchFrom);
      if (idx < 0) throw new Error(`expectAtoms: 事件流中未找到 '${t}'(按序)。已有: ${atoms.join(', ')}`);
      searchFrom = idx + 1;
    }
  }

  /** 断言事件流的 atom 类型严格匹配(忽略 notify 事件) */
  expectExactAtoms(...types: string[]): void {
    const atoms = (this.harness.state.atomHistory as Array<{ kind: string; atom?: { type: string } }>)
      .filter(e => e.kind === 'atom')
      .map(e => e.atom?.type ?? '')
      .filter(t => t !== '');
    const expected = types.join(', ');
    const actual = atoms.join(', ');
    if (expected !== actual) {
      throw new Error(`expectExactAtoms: 期望 [${expected}],实际 [${actual}]`);
    }
  }

  /**
   * 断言 processedView 内容。fn 接收当前玩家的增量 view,可在其中检查字段。
   * 必须在 processEvents() 之后调用。
   */
  expectView(fn: (view: GameView) => void): void {
    if (!this._processedView) {
      throw new Error('expectView(): 请先调用 processEvents() 初始化 processedView');
    }
    try {
      fn(this._processedView);
    } catch (e) {
      const view = this._processedView;
      const players = view.players.map(p => `P${p.index}:${p.character || '?'} hp=${p.health} hand=${p.handCount}`).join(', ');
      throw new Error(`expectView 断言失败: ${players}\n${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * 断言 processedView 中指定玩家的角色名。
   */
  expectCharacter(playerIndex: number, expected: string): void {
    this.expectView(v => {
      const p = v.players.find(pl => pl.index === playerIndex);
      if (!p) throw new Error(`玩家 ${playerIndex} 不存在`);
      if (p.character !== expected) {
        throw new Error(`P${playerIndex}.character = '${p.character}', 期望 '${expected}'`);
      }
    });
  }

  // ─── pending 回应推导(等价于前端 pendingRespondInfo) ───

  /**
   * 从当前 pending + skillActions(defineAction 声明)推导 respond 信息。
   * skillId: 从 atom type/requestType 通用推导。
   * cardFilter: 从 FakeFrontendAPI 收集的 respond action 声明取(原始函数引用,不丢)。
   * 返回 null = 当前无 pending 或无法推导。
   */
  respondInfo(): { skillId: string; cardFilter?: (c: Card) => boolean } | null {
    const slots = this.harness.state.pendingSlots;
    const mySlot = slots.get(this.playerIndex);
    const broadcastSlot = [...slots.values()].find(s => {
      const t = (s.atom as { target?: unknown }).target;
      return typeof t === 'number' && t < 0;
    });
    const slot = mySlot ?? broadcastSlot ?? (slots.size === 1 ? [...slots.values()][0] : undefined);
    if (!slot) return null;
    const atom = slot.atom as Record<string, unknown>;
    const atomType = (atom['type'] as string) ?? '';
    const reqType = typeof atom['requestType'] === 'string' ? (atom['requestType'] as string) : '';

    // 通用推导 skillId
    let skillId: string | null = null;
    if (atomType.startsWith('询问')) {
      skillId = atomType.slice(2);
    } else if (reqType === '__弃牌') {
      skillId = '系统规则';
    } else if (atomType === '请求回应' || atomType === '并行回应') {
      skillId = reqType.includes('/') ? reqType.slice(0, reqType.indexOf('/')) : (reqType || null);
    }
    if (!skillId) return null;

    // 从 FakeFrontendAPI 收集的 action 声明取 cardFilter(函数引用)
    const action = this.frontend.getActions().find(a => a.skillId === skillId && a.actionType === 'respond');
    const cardFilter = action ? extractCardFilter(action.prompt) ?? undefined : undefined;
    return { skillId, cardFilter };
  }

  /** 当前 pending 下可出的牌(用 respondInfo 的 cardFilter 过滤手牌) */
  respondableCards(): Card[] {
    const info = this.respondInfo();
    if (!info?.cardFilter) return [];
    const player = this.harness.state.players[this.playerIndex];
    if (!player) return [];
    const result: Card[] = [];
    for (const cardId of player.hand) {
      const card = this.harness.state.cardMap[cardId];
      if (card && info.cardFilter!(card)) result.push(card);
    }
    return result;
  }

  // ─── 组合 action(转化技) ─────────────────────

  /**
   * 转化后使用(武圣红牌当杀):preceding=[转化] + 主 action(使用)。
   * @param transformSkill 转化技能 id(如 '武圣')
   * @param transformParams 转化参数(如 { cardId })
   * @param useSkill 使用技能 id(如 '杀')
   * @param useParams 使用参数(如 { cardId: 'c1#武圣', targets: [1] })
   */
  async transformThenUse(
    transformSkill: string,
    transformParams: Record<string, Json>,
    useSkill: string,
    useParams: Record<string, Json>,
  ): Promise<void> {
    return this.dispatch({
      skillId: useSkill,
      actionType: 'use',
      params: useParams,
      preceding: [{ skillId: transformSkill, actionType: 'transform', params: transformParams }],
    });
  }

  // ─── 前端技能加载 ─────────────────────────────

  async loadFrontend(): Promise<void> {
    const player = this.harness.state.players[this.playerIndex];
    if (!player) return;
    this.frontend.clearActions();
    for (const skillId of player.skills) {
      const module = await getSkillModule(skillId);
      this.frontend.setCurrentSkill(skillId);
      if (module.onMount) {
        module.onMount({ id: skillId, ownerId: this.playerIndex, name: skillId, description: '' }, this.frontend);
      }
    }
  }

  /**
   * 发出 action 并返回是否被接受(dispatch 返回 boolean)。
   * validate 拒绝时 dispatch 返回 false,execute 成功时返回 true。
   */
  async tryDispatch(
    msg: Omit<ClientMessage, 'ownerId' | 'baseSeq'>,
  ): Promise<boolean> {
    const accepted = await engineDispatch(this.harness.state, {
      ...msg,
      ownerId: this.playerIndex,
      baseSeq: this.harness.state.seq,
    }).catch(() => false);
    await this.harness.waitForStable();
    return accepted;
  }

  private async dispatch(
    msg: Omit<ClientMessage, 'ownerId' | 'baseSeq'>,
  ): Promise<void> {
    await this.tryDispatch(msg);
    // 推进所有 player 的事件:真实前端是 broadcastNewState 给所有连接推 events,
    // 每个连接的 handleMessage 都会处理。harness 必须模拟这个广播语义。
    this.harness.processAllEvents();
  }
}

// ─── SkillTestHarness ──────────────────────────────────────────

export class SkillTestHarness {
  private _state!: GameState;
  private sessions = new Map<number, PlayerSession>();

  /** 初始化:重置引擎 → bootstrap state → 为每个玩家创建 session 并加载 onMount */
  async setup(state: GameState): Promise<void> {
    resetForTest();
    // 补全 state 缺失字段
    if (!state.cardWrappers) state.cardWrappers = {};
    if (!state.atomStack) state.atomStack = [];
    if (!state.settlementStack) state.settlementStack = [];
    if (!state.startedAt) state.startedAt = Date.now();
    for (const p of state.players) {
      if (!p.judgeZone) p.judgeZone = [];
      if (!p.tags) p.tags = [];
    }
    this._state = state;
    // 注入引擎异常收集器(幂等):setup 后 state.onError 被接管,
    // 所有 fire-and-forget execute 抛错都被收集到 WeakMap,在断言点暴露。
    trackEngineErrorsIfNotTracked(state);
    // 自动填充测试牌堆(如果为空):创建 N 张测试牌供摸牌 atom 使用
    if (state.zones.deck.length === 0) {
      for (let i = 0; i < 20; i++) {
        const id = `__test_deck_${i}`;
        state.cardMap[id] = { id, name: i % 3 === 0 ? '杀' : i % 3 === 1 ? '闪' : '桃', suit: '♠', rank: String(i + 2), type: '基本牌' };
        state.zones.deck.push(id);
      }
    }
    await registerSkillsFromState(state);
    this.sessions.clear();
    for (const player of state.players) {
      const session = new PlayerSession(player.index, this);
      await session.loadFrontend();
      session.initProcessedView();
      this.sessions.set(player.index, session);
    }
  }

  /**
   * 等到 state 稳定:有 pendingSlot(等玩家输入)或 execute 跑完(无 pending 且 atomStack 空)。
   * 委托给模块级 waitForStable。
   */
  async waitForStable(): Promise<void> {
    await waitForStable(this._state);
  }

  /**
   * 推进所有 player session 的 processedView,并自动对比每个 viewer 的
   * processedView 与 buildView(权威全量)是否一致。
   * 模拟真实前端 broadcastNewState 后所有连接都收到 events 的语义。
   * 在任何 dispatch/pass/respond 后自动调用。
   *
   * 自动对比:toViewEvents/applyView 的契约是增量视图必须收敛于全量视图。
   * 一旦某 atom 的前端投影与后端 apply 不对称,这里立即报出,无需测试手写对比。
   */
  processAllEvents(): void {
    // 1. 引擎异常检查(高优先级:execute fire-and-forget 抛错最先暴露)
    assertNoEngineErrors(this._state);
    // 2. applyView 错误检查(各 session processEvents 中收集)
    const sessions = [...this.sessions.values()];
    for (const session of sessions) {
      session.processEvents();
    }
    // 3. 检查 applyView 错误:各 session drainApplyViewErrors
    const allApplyViewErrors: string[] = [];
    for (const session of sessions) {
      const errs = session.drainApplyViewErrors();
      if (errs) {
        allApplyViewErrors.push(`--- viewer=${session.playerIndex} ---\n` +
          errs.map((e, i) => `  ${i + 1}. ${e}`).join('\n'));
      }
    }
    if (allApplyViewErrors.length > 0) {
      throw new Error(
        `applyView 抛错(之前会被静默吞掉):\n\n` +
        allApplyViewErrors.join('\n\n'),
      );
    }
    // 4. 视图一致性自动对比(buildView vs processedView)
    if (autoCompareEnabled) {
      // 收集所有 viewer 的差异后一次性抛出,避免只看到第一个 viewer 的问题
      const allDiffs: string[] = [];
      for (const session of sessions) {
        const baseline = engineBuildView(this._state, session.playerIndex);
        const expected = normalizeViewForCompare(baseline);
        const actual = normalizeViewForCompare(session.processedView);
        const diffs = deepDiff(expected, actual);
       
        if (diffs.length > 0) {
          allDiffs.push(`--- viewer=${session.playerIndex} ---\n` + diffs.map((d, i) => `  ${i + 1}. ${d}`).join('\n'));
        }
      }
      if (allDiffs.length > 0) {
        throw new Error(
          `视图不一致(buildView 权威 vs processedView 增量)。\n` +
          `通常意味着某 atom 的 toViewEvents/applyView 与 apply 不对称:\n\n` +
          allDiffs.join('\n\n'),
        );
      }
    }
  }

  /** 按名字或座次取玩家 session(测试可传 'P1' 或 0) */
  player(nameOrIndex: string | number): PlayerSession {
    const index = typeof nameOrIndex === 'number'
      ? nameOrIndex
      : this._state.players.findIndex(p => p.name === nameOrIndex);
    const session = this.sessions.get(index);
    if (!session) throw new Error(`Player ${nameOrIndex} not found in harness`);
    return session;
  }

  get state(): GameState {
    if (!this._state) throw new Error('SkillTestHarness.state: setup() 未调用');
    return this._state;
  }

  /** 从当前 state 重建所有 player session 的 processedView。
   *  用于测试中手动 mutate state 后重新同步视图。 */
  rebuildViews(): void {
    for (const session of this.sessions.values()) {
      session.rebuildView();
    }
  }

  get events(): GameEvent[] {
    return this.state.atomHistory as unknown as GameEvent[];
  }
}

// ─── 视图一致性自动对比 ────────────────────────────────────────
// 每次 processAllEvents 后对每个 viewer 自动对比:
//   buildView(state, viewer)(权威全量重建)
//   vs
//   processedView(事件流 applyView 增量维护)
// 二者必须收敛——这正是 toViewEvents/applyView 的契约。
// 排除非 atom 职责字段(log 来源不同 / deadline 是 Date.now() 近似值 / prompt 内含函数)。
// 不一致时收集所有差异后一次性抛出,便于定位。

/** 控制自动对比开关(测试可用 disableAutoCompare() 临时关闭) */
let autoCompareEnabled = true;

/** 关闭自动对比(返回恢复函数)。仅用于绕过已知不可比场景。 */
export function disableAutoCompare(): () => void {
  const prev = autoCompareEnabled;
  autoCompareEnabled = false;
  return () => { autoCompareEnabled = prev; };
}

/** 规范化 prompt 用于对比:只留 type/title/min/max,丢弃 filter 函数(不可比) */
function normalizePrompt(prompt: ActionPrompt | undefined): unknown {
  if (!prompt) return null;
  const base: Record<string, unknown> = { type: prompt.type };
  if ('title' in prompt && prompt.title) base.title = prompt.title;
  // cardFilter:只比 min/max,filter 是函数不可比
  if ('cardFilter' in prompt && prompt.cardFilter) {
    base.cardFilter = { min: prompt.cardFilter.min, max: prompt.cardFilter.max };
  }
  // targetFilter: 只 SelectTargetPrompt / UseCardAndTargetPrompt 有 TargetFilter(含 min/max);
  // DistributePrompt.targetFilter 是函数不可比。按 type 收窄。
  if ((prompt.type === 'selectTarget' || prompt.type === 'useCardAndTarget') && prompt.targetFilter) {
    base.targetFilter = { min: prompt.targetFilter.min, max: prompt.targetFilter.max };
  }
  return base;
}

/** 规范化 pending 用于对比:type/target/atomType 总比;prompt 仅对 target viewer
 *  (可操作)比 —— observer(非 target)的 prompt 是展示装饰,buildView(初始/重连)
 *  与 applyView(事件流)的 observer prompt 标题可能不同(如"等待回应" vs "等待出闪"),
 *  属预期差异,不纳入对比。丢弃 deadline/totalMs(Date.now() 近似值)。 */
function normalizePending(pending: GameView['pending'], viewer: number): unknown {
  if (!pending) return null;
  const isOwner = pending.target === viewer;
  return {
    type: pending.type,
    target: pending.target,
    atomType: pending.atom?.type,
    // 仅 target viewer 比可操作 prompt;observer 的 prompt 跳过
    ...(isOwner ? { prompt: normalizePrompt(pending.prompt) } : {}),
  };
}

/** 规范化整个 view 用于对比:去掉非 atom 职责字段,规范化含函数的字段 */
function normalizeViewForCompare(view: GameView): unknown {
  return {
    viewer: view.viewer,
    currentPlayerIndex: view.currentPlayerIndex,
    phase: view.phase,
    turn: view.turn,
    players: view.players.map(p => ({
      index: p.index,
      name: p.name,
      character: p.character,
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      equipment: p.equipment,
      skills: p.skills,
      handCount: p.handCount,
      // hand 是 owner 专属:owner 见牌面,其他人 undefined。两边都按 viewer 走 buildView,
      // 所以同一 viewer 的 hand 可比。card 是纯数据可深比。
      hand: p.hand,
      marks: p.marks,
      identity: p.identity,
      identityHidden: p.identityHidden,
      distanceVars: p.distanceVars,
      pendingTricks: p.pendingTricks,
    })),
    // cardMap 是全局共享纯数据,可比(但量大,只在不一致时报具体 key)
    cardMap: view.cardMap,
    pending: normalizePending(view.pending, view.viewer),
    zones: view.zones,
    // log: 排除 —— buildView 用 actionLog(formatLogEntry),
    // processedView 用 toViewLog(ViewEvent),来源不同。log 完整性由专门检查覆盖。
    // deadline/deadlineTotalMs: 排除 —— Date.now() 近似值,两条路径必不同步。
  };
}

/** 深度比较两个值,函数视为相等(不可比)。返回差异路径列表(空=一致)。 */
function deepDiff(expected: unknown, actual: unknown, path = ''): string[] {
  // 函数不可比 —— 跳过(标记相等)
  if (typeof expected === 'function' || typeof actual === 'function') return [];
  // 严格相等(含 undefined/null/number/string/boolean)
  if (Object.is(expected, actual)) return [];
  // 类型不同
  const eType = expected === null ? 'null' : typeof expected;
  const aType = actual === null ? 'null' : typeof actual;
  if (eType !== aType) return [`${path || '<root>'}: 类型期望 ${eType},实际 ${aType} (期望 ${JSON.stringify(expected)},实际 ${JSON.stringify(actual)})`];
  // 数组
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path || '<root>'}: 期望数组,实际非数组`];
    const diffs: string[] = [];
    const maxLen = Math.max(expected.length, actual.length);
    for (let i = 0; i < maxLen; i++) {
      const d = deepDiff(expected[i], actual[i], `${path}[${i}]`);
      diffs.push(...d);
    }
    return diffs;
  }
  // 对象
  if (eType === 'object') {
    const diffs: string[] = [];
    const keys = new Set([...Object.keys(expected as object), ...Object.keys(actual as object)]);
    for (const key of keys) {
      const e = (expected as Record<string, unknown>)[key];
      const a = (actual as Record<string, unknown>)[key];
      const d = deepDiff(e, a, path ? `${path}.${key}` : key);
      diffs.push(...d);
    }
    return diffs;
  }
  // 原始值不等
  return [`${path || '<root>'}: 期望 ${JSON.stringify(expected)},实际 ${JSON.stringify(actual)}`];
}

/**
 * 对比单个 viewer 的 processedView(事件流增量)与 buildView(state, viewer)(权威全量)。
 * 不一致时抛出含所有差异的详细错误。
 * 这是 toViewEvents/applyView 契约的自动验证器:增量视图必须收敛于全量视图。
 */
export function assertViewConsistency(view: GameView, state: GameState, viewer: number): void {
  const baseline = engineBuildView(state, viewer);
  const expected = normalizeViewForCompare(baseline);
  const actual = normalizeViewForCompare(view);
  const diffs = deepDiff(expected, actual);
  if (diffs.length === 0) return;
  const header = `视图不一致 [viewer=${viewer}]:(buildView 权威 vs processedView 增量)
  这通常意味着某 atom 的 toViewEvents/applyView 与 apply 不对称。
  diff 基准 = buildView(state, ${viewer}),被比 = processedView`;
  const body = diffs.map((d, i) => `  ${i + 1}. ${d}`).join('\n');
  throw new Error(`${header}\n${body}`);
}

// ─── 内部 helper(私有) ───────────────────────────────────────

/** 从 ActionPrompt 中提取 cardFilter(filter 函数 + min/max) */
function extractCardFilter(prompt: ActionPrompt): ((c: Card) => boolean) | null {
  switch (prompt.type) {
    case 'useCard':
    case 'useCardAndTarget':
      return prompt.cardFilter.filter ?? null;
    default:
      return null;
  }
}

/** 从 ActionPrompt 中提取 targetFilter */
function extractTargetFilter(prompt: ActionPrompt): TargetFilter | null {
  switch (prompt.type) {
    case 'selectTarget':
    case 'useCardAndTarget':
      return prompt.targetFilter;
    default:
      return null;
  }
}

/**
 * dispatch 的 fire-and-forget 包装:启动 dispatch 后等到 state 稳定。
 * 手写集成测试(直接用 dispatch、不经 SkillTestHarness)用此函数替代 `await dispatch(...)`。
 * 等价于 `void dispatch(state, msg); await waitForStable(state);`,但会 rethrow dispatch 的 rejection。
 */
export async function dispatchAndWait(state: GameState, message: ClientMessage): Promise<void> {
  // fire-and-forget:不 await dispatch 的 promise(主动 action 的 execute 会挂在 pending 上永不 resolve)。
  // waitForStable 负责等到下一个稳定点(pending 创建或 execute 跑完),并检查引擎异常。
  void engineDispatch(state, message);
  await waitForStable(state);
}

/**
 * fireTimeout 包装:触发超时后等到 state 稳定(父 execute resume 跑到下一个 pending 或结束)。
 * 手写集成测试用此替代 `await fireTimeout(state)`。
 */
export async function fireTimeoutAndWait(state: GameState): Promise<void> {
  await engineFireTimeout(state);
  await waitForStable(state);
}

/**
 * 等到 state 稳定:有 pendingSlot(等玩家输入)或 execute 跑完(无 pending 且 atomStack 空)。
 * dispatch fire-and-forget 后用它拿到下一个稳定点。
 * 用轮询 + 短超时:fire-and-forget 的 execute 在微任务队列里推进,
 * 轮询能捕获到它建 pending 或跑完;连续 20ms 无变化且 atomStack 空则认为稳定。
 *
 * 手写集成测试(直接用 dispatch、不经 SkillTestHarness)可 import 此函数。
 */
export async function waitForStable(state: GameState): Promise<void> {
  trackEngineErrorsIfNotTracked(state);
  const deadline = Date.now() + 2000;
  let lastChange = Date.now();
  let lastSnapshot = '';
  // 先检查一次:若入口时 execute 已抛错,立即暴露
  assertNoEngineErrors(state);
  const yieldToMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));
  while (Date.now() < deadline) {
    await yieldToMicrotasks();
    // execute 在 fire-and-forget 链里抛错 → 收集器已捕获,这里立即 throw,不等超时
    assertNoEngineErrors(state);
    const snapshot = `${state.pendingSlots.size}|${state.atomStack.length}|${state.seq}`;
    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      lastChange = Date.now();
    }
    if (state.pendingSlots.size > 0) return;
    if (state.atomStack.length === 0 && Date.now() - lastChange > 20) return;
  }
  // 超时不再静默返回:若已经稳定(pendingSlots>0 刚被清错判)则正常,
  // 否则报错,避免测试基于半成品 state 断言出假绿。
  // 真正的稳定点一定是 pendingSlots>0 或 atomStack 清空。能走到这里说明 execute 卡住了。
  if (state.pendingSlots.size === 0 && state.atomStack.length > 0) {
    throw new Error(
      `waitForStable 超时(2s):atomStack 非空(${state.atomStack.length})且无 pending。\n` +
      `execute 可能卡在 fire-and-forget 链上未推进。atomStack 顶: ${state.atomStack[state.atomStack.length - 1]?.type ?? 'unknown'}`,
    );
  }
}
