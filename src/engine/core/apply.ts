// core/apply.ts — atom apply 管线核心。
// before hooks → validate → apply → emit event → after hooks → pending。
// 这是从 index.ts 提取的循环依赖枢纽替代品:消费者直接 import applyAtom 而非通过 index.ts。
import type {
  Atom,
  AtomAfterContext,
  AtomBeforeContext,
  AtomDefinition,
  GameState,
  PendingSlot,
} from '../types';
import { applyAtom as applyAtomImpl, getAtomDef, resolveViewEvents } from './atom';
import { getAfterHooks, getBeforeHooks, getJudgeModifierMap } from './skill';
import { isHookSuppressed } from './skill-suppression';
import { assertCardInvariants } from '../util/invariants';
import { resolveTimeoutMs } from './timeout';
import {
  pushNotify,
  notifyStateChange,
  notifyPendingResolved,
  extractPendingTarget,
} from './notify';
import { topFrame, emptyFrame } from './frame';

// 非锁定技失效扩展点(skill-suppression.ts)提供,引擎核心不感知具体技能/标签。
// 提供者由各技能自行注册(义绝/界铁骑/界完杀 等),predicate 内部读自己的 tag/vars。

/** 多角色结算顺序排序(原则 §2.2b):从当前回合角色起按 ownerId 逆时针排列玩家 hook。
 *  系统级 hook(ownerId<0)非"角色",不受多角色原则约束,统一排在最后——保持既有
 *  "系统级 hook 最后执行"语义(延时锦囊判定在勇略等玩家技能之后、濒死/死亡检查在
 *  受伤害技能之后)。同一玩家的多个 hook 维持注册序(Array.sort 在 V8/Node 下稳定)。
 *
 *  历史:仅 '摸牌' before-hook 与 '伤害结算结束后' after-hook 做了逆时针排序,其余
 *  atom 一律按注册插入序(从 0 号座起)遍历,在 currentPlayerIndex≠0 时违反多角色
 *  结算原则——此处泛化到所有 atom。'伤害结算结束后' 原把系统级 hook(连环传导)排最前,
 *  经核实其传导/重置与玩家"伤害结算结束后"技能(遗计/节命/忘隙)无共享状态、且每次
 *  atom 仅命中单一目标玩家,系统级排前/排后功能等价,故统一为排最后。返回新数组,
 *  不修改注册表中的原数组。 */
function sortHooksCounterclockwise<T extends { ownerId: number }>(hooks: T[], state: GameState): T[] {
  if (hooks.length <= 1) return [...hooks];
  const cur = state.currentPlayerIndex;
  const n = state.players.length;
  return [...hooks].sort((a, b) => {
    const aSys = a.ownerId < 0;
    const bSys = b.ownerId < 0;
    if (aSys && bSys) return 0; // 系统级之间维持注册序
    if (aSys) return 1; // 系统级排最后
    if (bSys) return -1;
    return ((a.ownerId - cur + n) % n) - ((b.ownerId - cur + n) % n);
  });
}

/** 运行 after hooks:按多角色结算顺序(逆时针,系统级排最后)遍历。 */
async function runAfterHooks(state: GameState, atom: Atom): Promise<void> {
  const sortedHooks = sortHooksCounterclockwise(getAfterHooks(state, atom.type), state);
  for (const h of sortedHooks) {
    // 界铁骑:目标本回合非锁定技失效 → 跳过非锁定技 hook
    if (isHookSuppressed(state, h.ownerId, h.skillId)) continue;
    const curFrame = topFrame(state) ?? emptyFrame();
    const afterCtx: AtomAfterContext = {
      state,
      atom,
      ownerId: h.ownerId,
      frame: curFrame,
      params: curFrame.params,
    };
    await h.handler(afterCtx);
  }
}

/** 运行判定改判钩子(鬼才/鬼道):从当前判定角色起,逆时针依次询问每个
 *  存活玩家的改判能力。在 判定牌生效前 atom 的 afterApply 阶段调用。
 *
 *  与普通 after-hook 的区别:遍历顺序不依赖 hook 注册序,而由判定目标座次
 *  逆时针推导,确保「改判方座次靠后于消费方也能生效」——旧实现挂在判定
 *  after-hook 靠注册序混排,改判方须座次靠前才能生效,此处彻底修正。
 */
