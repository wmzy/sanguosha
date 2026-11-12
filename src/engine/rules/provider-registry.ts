// src/engine/rules/provider-registry.ts
// state-bound 提供者注册表工厂——查询型提供者模式的公共样板。
//
// slash-quota / distance / hand-limit / slash-target / trick-quota / skill-suppression
// 原先各自手抄「WeakMap<GameState, Registry> + owner 桶 Map + 注册/注销/遍历」同款样板,
// 收敛到本工厂后,各模块只保留类型声明与查询函数。
//
// 模式(与 registerAction / registerBeforeHook 同构):
//   - 技能 onInit 调 register(state, ownerId, provider),返回取消注册函数,
//     并入 onInit 返回的 unload,由 setSkillInstanceUnload 在卸载技能实例时清理。
//   - 注册表外挂在 GameState 上(WeakMap),随 state 自动隔离与 GC,
//     无模块级全局状态泄漏。
//   - 每次注册分配自增 id:同一函数引用重复注册互不冲突、逐次注销互不影响
//     (对齐 trick-quota 的既有语义)。
//   - ownerId = undefined 表示不按 owner 分桶的全局注册
//     (skill-suppression:压制者与被查者不是同一人,查询时遍历所有 provider,
//     见 skill-suppression.ts 文件头注释)。
//
// 查询函数(someOf/forEachOf/someAll)只读 WeakMap、不落桶——纯查询不会为 state 分配注册表。
// 注:与 ./registry.ts(模式名 → 规则包 loader 的规则包注册表)无关,二者仅同名不同物。

import type { GameState } from '../types';

/** ownerId(undefined = 全局桶) → (注册 id → provider) */
interface ProviderBuckets<T> {
  buckets: Map<number | undefined, Map<number, T>>;
}

/** 自增注册 id,全局唯一(跨所有 registry 实例)。 */
let nextRegistrationId = 0;

export interface ProviderRegistry<T> {
  /** 注册 provider 到 owner 桶(ownerId 省略 = 全局桶),返回取消注册函数。 */
  register(state: GameState, ownerId: number | undefined, provider: T): () => void;
  /** 按注册顺序遍历 owner 桶(或全局桶)的 provider;桶不存在时静默跳过。 */
  forEachOf(
    state: GameState,
    ownerId: number | undefined,
    visit: (provider: T) => void,
  ): void;
  /** owner 桶(或全局桶)中是否有 provider 令 predicate 为 true(短路)。 */
  someOf(
    state: GameState,
    ownerId: number | undefined,
    predicate: (provider: T) => boolean,
  ): boolean;
  /** 遍历所有桶(含全局桶):桶按首次注册顺序、桶内按注册顺序。
   *  是否有 provider 令 predicate 为 true(短路)。 */
  someAll(state: GameState, predicate: (provider: T) => boolean): boolean;
}

/** 创建一个 state-bound 提供者注册表。 */
export function createProviderRegistry<T>(): ProviderRegistry<T> {
  const registries = new WeakMap<GameState, ProviderBuckets<T>>();

  const getOrCreate = (state: GameState): ProviderBuckets<T> => {
    let reg = registries.get(state);
    if (!reg) {
      reg = { buckets: new Map() };
      registries.set(state, reg);
    }
    return reg;
  };

  return {
    register(state, ownerId, provider) {
      const id = ++nextRegistrationId;
      const reg = getOrCreate(state);
      let bucket = reg.buckets.get(ownerId);
      if (!bucket) {
        bucket = new Map();
        reg.buckets.set(ownerId, bucket);
      }
      bucket.set(id, provider);
      return () => {
        const b = reg.buckets.get(ownerId);
        if (!b) return;
        b.delete(id);
        if (b.size === 0) reg.buckets.delete(ownerId);
      };
    },
    forEachOf(state, ownerId, visit) {
      const bucket = registries.get(state)?.buckets.get(ownerId);
      if (!bucket) return;
      for (const provider of bucket.values()) visit(provider);
    },
    someOf(state, ownerId, predicate) {
      const bucket = registries.get(state)?.buckets.get(ownerId);
      if (!bucket) return false;
      for (const provider of bucket.values()) {
        if (predicate(provider)) return true;
      }
      return false;
    },
    someAll(state, predicate) {
      const reg = registries.get(state);
      if (!reg) return false;
      for (const bucket of reg.buckets.values()) {
        for (const provider of bucket.values()) {
          if (predicate(provider)) return true;
        }
      }
      return false;
    },
  };
}
