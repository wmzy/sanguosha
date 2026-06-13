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
} from '../src/engine/types';
import {
  dispatch as engineDispatch,
  fireTimeout as engineFireTimeout,
  buildView as engineBuildView,
  resetForTest,
  rebootstrap,
} from '../src/engine/create-engine';
import { getEventCount, getEvents } from '../src/engine/event-stream';
import { getSkillModule } from '../src/engine/skill';

// ─── 公开类型 ──────────────────────────────────────────────────

export interface ActionDef {
  skillId: string;
  ownerId: string;
  actionType: string;
  label: string;
  prompt: ActionPrompt;
  transform?: (card: Card) => CardWrapper;
}

// ─── FakeFrontendAPI ──────────────────────────────────────────

class FakeFrontendAPI implements FrontendAPI {
  viewer: string;
  private skillId = '';
  private actions: ActionDef[] = [];

  constructor(viewer: string) {
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
  }): void {
    this.actions.push({
      skillId: this.skillId,
      ownerId: this.viewer,
      actionType,
      label: opts.label,
      prompt: opts.prompt,
      transform: opts.transform,
    });
  }

  onEvent(): () => void { return () => {}; }
  playEffect(): void { /* no-op */ }

  getActions(): ActionDef[] { return this.actions; }
  clearActions(): void { this.actions = []; }
}

// ─── PlayerSession ──────────────────────────────────────────

export class PlayerSession {
  readonly playerName: string;
  private harness: SkillTestHarness;
  private frontend: FakeFrontendAPI;
  private lastEventIndex = 0;

  constructor(playerName: string, harness: SkillTestHarness) {
    this.playerName = playerName;
    this.harness = harness;
    this.frontend = new FakeFrontendAPI(playerName);
  }

  // ─── 视图 ─────────────────────────────────────

  get view(): GameView {
    return engineBuildView(this.harness.state, this.harness.state.players.findIndex(p => p.name === this.playerName));
  }

  get newEvents(): GameEvent[] {
    const all = getEvents(0);
    const slice = all.slice(this.lastEventIndex);
    this.lastEventIndex = all.length;
    return slice;
  }

  availableActions(): ActionDef[] {
    return this.frontend.getActions();
  }

  // ─── 操作 ─────────────────────────────────────

  async useCardAndTarget(skillId: string, cardId: string, targets: string[]): Promise<void> {
    return this.dispatch({ skillId, actionType: 'use', params: { cardId, targets } });
  }

  async useCard(skillId: string, cardId: string): Promise<void> {
    return this.dispatch({ skillId, actionType: 'use', params: { cardId } });
  }

  async respond(skillId: string, params?: Record<string, Json>): Promise<void> {
    return this.dispatch({ skillId, actionType: 'respond', params: params ?? {} });
  }

  async pass(): Promise<void> {
    await engineFireTimeout(this.harness.state);
  }

  /** 确认/取消(八卦阵、遗计确认等)。choice=false 等同 pass()。 */
  async confirm(choice: boolean): Promise<void> {
    if (!choice) {
      await this.pass();
      return;
    }
    const slot = this.harness.state.pendingSlot;
    if (!slot) throw new Error('confirm() 但无 pending');
    return this.dispatch({
      skillId: (slot.atom as Record<string, Json>).requestType as string ?? '请求回应',
      actionType: 'confirm',
      params: { choice: true },
    });
  }

  /** 分配(遗计分配牌等)。params 通过 dispatch merge 到 topFrame,原始 execute 通过 ctx.params.allocation 读取。 */
  async distribute(
    skillId: string,
    allocation: Array<{ target: string; cardIds: string[] }>,
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
      for (const cardId of this.harness.state.players.find(p => p.name === this.playerName)?.hand ?? []) {
        const card = this.harness.state.cardMap[cardId];
        if (card && filter(card) && (!extraFilter || extraFilter(card))) {
          return card;
        }
      }
    }
    return null;
  }

  findValidTargets(actionType: string, count?: number): string[] {
    const actions = this.frontend.getActions().filter(a => a.actionType === actionType);
    for (const action of actions) {
      const filter = extractTargetFilter(action.prompt);
      if (!filter) continue;
      const result: string[] = [];
      for (const player of this.harness.state.players) {
        if (player.name === this.playerName) continue;
        if (!filter.filter || filter.filter(this.view, player.name)) {
          result.push(player.name);
        }
      }
      if (result.length >= (count ?? 1)) return result.slice(0, count ?? result.length);
    }
    return [];
  }

  // ─── 断言 ─────────────────────────────────────

  expectPending(atomType: string): void {
    const slot = this.harness.state.pendingSlot;
    if (!slot) throw new Error(`expectPending('${atomType}'): 无 pending`);
    const type = (slot.atom as { type: string }).type;
    if (type !== atomType) throw new Error(`expectPending('${atomType}'): 实际 pending 是 '${type}'`);
  }

  expectNoPending(): void {
    const slot = this.harness.state.pendingSlot;
    if (slot) {
      const type = (slot.atom as { type: string }).type;
      throw new Error(`expectNoPending(): 实际有 pending '${type}'`);
    }
  }

  // ─── 前端技能加载 ─────────────────────────────

  loadFrontend(): void {
    const player = this.harness.state.players.find(p => p.name === this.playerName);
    if (!player) return;
    this.frontend.clearActions();
    for (const skillId of player.skills) {
      const module = getSkillModule(skillId);
      this.frontend.setCurrentSkill(skillId);
      if (module.onMount) {
        module.onMount({ id: skillId, ownerId: this.playerName, name: skillId, description: '' }, this.frontend);
      }
    }
  }

  private async dispatch(
    msg: Omit<ClientMessage, 'ownerId' | 'baseSeq'>,
  ): Promise<void> {
    const result = await engineDispatch(this.harness.state, {
      ...msg,
      ownerId: this.playerName,
      baseSeq: this.harness.state.seq,
    });
    if (result.error) throw new Error(`dispatch error: ${result.error}`);
  }
}

// ─── SkillTestHarness ──────────────────────────────────────────

export class SkillTestHarness {
  private _state!: GameState;
  private sessions = new Map<string, PlayerSession>();

  /** 初始化:重置引擎 → bootstrap state → 为每个玩家创建 session 并加载 onMount */
  setup(state: GameState): void {
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
    rebootstrap(state);
    this.sessions.clear();
    for (const player of state.players) {
      const session = new PlayerSession(player.name, this);
      session.loadFrontend();
      this.sessions.set(player.name, session);
    }
  }

  player(name: string): PlayerSession {
    const session = this.sessions.get(name);
    if (!session) throw new Error(`Player ${name} not found in harness`);
    return session;
  }

  get state(): GameState {
    if (!this._state) throw new Error('SkillTestHarness.state: setup() 未调用');
    return this._state;
  }

  get events(): GameEvent[] {
    return getEvents(0);
  }
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