export async function runJudgeModifiers(state: GameState): Promise<void> {
  // 从 atomStack 栈顶取当前 判定牌生效前 atom(afterApply 在 push 之后、pop 之前调用)
  const atom = state.atomStack[state.atomStack.length - 1];
  if (!atom) return;
  const player = (atom as { player?: number }).player;
  if (typeof player !== 'number') return;
  const modifiers = getJudgeModifierMap(state);
  if (modifiers.size === 0) return;
  const n = state.players.length;
  // 从判定目标起逆时针遍历(含目标自身:目标自带鬼才/鬼道也要问)
  for (let i = 0; i < n; i++) {
    const idx = (player - i + n) % n;
    const entry = modifiers.get(idx);
    if (!entry) continue;
    const p = state.players[idx];
    if (!p?.alive) continue;
    const curFrame = topFrame(state) ?? emptyFrame();
    const afterCtx: AtomAfterContext = {
      state,
      atom,
      ownerId: entry.ownerId,
      frame: curFrame,
      params: curFrame.params,
    };
    await entry.handler(afterCtx);
  }
}

/**
 * 应用一个 atom:走完整 pipeline(before hooks → validate → apply → emit event → after hooks → pending)。
 * 等待型 atom 的 Promise 会挂起直到回应/超时。
 */
