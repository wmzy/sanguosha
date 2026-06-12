// tests/engine-harness.ts
// 技能集成测试 harness:
//   SkillTestHarness  → 引擎生命周期 + 玩家索引
//   PlayerSession     → 玩家操作/查询/断言
//   FakeFrontendAPI   → 收集 defineAction 声明
//
// 设计原则:
//   - 用玩家术语(pass / respond / useCard),不暴露 timer/pending/atom 机制
//   - 断言可观察游戏状态(health / hand / zone),不断言内部 atom 序列
//   - 不 mock 任何引擎组件:复用真实 createEngine / dispatch / apply pipeline
//   - 走 engine.fireTimeout() 触发 onTimeout(语义最准,不需 fake timers)

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
import { createEngine, type EngineInstance } from '../src/engine/create-engine';
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

// ─── FakeFrontendAPI ───────────────────────────────────────────

export class FakeFrontendAPI implements FrontendAPI {
  viewer: string;
  private actions: ActionDef[] = [];
  private currentSkillId = '';

  constructor(viewer: string) {
    this.viewer = viewer;
  }

  setCurrentSkill(skillId: string): void {
    this.currentSkillId = skillId;
  }

  defineAction(
    actionType: string,
    opts: {
      label: string;
      style?: 'primary' | 'danger' | 'default' | 'passive';
      prompt: ActionPrompt;
      transform?: (card: Card) => CardWrapper;
    },
  ): void {
    this.actions.push({
      skillId: this.currentSkillId,
      ownerId: this.viewer,
      actionType,
      label: opts.label,
      prompt: opts.prompt,
      transform: opts.transform,
    });
  }

  onEvent(_handler: (event: GameEvent, view: GameView) => void): () => void {
    return () => {};
  }

  playEffect(_effect: AtomEffect): void {
    /* no-op: harness 不渲染 */
  }

  getActions(): ActionDef[] {
    return this.actions;
  }
}

// ─── PlayerSession ─────────────────────────────────────────────

export class PlayerSession {
  readonly playerName: string;
  readonly frontend: FakeFrontendAPI;
  private lastEventIndex = 0;

  constructor(playerName: string, private harness: SkillTestHarness) {
    this.playerName = playerName;
    this.frontend = new FakeFrontendAPI(playerName);
  }

  // ─── 视图与查询 ───────────────────────────────────────────

  get view(): GameView {
    const idx = this.harness.state.players.findIndex((p) => p.name === this.playerName);
    return this.harness.engine.buildView(idx);
  }

  get newEvents(): GameEvent[] {
    const all = getEvents(this.lastEventIndex);
    this.lastEventIndex = getEventCount();
    return all;
  }

  availableActions(): ActionDef[] {
    return this.frontend.getActions();
  }

  /** 根据前端 defineAction 的 cardFilter 找一张合法牌。跑真实 filter 函数。 */
  findValidCard(actionType: string, extra?: (c: Card) => boolean): Card | null {
    const def = this.availableActions().find((a) => a.actionType === actionType);
    if (!def) return null;
    const filter = extractCardFilter(def.prompt);
    if (!filter) return null;
    const self = this.view.players[this.view.viewer];
    for (const handCard of self.hand ?? []) {
      const card = this.view.cardMap[handCard.id];
      if (!card) continue;
      if (filter(card) && (!extra || extra(card))) return card;
    }
    return null;
  }

  /** 根据前端 defineAction 的 targetFilter 找合法目标。 */
  findValidTargets(actionType: string, count?: number): string[] {
    const def = this.availableActions().find((a) => a.actionType === actionType);
    if (!def) return [];
    const targetFilter = extractTargetFilter(def.prompt);
    if (!targetFilter) return [];
    const result: string[] = [];
    for (const p of this.view.players) {
      if (p.name === this.playerName) continue;
      if (!p.alive) continue;
      if (!targetFilter.filter || targetFilter.filter(this.view, p.name)) {
        result.push(p.name);
        if (count !== undefined && result.length >= count) break;
      }
    }
    return result;
  }

  // ─── 操作 ─────────────────────────────────────────────────

  async useCardAndTarget(
    skillId: string,
    cardId: string,
    targets: string[],
  ): Promise<void> {
    return this.dispatch({ skillId, actionType: 'use', params: { cardId, targets } });
  }

  async useCard(
    skillId: string,
    cardId: string,
    params: Record<string, Json> = {},
  ): Promise<void> {
    return this.dispatch({ skillId, actionType: 'use', params: { cardId, ...params } });
  }

  async respond(
    skillId: string,
    params: Record<string, Json> = {},
  ): Promise<void> {
    return this.dispatch({ skillId, actionType: 'respond', params });
  }

  /** 放弃响应当前等待(不出闪、不发动技能、不确认)。走 onTimeout 路径。 */
  async pass(): Promise<void> {
    await this.harness.engine.fireTimeout();
  }

  async triggerAction(
    skillId: string,
    actionType: string,
    params: Record<string, Json> = {},
  ): Promise<void> {
    return this.dispatch({ skillId, actionType, params });
  }

  // ─── 断言 ─────────────────────────────────────────────────

  /** 断言当前有 pending 等待本玩家。atomType 是玩家术语(如 '询问闪')。 */
  expectPending(atomType: string): void {
    const slot = this.harness.state.pendingSlot;
    if (!slot) throw new Error(`expectPending(${atomType}) 但无 pending`);
    const target = extractPendingTarget(slot.atom);
    expect(slot.atom.type).toBe(atomType);
    expect(target).toBe(this.playerName);
  }

  expectNoPending(): void {
    expect(this.harness.state.pendingSlot).toBeUndefined();
  }

  // ─── 内部 ─────────────────────────────────────────────────

  /** 遍历玩家每个 skill,跑 onMount(若存在)收集 defineAction 声明。 */
  loadFrontend(): void {
    const player = this.harness.state.players.find((p) => p.name === this.playerName)!;
    for (const skillId of player.skills) {
      const mod = getSkillModule(skillId);
      if (!mod.onMount) continue; // 后端 only skill 跳过(合法)
      this.frontend.setCurrentSkill(skillId);
      const skill = mod.createSkill(skillId, this.playerName);
      mod.onMount(skill, this.frontend);
    }
  }

  private async dispatch(
    msg: Omit<ClientMessage, 'ownerId' | 'baseSeq'>,
  ): Promise<void> {
    const result = await this.harness.engine.dispatch({
      ...msg,
      ownerId: this.playerName,
      baseSeq: this.harness.engine.getState().seq,
    });
    if (result.error) throw new Error(`dispatch error: ${result.error}`);
  }
}

// ─── SkillTestHarness ──────────────────────────────────────────

export class SkillTestHarness {
  readonly engine: EngineInstance;
  private sessions = new Map<string, PlayerSession>();

  constructor() {
    this.engine = createEngine();
  }

  /** 初始化:重置引擎 → bootstrap state → 为每个玩家创建 session 并加载 onMount */
  setup(state: GameState): void {
    this.engine.resetForTest();
    this.engine.bootstrap(state);
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
    return this.engine.getState();
  }

  get events(): GameEvent[] {
    return getEvents(0);
  }
}

// ─── 内部 helper(私有) ────────────────────────────────────────

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

/** 从 waiting atom 中提取 target 字段(所有内置等待型 atom 都有 target) */
function extractPendingTarget(atom: Atom): string {
  if ('target' in atom && typeof atom.target === 'string') return atom.target;
  return '';
}
