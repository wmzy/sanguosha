// card-effect/delayed-trick-registry.ts — 延时锦囊自注册表。
//
// 延时锦囊的判定阶段/跳过阶段 hook 逻辑原先在 use-card.ts 中硬编码
// (DELAYED_TRICKS 名单 + SKIP_MAP 跳阶段映射)。改为注册机制:
// 各延时锦囊 CardEffect 在注册时自行声明 skipPhase 信息,use-card.ts 统一消费。
//
// 注册时机:card-effects/index.ts eager import 各延时锦囊文件,
// import 副作用触发 registerDelayedTrick,先于 registerDelayedTrickHooks 调用。

/** 延时锦囊注册信息 */
export interface DelayedTrickInfo {
  /** 延时锦囊牌名(如 '乐不思蜀') */
  name: string;
  /** 跳过阶段:判定生效后跳过某个阶段。无此字段 = 不跳过(如闪电)。 */
  skipPhase?: { tag: string; phase: '出牌' | '摸牌' };
}

const delayedTricks = new Map<string, DelayedTrickInfo>();

/** 延时锦囊自注册(在各自 CardEffect 文件中调用)。 */
export function registerDelayedTrick(info: DelayedTrickInfo): void {
  delayedTricks.set(info.name, info);
}

/** 取所有已注册延时锦囊信息。 */
export function getDelayedTricks(): DelayedTrickInfo[] {
  return [...delayedTricks.values()];
}