export async function applyAtom(state: GameState, atom: Atom): Promise<boolean> {
  state.atomStack.push(atom);

  // before 阶段:折叠(folding)语义。hooks 按多角色结算顺序(逆时针,系统级排最后)依次跑,
  // 每个 hook 可 pass/modify/cancel。modify 叠加(藤甲-1 后白银狮子看到减过的值);
  // cancel 终止(仁王盾/检测有效性 cancel 后后续 hook 不跑,atom 不进入 validate/apply/after)。
  let current = atom;
  let cancelled = false;
  const hooks = sortHooksCounterclockwise(getBeforeHooks(state, atom.type), state);
  for (const h of hooks) {
    // 界铁骑:目标本回合非锁定技失效 → 跳过非锁定技 hook
    if (isHookSuppressed(state, h.ownerId, h.skillId)) continue;
    const frame = topFrame(state) ?? emptyFrame();
    const beforeCtx: AtomBeforeContext = {
      state,
      atom: current,
      ownerId: h.ownerId,
      frame,
      params: frame.params,
    };
    const result = await h.handler(beforeCtx);
    if (result === undefined) continue; // void = pass(向后兼容)
    if (result.kind === 'cancel') {
      cancelled = true;
      break;
    }
    if (result.kind === 'modify') {
      current = result.atom;
    } // 后续 hook + validate + apply 用新值
  }

  if (cancelled) {
    state.atomStack.pop();
    // cancel 非静默:推 notify 事件让前端感知(技能可据此显示"伤害被取消"/"目标无效")
    pushNotify(state, { skillId: '', eventType: 'atomCancelled', data: { atomType: atom.type } });
    notifyStateChange(state);
    return false; // 被 before hook cancel(如仁王盾:目标无效)
  }

  const def = getAtomDef(current.type);
  const error = def.validate(state, current);
  if (error !== null) {
    state.atomStack.pop();
    throw new Error(`applyAtom validate 失败: ${current.type} → ${error}`);
  }

  // toViewEvents 必须在 apply 之前调用——此时 state 尚未变更
  const viewEvents = resolveViewEvents(state, current);

  applyAtomImpl(state, current);

  // seq 在每次 push atomHistory 前递增:一次 dispatch 内可能有多个 applyAtom
  // (如 respond → 分配武将 → 并行选将),它们必须有各自唯一的 seq,
  // 否则 broadcastNewState 的水位过滤会跳过同 seq 的后续事件(选将 bug 根因)。
  state.seq += 1;
  state.atomHistory.push({
    kind: 'atom',
    seq: state.seq,
    timestamp: state.clock.now() - state.startedAt,
    atom: current,
    viewEvents: viewEvents!,
  });

  if (def.pending) {
    // 等待型 atom:创建 PendingSlot(单 target) 或多个 slot(并行选将多 target)。
    // parallelSplit 声明在 atom 定义上,引擎不再硬编码 type 偏序。
    let targets: number[];
    let slotAtoms: Atom[];
    const splits = def.parallelSplit?.(current);
    if (splits && splits.length > 0) {
      // 并行型:拆出多个 slotAtom,各自类型不同(如 请求回应/选将询问),用各自的 def
      targets = splits.map((s) => s.target);
      slotAtoms = splits.map((s) => s.slotAtom);
    } else {
      // 单 target:原样
      targets = [extractPendingTarget(current)];
      slotAtoms = [current];
    }

    // 卡牌回应型 atom 的响应可用性预检(skip/silent/normal)。
    //   skip   —— target 手牌为 0:不创建任何 slot、无延时,Promise.all([]) 立即继续。
    //             父流程(如杀的结算)看到处理区无响应牌 → 正常结算。
    //   silent —— target 有手牌但无匹配牌:创建短延时 slot(silentDelayMs,不走 timeoutSec),
    //             target 不被询问(toViewEvents/applyView 给 target 观察型 pending)。
    //   null   —— 正常询问。
    // 预检在 apply→emit event→after hooks 之后、创建 slot 之前,与 toViewEvents 看到同一份 state。
    const pre = def.pending.preResolve?.(state, current) ?? null;
    const isSkip = pre === 'skip';
    const silentDelayMs =
      !isSkip && pre && typeof pre === 'object' ? pre.delayMs : undefined;

    if (isSkip) {
      // 不创建 slot:仍需广播已 emit 的 event(skip 模式 applyView 不设置 pending)。
      notifyStateChange(state);
    } else {
      const slotPromises: Promise<void>[] = [];
      for (let i = 0; i < slotAtoms.length; i++) {
        const slotAtom = slotAtoms[i];
        const slotTarget = targets[i];
        // 每个 slot 用自己 atom type 对应的 def(并行选将→选将询问)
        const slotDef = slotAtom.type !== current.type ? getAtomDef(slotAtom.type) : def;
        slotPromises.push(
          createAndAwaitSlot(state, slotAtom, slotDef, slotTarget, silentDelayMs),
        );
      }
      await Promise.all(slotPromises);
    }

    // 等待型 atom:技能 after hooks 和 def.afterHooks 都在 pending resolve 之后跑
    // ——这样贯石斧/青龙偃月刀等技能能在看到 P2 出完闪/不出后再做决策。
    if (def.afterApply) await def.afterApply(state, current);
    await runAfterHooks(state, current);

    if (def.afterHooks) {
      def.afterHooks(state, current);
    }

    state.atomStack.pop();
    // 正常完成路径(等待型 atom):受 state.assertInvariants 开关保护,护栏牌重复 bug。
    // cancel/validate 失败路径不检查(状态已回滚)。
    if (state.assertInvariants) assertCardInvariants(state);
    return true;
  }

  // 非等待型 atom:push 后立即广播。必须在 after hooks 之前——after hooks 内
  // 嵌套的 applyAtom 会各自广播并推进 seq,若此处延后到 after hooks 之后才广播,
  // 当前 atom(seq 较小)会被 broadcastNewState 的水位过滤(sinceSeq)吞掉。
  // (等待型 atom 不在此广播——其 notifyStateChange 由 createAndAwaitSlot 在
  // pendingSlots.set 之后触发,确保 buildView.pending 已含候选将等 slot 数据。)
  notifyStateChange(state);
  // afterApply:apply+广播之后、技能 after hooks 之前的「就地改写」阶段。
  // 典型:判定 atom 在此触发改判钩子(鬼才/鬼道),改判完成后消费方 after hook 读到的即为最终牌。
  if (def.afterApply) await def.afterApply(state, current);
  // 非等待型 atom:技能 after hooks 立即跑(原顺序)
  await runAfterHooks(state, current);

  // atom 自身的后处理(在技能 after hooks 之后):如判定牌从处理区移入弃牌堆
  if (def.afterHooks) {
    def.afterHooks(state, current);
  }

  state.atomStack.pop();
  // 正常完成路径(非等待型 atom):受 state.assertInvariants 开关保护,护栏牌重复 bug。
  // cancel/validate 失败路径不检查(状态已回滚)。
  if (state.assertInvariants) assertCardInvariants(state);
  return true;
}

