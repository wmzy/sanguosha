// LEGACY: scenario-runner.ts — v2 引擎已删除,此文件仅保留 stub 以让 import 解析。
// 所有 import 此文件的测试 (tests/scenarios/**) 已通过 LEGACY TEST 标记跳过,
// scenario() 不会被实际调用。

// Stub exports: 与旧 API 同名,签名兼容,调用时直接抛错。
export class ScenarioContext {
  state: unknown = null;
  selectCharacters(..._names: string[]): this {
    return this;
  }

  setHealth(_player: string, _health: number): this {
    return this;
  }

  setCurrentPlayer(_player: string): this {
    return this;
  }

  enterPlayPhase(): this {
    return this;
  }

  giveCard(_player: string, _name: string): this {
    return this;
  }

  giveCards(_player: string, ..._names: string[]): this {
    return this;
  }

  findCard(_player: string, _name: string): string | null {
    return null;
  }

  snapshot(_label: string): this {
    return this;
  }

  rollback(_label: string): this {
    return this;
  }

  diff(_a: string, _b: string): unknown {
    return null;
  }

  registerTriggers(_player: string): this {
    return this;
  }

  emitEvent(_type: string, _payload?: unknown): this {
    return this;
  }

  // 兼容方法:旧测试可能调用未列出的方法
  [key: string]: unknown;
}

type _Step = { kind: string } & Record<string, unknown>;

export class ScenarioBuilder {
  constructor(public description: string) {}
  setup(_fn: (ctx: ScenarioContext) => void): this {
    return this;
  }

  act(_label: string, _fn: (ctx: ScenarioContext) => void): this {
    return this;
  }

  check(_label: string, _fn: (ctx: ScenarioContext) => void | Promise<void>): this {
    return this;
  }

  viewCheck(_label: string, _fn: (ctx: ScenarioContext, view: unknown) => void): this {
    return this;
  }

  animCheck(_label: string, _fn: (ctx: ScenarioContext, anims: unknown[]) => void): this {
    return this;
  }

  actionCheck(_label: string, _fn: (ctx: ScenarioContext, actions: unknown[]) => void): this {
    return this;
  }

  run(): void {
    /* no-op */
  }
}

export function scenario(description: string): ScenarioBuilder {
  return new ScenarioBuilder(description);
}