/** 为单个 target 创建 PendingSlot 并 await 到它 resolve。
 *  silentDelayMs:卡牌回应 silent 模式下的固定短延时(不走 timeoutSec 缩放)。
 *  undefined = 正常(走 resolveTimeoutMs)。 */
function createAndAwaitSlot(
  state: GameState,
  atom: Atom,
  def: AtomDefinition,
  target: number,
  silentDelayMs?: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const pending = def.pending!;
    const atomTimeout = (atom as Record<string, unknown>).timeout;
    const timeoutSec = typeof atomTimeout === 'number' ? atomTimeout : pending.timeout;
    // 应用房间配置的 timeoutSec(0=无限)。
    // 广播型 pending(target<0,如无懈可击)在无限时仍使用 base timeout,避免死锁。
    // silent 模式直接用 silentDelayMs(固定短延时,不走房间配置),与其他人看到的短暂停顿一致。
    const isBroadcast = target < 0;
    const timeoutMs =
      silentDelayMs ?? resolveTimeoutMs(state, timeoutSec, isBroadcast);
    let resolveCalled = false;
    let timedOut = false;
    let paused = false;
    const safeResolve = () => {
      if (resolveCalled) return;
      resolveCalled = true;
      cancelTimer();
      resolve();
    };
    const slot: PendingSlot = {
      atom,
      definition: def,
      startTime: state.clock.now() - state.startedAt,
      deadline: state.clock.now() - state.startedAt + timeoutMs,
      resolvedTimeoutMs: timeoutMs,
      createdSeq: state.seq,
      isBlocking: pending.isBlocking !== false,
      resolve: safeResolve,
      get isTimeout() {
        return timedOut;
      },
      get isPaused() {
        return paused;
      },
      pause() {
        if (timedOut) return;
        paused = true;
        cancelTimer();
      },
    };
    const fireTimeoutNow = async (): Promise<void> => {
      if (state.pendingSlots.get(target) !== slot) return;
      if (paused) return;
      timedOut = true;
      cancelTimer();
      try {
        // 超时行为:调用 atom 定义的 onTimeout 编排函数。
        // 内部可自由编排 applyAtom(支持多步操作),每个 applyAtom 走完整 pipeline(hooks 正常触发)。
        // 业务逻辑(弃牌超时/选将超时/出牌超时等)由各自 atom 定义声明,引擎核心只管调度。
        await pending.onTimeout(state, atom);
        notifyStateChange(state);
      } finally {
        // 错误恢复边界(非防御性编程):onTimeout 内部编排若抛错,引擎状态已不可信,
        // 但仍必须清理 pendingSlots + resolve 父 execute 的 Promise,否则 execute
        // 永远 await → 游戏死锁。异常本身会通过 dispatch 的 .catch→onError 上报。
        let deleted = false;
        if (state.pendingSlots.get(target) === slot) {
          state.pendingSlots.delete(target);
          deleted = true;
        }
        if (deleted) notifyPendingResolved(state, slot);
        safeResolve();
      }
    };
    slot._fireTimeoutNow = fireTimeoutNow;
    const cancelTimer = state.clock.schedule(timeoutMs, fireTimeoutNow);

    // 存入 pendingSlots Map(按 target 索引)。不同 target 的 slot 共存,各自独立 resolve。
    state.pendingSlots.set(target, slot);
    notifyStateChange(state);
    // 通知 dispatch:execute 已到达挂起点(slot 创建)。restore 用其替代轮询等待。
    state.onExecuteSettle?.();
    state.onExecuteSettle = null;
  });
}
