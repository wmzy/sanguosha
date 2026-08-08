# 三国杀引擎流程对齐规则文档 · 详细设计方案

> 基于 `../sanguosha-doc/_gitbook/rules/flow/` 18 篇规则文档与 `src/engine/` 实现的对比分析，
> 针对全部 18 项问题给出可落地的详细设计。每项包含：现状、方案（新 atom/编排函数/hook 迁移）、
> 受影响技能清单、回归测试点。

---

## 设计总则

### 核心范式转变

当前引擎的流程型操作（伤害、死亡、濒死、移动等）采用**单 atom + before/after hook** 模式。
这导致多个规则时机被压扁到一个 hook 层级，无法区分"造成伤害时"（来源加伤）与"受到伤害时"（目标减伤）等独立时机。

**升级为「编排函数 + 时机标记 atom」模式**——与 `runUseFlow` 一致：

```
编排函数（非 atom，不可被 hook 拦截，只管流程编排）
  → applyAtom(时机标记A)   // apply 无副作用，纯提供 before/after hook 注册点
  → applyAtom(时机标记B)
  → applyAtom(实质atom)   // 如 扣减体力，有副作用
  → applyAtom(时机标记C)
```

时机标记 atom 的特征：
- `validate` 恒通过（纯事件标记）
- `apply` 无副作用（不修改 state）
- `toViewEvents` 发出纯通知事件（前端可显示时机提示）
- 提供 `before-hook`（可 cancel 跳过后续）和 `after-hook`（触发时机技能）

### 命名约定

时机标记 atom 命名对齐规则文档原文：`伤害结算开始时`、`造成伤害时`、`受到伤害时`、`伤害结算结束时` 等。
与现有 atom（`造成伤害` = 含扣血副作用的实质 atom）区分——后者保留为底层体力变更操作。

### 实施优先级

```
P0（高影响·高收益）: A 伤害拆分 → B 死亡拆分 → C 濒死修正 → E 状态变更
P1（中影响）        : D 多目标时序 → F 移动牌 → G 拼点 → I 判定循环
P2（低影响·小改动） : J 阶段间 → K 杀次数 → L 摸牌顺序 → H/M 判定/体力时机
P3（可维护性）      : N 翻面公共化 → O 打出清理 → P 逆时针顺序
```

---

## 模块 A：伤害流程拆分（问题 ① · 最高优先级）

### 现状

`atoms/造成伤害.ts`：单 atom，`apply` 直接 `target.health -= amount`。
8 个规则时机被压扁为 before-hook（造成伤害时 + 受到伤害时混在一起）+ after-hook（造成伤害后 + 受到伤害后 + 结算结束时混在一起）。
伤害值确定与扣减体力耦合，无法在扣减前插入酒诗②/连环检测。

### 目标流程（对齐 damage.md + decreaselife.md）

```
runDamageFlow(state, source, target, baseAmount, cardId?, damageType?)
│
├─ applyAtom(伤害结算开始时)          // before: 绝情(cancel整个结算)
│                                    // after:  狂风/大雾(修正伤害值或类型)
│
├─ applyAtom(造成伤害时)              // before: 裸衣/古锭刀/暗箭(加伤 modify amount)
│                                    //         酒(全局加伤)
│
├─ applyAtom(受到伤害时)              // before: 天香(转移→cancel+重定向)
│                                    //         藤甲/白银狮子/名士(减伤/防止 modify/cancel)
│
├─ 若被防止(cancel) → 跳到 伤害结算结束时
│
├─ applyAtom(造成伤害后)              // after: 狂骨/破军(来源方技能)
│
├─ applyAtom(受到伤害后)              // after: 奸雄/反馈/遗计/刚烈(目标方技能)
│
├─ runDecreaseLifeFlow(state, target, amount)  // 独立扣减体力子流程(见模块M)
│
├─ applyAtom(伤害结算结束时)          // after: 天香摸牌/连环重置
│
└─ applyAtom(伤害结算结束后)          // after: 酒诗②/连环传导(触发新伤害)
```

### 新增 atom 类型

```typescript
// types/atom.ts Atom 联合类型新增：
| { type: '伤害结算开始时'; source: number; target: number; amount: number; damageType?: DamageType }
| { type: '造成伤害时'; source: number; target: number; amount: number; damageType?: DamageType }
| { type: '受到伤害时'; source: number; target: number; amount: number; damageType?: DamageType }
| { type: '造成伤害后'; source: number; target: number; amount: number; damageType?: DamageType }
| { type: '受到伤害后'; source: number; target: number; amount: number; damageType?: DamageType }
| { type: '伤害结算结束时'; source: number; target: number; amount: number; damageType?: DamageType }
| { type: '伤害结算结束后'; source: number; target: number; amount: number; damageType?: DamageType }
```

全部为事件标记型：`validate` 恒通过，`apply` 无副作用，`toViewEvents` 发通知。

### 编排函数

```typescript
// atoms/造成伤害.ts（重构为编排函数 + 底层扣血 atom）

/** 底层扣血 atom——仅扣减体力值，无 hook 时机（由 runDamageFlow 的上层时机管理） */
export const 扣减体力: AtomDefinition<{ target: number; amount: number }> = {
  type: '扣减体力',
  validate(state, atom) {
    if (atom.amount < 0) return 'amount must be >= 0';
    if (!state.players[atom.target]) return `target not found`;
    if (!state.players[atom.target].alive) return `target is dead`;
    return null;
  },
  apply(state, atom) {
    const target = state.players[atom.target];
    target.health = Math.max(0, target.health - atom.amount);
    // 不在此处触发濒死——由编排函数决定
  },
  // toViewEvents / applyView / toViewLog 同原 造成伤害
};

/** 伤害结算编排函数——对齐 damage.md 8 时机 */
export async function runDamageFlow(
  state: GameState,
  source: number,
  target: number,
  baseAmount: number,
  cardId?: string,
  damageType?: DamageType,
): Promise<void> {
  let amount = baseAmount;

  // 时机1：伤害结算开始时（绝情 cancel / 狂风大雾修正）
  const startResult = await applyAtom(state, {
    type: '伤害结算开始时', source, target, amount, damageType,
  });
  if (!startResult) return; // 被 cancel（绝情）

  // 时机2：造成伤害时（来源方加伤：裸衣/古锭刀/暗箭/酒）
  // before-hook modify amount；amount 经折叠后为最终伤害值
  await applyAtom(state, {
    type: '造成伤害时', source, target, amount, damageType,
  });
  amount = readModifiedAmount(state); // 从 before-hook 的 modify 结果读取

  // 时机3：受到伤害时（目标方减伤/防止：藤甲/白银狮子/天香/名士）
  const sufferResult = await applyAtom(state, {
    type: '受到伤害时', source, target, amount, damageType,
  });
  if (!sufferResult) {
    // 被 cancel（完全防止）→ 跳到伤害结算结束时
    await applyAtom(state, {
      type: '伤害结算结束时', source, target, amount: 0, damageType,
    });
    await applyAtom(state, {
      type: '伤害结算结束后', source, target, amount: 0, damageType,
    });
    return;
  }
  amount = readModifiedAmount(state);

  // 时机4：造成伤害后（来源方：狂骨/破军）
  await applyAtom(state, {
    type: '造成伤害后', source, target, amount, damageType,
  });

  // 时机5：受到伤害后（目标方：奸雄/反馈/遗计/刚烈）
  await applyAtom(state, {
    type: '受到伤害后', source, target, amount, damageType,
  });

  // 时机6：扣减体力（独立子流程，含扣减前/扣减时/扣减后三时机）
  await runDecreaseLifeFlow(state, target, amount, source);

  // 时机7：伤害结算结束时（天香摸牌/连环重置）
  await applyAtom(state, {
    type: '伤害结算结束时', source, target, amount, damageType,
  });

  // 时机8：伤害结算结束后（酒诗②/连环传导——可能触发新伤害）
  await applyAtom(state, {
    type: '伤害结算结束后', source, target, amount, damageType,
  });
}
```

### before-hook modify 的 amount 传递机制

当前 before-hook 的 `modify` 返回新 atom。伤害时机的加伤/减伤需要链式叠加（裸衣+1 后藤甲-1）。
设计：每个时机 atom 的 before-hook modify 时修改 `atom.amount`，编排函数在 applyAtom 返回后从
**atomStack 已弹出的 atom** 读取最终 amount。

具体实现：`applyAtom` 返回前把最终 atom 存入 `state.localVars['__lastModifiedAtom']`，
编排函数读取其 `amount` 字段。或更简洁：让时机 atom 的 `afterApply` 回写 amount 到
`state.localVars['__damageAmount']`。

### hook 迁移清单

| 技能 | 原 hook | 新 hook | 说明 |
|------|---------|---------|------|
| 裸衣 | `造成伤害` before-hook modify | `造成伤害时` before-hook modify | 来源方加伤 |
| 酒 | `造成伤害` before-hook modify | `造成伤害时` before-hook modify | 全局加伤 |
| 古锭刀 | `造成伤害` before-hook modify | `造成伤害时` before-hook modify | 目标手牌=1时加伤 |
| 暗箭 | `造成伤害` before-hook modify | `造成伤害时` before-hook modify | 无防具加伤 |
| 藤甲 | `造成伤害` before-hook modify | `受到伤害时` before-hook modify | 火焰伤害减1 |
| 白银狮子 | `造成伤害` before-hook modify | `受到伤害时` before-hook modify | 限伤1 |
| 天香 | `造成伤害` before-hook cancel | `受到伤害时` before-hook cancel+重定向 | 转移伤害 |
| 寒冰剑 | `造成伤害` before-hook cancel | `受到伤害时` before-hook cancel | 防止伤害改弃牌 |
| 仁王盾 | `造成伤害` before-hook cancel | `受到伤害时` before-hook cancel | 黑杀无效 |
| 狂骨 | `造成伤害` after-hook | `造成伤害后` after-hook | 吸血 |
| 破军 | `造成伤害` after-hook | `造成伤害后` after-hook | 翻面 |
| 奸雄 | `造成伤害` after-hook | `受到伤害后` after-hook | 获得伤害牌 |
| 反馈 | `造成伤害` after-hook | `受到伤害后` after-hook | 获得来源牌 |
| 遗计 | `造成伤害` after-hook | `受到伤害后` after-hook | 分配牌 |
| 刚烈 | `造成伤害` after-hook | `受到伤害后` after-hook | 判定反伤 |
| 连环传导 | `造成伤害` after-hook | `伤害结算结束后` after-hook | 传导伤害 |
| 天香摸牌 | `造成伤害` after-hook | `伤害结算结束时` after-hook | 转移后摸牌 |
| 酒诗② | `造成伤害` after-hook | `伤害结算结束后` after-hook | 翻面回血 |

### 调用方迁移

所有调用 `applyAtom(state, { type: '造成伤害', ... })` 的地方改为 `runDamageFlow(state, ...)`：
- `card-effects/杀.ts` resolveSlash
- `card-effects/万箭齐发.ts` resolveArrowVolley
- `card-effects/南蛮入侵.ts`
- `card-effects/决斗.ts`
- `card-effects/雷击.ts` / `界雷击.ts`
- `skills/刚烈.ts`（反伤）
- `skills/连环.ts`（传导）
- `skills/天香.ts`（转移后的伤害）

### 回归测试点

1. 裸衣+杀 → 伤害=2（加伤在减伤前）
2. 藤甲+火焰杀 → 藤甲+1, 伤害=2（藤甲对火焰加1）
3. 裸衣+杀+藤甲 → 裸衣+1后藤甲-1 → 伤害=1（顺序保证）
4. 天香转移 → 原目标不受伤害，天香目标受伤害，天香摸牌在结算结束时
5. 寒冰剑防止 → 不扣血，跳到结算结束时，不触发反馈/奸雄
6. 连环传导 → A受伤害后，传导到B（在结算结束后），B也走完整 runDamageFlow
7. 反馈/奸雄/遗计 → 在受到伤害后触发（扣血前）
8. 狂骨 → 在造成伤害后触发（扣血前），吸血正确

---

## 模块 B：死亡流程拆分（问题 ②）

### 现状

`atoms/击杀.ts`：单 atom，apply 直接 `alive=false` + 手牌/装备入弃牌堆。
系统规则 after-hook 做奖惩。缺亮身份、死亡时、死亡后独立时机。断肠应在系统处理牌前移除技能，但 apply 已先弃牌。

### 目标流程（对齐 death.md）

```
runDeathFlow(state, player, killer?)
│
├─ applyAtom(亮身份牌前)            // before: 焚心(转移身份)
│
├─ applyAtom(亮身份牌)              // 揭示身份（apply 设 identityHidden=false）
│
├─ applyAtom(死亡时)                // after: 行殇(摸牌)/断肠(移除技能)/挥泪/追忆
│                                  //   断肠在此移除死者技能——在系统处理牌之前
│
├─ applyAtom(系统处理牌)            // apply: 手牌+装备入弃牌堆 + alive=false
│                                  //   （原 击杀.apply 逻辑搬到这里）
│
├─ 奖惩                             // 反贼死→凶手摸3; 忠臣被主公杀→主公弃牌
│
└─ applyAtom(死亡后)                // after: 功獒(摸牌)
```

### 新增 atom 类型

```typescript
| { type: '亮身份牌前'; player: number }
| { type: '亮身份牌'; player: number }
| { type: '死亡时'; player: number; killer?: number }
| { type: '系统处理牌'; player: number }
| { type: '死亡后'; player: number; killer?: number }
```

`亮身份牌` 的 apply 设 `identityHidden = false`（实质操作）。
`系统处理牌` 的 apply 搬原 `击杀.apply` 的弃牌+alive=false 逻辑。
其余为标记型。

### 编排函数

```typescript
// skills/系统规则.ts（runDyingFlow 末尾的 击杀 替换为 runDeathFlow）

export async function runDeathFlow(
  state: GameState,
  player: number,
  killer?: number,
): Promise<void> {
  // 时机1：亮身份牌前（焚心）
  await applyAtom(state, { type: '亮身份牌前', player });

  // 时机2：亮身份牌
  await applyAtom(state, { type: '亮身份牌', player });

  // 时机3：死亡时（行殇/断肠/挥泪/追忆——在系统处理牌之前）
  await applyAtom(state, { type: '死亡时', player, killer });

  // 时机4：系统处理牌（弃手牌+装备、alive=false）
  await applyAtom(state, { type: '系统处理牌', player });

  // 奖惩（系统规则内联，不走 atom——与原逻辑一致）
  applyDeathPenalty(state, player, killer);

  // 时机5：死亡后（功獒）
  await applyAtom(state, { type: '死亡后', player, killer });
}
```

### hook 迁移清单

| 技能 | 原 hook | 新 hook |
|------|---------|---------|
| 焚心 | 无（未实现） | `亮身份牌前` before-hook |
| 行殇 | `击杀` after-hook（如有） | `死亡时` after-hook |
| 断肠 | `击杀` after-hook | `死亡时` after-hook（在系统处理牌前移除技能） |
| 挥泪 | `击杀` after-hook | `死亡时` after-hook |
| 追忆 | `击杀` after-hook | `死亡时` after-hook |
| 功獒 | `击杀` after-hook | `死亡后` after-hook |
| 奖惩 | `击杀` after-hook（系统规则） | runDeathFlow 内联 applyDeathPenalty |

### 兼容性

保留 `击杀` atom 作为 `系统处理牌` 的别名（或直接重命名），减少调用方改动。
`runDyingFlow` 末尾的 `applyAtom(击杀)` 改为 `runDeathFlow`。

### 回归测试点

1. 反贼死亡 → 凶手摸3张（奖惩在系统处理牌后）
2. 断肠 → 死者技能在弃牌前被移除（断肠本身不被移除）
3. 行殇 → 摸死者手牌数（在系统处理牌前读取手牌数）
4. 主公杀忠臣 → 主公弃所有牌
5. 身份揭示 → 死亡后身份对所有玩家可见

---

## 模块 C：濒死流程修正（问题 ③）

### 现状

`系统规则.ts:255` runDyingFlow：
- 起点错：从濒死玩家起，应从当前回合角色起
- 方向错：座次递增（顺时针），应逆时针
- 缺"进入濒死状态时"独立时机（补益/随势①）
- 缺"新濒死时机"重置响应起点

### 目标流程（对齐 neardeath.md）

```
runDyingFlow(state, dyingPlayer)
│
├─ applyAtom(进入濒死状态时)         // 补益/随势①（先于求桃）
│                                   //   补益：濒死者本人技能，可能直接回血化解
│
├─ while (health <= 0 && 有存活玩家未问完)
│   ├─ 从 当前回合角色 / 上一响应者 起，逆时针找下一个存活玩家
│   ├─ 询问该玩家是否出桃/酒救援
│   ├─ 若出桃 → 回复1点体力
│   │   └─ 若仍 <= 0 → 进入"新的处于濒死状态时"→ 重置起点为当前响应者，重新逆时针
│   └─ 若不出/超时 → 继续逆时针下一个
│
└─ 若 health <= 0 → runDeathFlow(state, dyingPlayer, killer)
```

### 修正实现

```typescript
async function runDyingFlow(state: GameState, targetIdx: number): Promise<void> {
  // 时机：进入濒死状态时（补益/随势①）
  await applyAtom(state, { type: '进入濒死状态时', target: targetIdx });

  // 不屈检查（保留现有逻辑）
  if (state.localVars['不屈/存活'] === targetIdx) {
    delete state.localVars['不屈/存活'];
    return;
  }

  const n = state.players.length;
  // 起点：当前回合角色（规则要求），逆时针
  let startIdx = state.currentPlayerIndex;

  // 已问过的玩家集合（防止无限循环）
  let asked = new Set<number>();

  while (state.players[targetIdx].health <= 0) {
    // 找下一个未问过的存活玩家（逆时针）
    let found = false;
    for (let i = 0; i < n; i++) {
      const playerIdx = (startIdx - i + n) % n; // 逆时针
      if (asked.has(playerIdx)) continue;
      if (!state.players[playerIdx].alive) continue;

      asked.add(playerIdx);
      found = true;

      await applyAtom(state, {
        type: '请求回应',
        requestType: '桃/求桃',
        target: playerIdx,
        prompt: { /* ... */ },
        timeout: 15,
      });

      const rescuedByPeach = state.localVars['求桃/已救'] as boolean | undefined;
      if (rescuedByPeach) {
        await applyAtom(state, {
          type: '回复体力', target: targetIdx, amount: 1, source: playerIdx,
        });
        delete state.localVars['求桃/已救'];

        if (state.players[targetIdx].health > 0) {
          // 救活了
          return;
        }
        // 仍 <= 0 → 新的处于濒死状态时
        await applyAtom(state, { type: '新的濒死状态时', target: targetIdx });
        // 重置：从当前响应者重新逆时针
        startIdx = playerIdx;
        asked = new Set<number>();
        asked.add(playerIdx); // 当前响应者本轮已问过
        break; // 重新进入 while 循环
      }
      break; // 继续外层 while 找下一个
    }
    if (!found) break; // 所有存活玩家都问过了
  }

  if (state.players[targetIdx].health <= 0) {
    const killer = state.localVars['死亡/killer'] as number | undefined;
    await runDeathFlow(state, targetIdx, killer);
  }
}
```

### 新增 atom 类型

```typescript
| { type: '进入濒死状态时'; target: number }
| { type: '新的濒死状态时'; target: number }
```

标记型。`陷入濒死` atom 保留（作为濒死流程开始的系统通知）。

### hook 迁移

| 技能 | 原 | 新 |
|------|----|----|
| 补益 | `陷入濒死` after-hook | `进入濒死状态时` after-hook |
| 随势① | `陷入濒死` after-hook | `进入濒死状态时` after-hook |

### 回归测试点

1. P1回合内 P3濒死 → 从 P1 起逆时针：P1→P0→P3（跳过P3自己？不，P3也要问）
2. P3被救但仍濒死 → 从救者重新逆时针
3. 补益 → 进入濒死状态时触发，先于求桃
4. 无人救 → 击杀，killer 正确传递

---

## 模块 D：使用结算前多目标时序（问题 ④）

### 现状

`use-card.ts:181`：声明阶段只有 `指定目标` 跨所有目标。
`成为目标/指定目标后/成为目标后` 被塞进逐目标结算循环，而非声明阶段对所有目标统一逐时机处理。

### 目标流程（对齐 use.md）

```
runUseFlow 声明阶段:
  选择目标时(一次) → 置处理区 → 使用时(一次)
  → 逐目标: 指定目标
  → 逐目标: 成为目标          // ← 声明阶段，跨所有目标
  → 逐目标: 指定目标后        // ← 声明阶段，跨所有目标
  → 逐目标: 成为目标后        // ← 声明阶段，跨所有目标

runUseFlow 结算阶段:
  → 逐目标: 检测有效性 → 生效前 → 询问抵消 → 生效时 → resolve → 使用结算结束时
```

### 修改

```typescript
// use-card.ts runUseFlow 声明阶段重构

// 声明阶段：逐目标 指定目标
for (const target of targets) {
  await applyAtom(state, { type: '指定目标', source, target, cardId });
}

// 声明阶段：逐目标 成为目标（跨所有目标统一处理此时机）
for (let i = 0; i < targets.length; i++) {
  const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
  const target = resolved[i];
  if (!state.players[target]?.alive) continue;
  await applyAtom(state, { type: '成为目标', source, target, cardId });
}

// 声明阶段：逐目标 指定目标后
for (let i = 0; i < targets.length; i++) {
  const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
  const target = resolved[i];
  if (!state.players[target]?.alive) continue;
  await applyAtom(state, { type: '指定目标后', source, target, cardId });
}

// 声明阶段：逐目标 成为目标后
for (let i = 0; i < targets.length; i++) {
  const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
  const target = resolved[i];
  if (!state.players[target]?.alive) continue;
  await applyAtom(state, { type: '成为目标后', source, target, cardId });
}

// ── 使用结算中：逐目标完整结算 ──
for (let i = 0; i < targets.length; i++) {
  const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
  const target = resolved[i];
  if (!state.players[target]?.alive) continue;
  // 延迟类跳过（保留现有逻辑）
  if (effect.delayed) continue;
  await runSettlementPhase(state, effect, source, target, cardId, i, opts?.virtual);
}
```

### 注意事项

- `成为目标` 的 before-hook（空城/帷幕 cancel）在声明阶段执行——cancel 意味着该目标不进入后续结算，
  但不影响其他目标。当前实现已支持此语义（becameTarget=false 时 continue）。
- 流离（改变 resolvedTargets）需在 `成为目标后` 之前生效。当前流离挂在 `成为目标` after-hook，
  迁移后仍在声明阶段的 `成为目标` 时机——但流离改变目标后，新目标也需要走 `指定目标后/成为目标后`。
  **设计决策**：流离改变目标后，对新目标补跑 `指定目标→成为目标→指定目标后→成为目标后`。

### 受影响技能

- 流离（多目标时改变目标）——需验证新目标补跑时机
- 铁骑/烈弓/无双①（指定目标后判定/封闪）——多目标时所有目标的铁骑在声明阶段统一触发
- 激昂（成为目标后摸牌）——多目标时所有目标的激昂在声明阶段统一触发
- 方天画戟（多目标杀）——验证三目标时机统一

### 回归测试点

1. 方天画戟杀3目标 → 铁骑对3目标依次判定（声明阶段），然后逐目标结算
2. 流离改变目标 → 新目标补跑声明时机
3. 空城 cancel 成为目标 → 该目标跳过，其他目标正常结算

---

## 模块 E：状态变更时机（问题 ⑤）

### 现状

翻面靠各技能独立标签，无统一"翻面后"hook 点。横置（`设横置.ts`）无 after-hook。
解围监听 `去标签`（翻回正面），方向反。法恩/闺秀/鹰扬完全缺失。

### 新增 atom 类型

```typescript
| { type: '翻面后'; player: number; faceDown: boolean }    // faceDown=true=翻成背面, false=翻回正面
| { type: '横置后'; player: number; chained: boolean }
| { type: '武将牌明置后'; player: number }
| { type: '武将牌移除后'; player: number }
| { type: '游戏牌亮出后'; player: number; cardId: string }
```

全部标记型。

### 翻面统一化

新增公共 helper（见模块 N）：

```typescript
// engine/face-down.ts
export async function flipFaceDown(state: GameState, player: number, tag: string): Promise<void> {
  // 加标签 + 发翻面后 atom
  await applyAtom(state, { type: '加标签', player, tag: `${tag}/翻面` });
  await applyAtom(state, { type: '翻面后', player, faceDown: true });
}

export async function flipFaceUp(state: GameState, player: number, tag: string): Promise<void> {
  await applyAtom(state, { type: '去标签', player, tag: `${tag}/翻面` });
  await applyAtom(state, { type: '翻面后', player, faceDown: false });
}
```

### 横置后时机

`设横置.ts` 的 `afterApply` 或编排方在 applyAtom(设横置) 后补发 `横置后`：

```typescript
// 方案A：设横置 atom 的 afterApply 发出 横置后 标记
// 方案B：调用方在 applyAtom(设横置) 后手动 applyAtom(横置后)
// 推荐 A——集中管理
export const 设横置: AtomDefinition<...> = {
  // ... existing ...
  afterApply(state, atom) {
    // afterApply 是同步的，不能 await applyAtom——改用编排函数
  },
};
// 实际：设横置 atom 保持纯状态变更，编排方（铁索连环 resolve 等）在 applyAtom 后补发
```

**推荐方案**：新增 `runSetChainFlow` 编排函数：

```typescript
export async function runSetChainFlow(state: GameState, player: number, chained: boolean): Promise<void> {
  await applyAtom(state, { type: '设横置', player, chained });
  await applyAtom(state, { type: '横置后', player, chained });
}
```

### hook 迁移

| 技能 | 原 | 新 |
|------|----|----|
| 解围 | `去标签` after-hook（方向反） | `翻面后` after-hook（faceDown=true 时触发） |
| 法恩 | 无（缺失） | `翻面后` + `横置后` after-hook |
| 闺秀① | 无（缺失） | `武将牌明置后` after-hook |
| 闺秀② | 无（缺失） | `武将牌移除后` after-hook |
| 鹰扬 | 无（缺失） | `游戏牌亮出后` after-hook |

### 回归测试点

1. 据守翻面 → 解围触发（翻成背面时，非翻回正面）
2. 铁索连环横置 → 法恩触发
3. 翻回正面 → 不触发解围（解围只在翻成背面时）

---

## 模块 F：移动牌时机（问题 ⑥）

### 现状

`移动牌.ts`：单 atom 直接搬运，无 before/after 时机。重洗只在摸牌内置。无失去原因字段。

### 新增 atom 类型

```typescript
| { type: '移动到目标区域前'; cardId: string; from: ZoneLoc; to: ZoneLoc; reason?: MoveReason }
| { type: '移动到目标区域后'; cardId: string; from: ZoneLoc; to: ZoneLoc; reason?: MoveReason }
```

`MoveReason` 类型：

```typescript
export type MoveReason =
  | '使用' | '打出' | '弃置' | '获得' | '给予' | '拼点' | '交换' | '判定' | '系统处理';
```

### 编排函数

```typescript
export async function runMoveCardFlow(
  state: GameState,
  cardId: string,
  from: ZoneLoc,
  to: ZoneLoc,
  reason?: MoveReason,
): Promise<void> {
  // 时机1：移动到目标区域前（纵玄/章武② 可改变目标区域）
  await applyAtom(state, {
    type: '移动到目标区域前', cardId, from, to, reason,
  });
  // before-hook 可 modify to.zone（如纵玄改为武将牌上）

  // 实质移动
  await applyAtom(state, { type: '移动牌', cardId, from, to });

  // 时机2：移动到目标区域后（连营/伤逝/落英/屯田）
  await applyAtom(state, {
    type: '移动到目标区域后', cardId, from, to, reason,
  });

  // 牌堆耗尽自动重洗（移动后通用规则）
  if (to.zone === '牌堆' || from.zone === '牌堆') {
    await checkAndReshuffleIfNeeded(state);
  }
}

/** 牌堆空但弃牌堆有牌时，弃牌堆随机置入牌堆 */
async function checkAndReshuffleIfNeeded(state: GameState): Promise<void> {
  if (state.zones.deck.length === 0 && state.zones.discardPile.length > 0) {
    await applyAtom(state, { type: '重洗' });
  }
}
```

### 迁移策略

`移动牌` atom 保留为底层操作（apply 直接搬运，无 hook 时机）。
所有 `applyAtom(state, { type: '移动牌', ... })` 改为 `runMoveCardFlow(state, ...)`。

考虑到调用点极多（use-card/play-card/各 card-effect/各 skill），采用**分批迁移**：
1. 先新增 `runMoveCardFlow` + 时机 atom
2. 弃置/获得/给予 等有"失去原因"语义的路径优先迁移
3. use-card/play-card 的"手牌→处理区"等内部移动最后迁移（这些移动的 before/after 时机技能较少）

### hook 迁移

| 技能 | 原 | 新 |
|------|----|----|
| 纵玄 | 无（缺失） | `移动到目标区域前` before-hook modify to.zone |
| 章武② | 无（缺失） | `移动到目标区域前` before-hook modify to.zone |
| 连营 | `弃置`/`移动牌` after-hook | `移动到目标区域后` after-hook（reason='弃置' && to='弃牌堆'） |
| 伤逝 | `弃置` after-hook | `移动到目标区域后` after-hook（reason='弃置' && hand==0） |
| 落英 | `弃置` after-hook | `移动到目标区域后` after-hook（reason='弃置' && 花色匹配） |
| 屯田 | `弃置` after-hook | `移动到目标区域后` after-hook（reason='弃置'） |

### 回归测试点

1. 牌堆耗尽（非摸牌路径，如五谷丰登）→ 自动重洗
2. 连营 → 手牌为0时弃置触发摸牌
3. 落英 → 同花色弃置触发获得

---

## 模块 G：拼点两步化（问题 ⑦）

### 现状

`拼点.ts`：调用方（驱虎/界惴恐）先后移动两张牌到处理区，移动牌 ViewEvent 进处理区时已公开牌面。死亡中拼点未处理。

### 目标流程（对齐 rankcompare.md）

```
runRankCompareFlow(state, initiator, target)
│
├─ applyAtom(拼点扣置)           // 双方同时将一张手牌扣置入处理区（面朝下）
│                               //   apply: 移两张牌到处理区，ViewEvent 不公开牌面
│
├─ applyAtom(拼点亮出)           // 同时亮出（面朝上）
│                               //   apply: 公开牌面，确定结果（赢/没赢）
│
└─ applyAtom(拼点后)             // after: 根据结果触发技能效果
```

### 新增 atom 类型

```typescript
| { type: '拼点扣置'; initiator: number; target: number; initiatorCard: string; targetCard: string }
| { type: '拼点亮出'; initiator: number; target: number; initiatorCard: string; targetCard: string }
| { type: '拼点后'; initiator: number; target: number; result: '赢' | '没赢' }
```

### 编排函数

```typescript
export async function runRankCompareFlow(
  state: GameState,
  initiator: number,
  target: number,
  initiatorCard: string,
  targetCard: string,
): Promise<'赢' | '没赢'> {
  // 时机1：同时扣置（面朝下移入处理区）
  await applyAtom(state, {
    type: '拼点扣置', initiator, target, initiatorCard, targetCard,
  });

  // 时机2：同时亮出（公开牌面，确定结果）
  await applyAtom(state, {
    type: '拼点亮出', initiator, target, initiatorCard, targetCard,
  });

  // 确定结果
  const initVal = getCardValue(state.cardMap[initiatorCard]);
  const targetVal = getCardValue(state.cardMap[targetCard]);
  const result: '赢' | '没赢' = initVal > targetVal ? '赢' : '没赢'; // 相同=没赢

  // 时机3：拼点后
  await applyAtom(state, {
    type: '拼点后', initiator, target, result,
  });

  // 牌入弃牌堆
  await applyAtom(state, { type: '移动牌', cardId: initiatorCard, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
  await applyAtom(state, { type: '移动牌', cardId: targetCard, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });

  return result;
}
```

### 死亡中拼点处理

```typescript
// 若一方在扣置后、亮出前死亡，系统仍亮出其牌确定结果
// runRankCompareFlow 的扣置与亮出之间不插入任何询问，无死亡窗口
// 但若调用方在选牌阶段死亡（驱虎目标被杀），调用方应自行检查存活
```

### ViewEvent 面朝下

`拼点扣置` 的 `toViewEvents` 对非扣置者隐藏牌面（只通知"扣置了一张牌"）。
`拼点亮出` 的 `toViewEvents` 公开牌面。

### 受影响技能

- 驱虎（`skills/驱虎.ts`）→ 改用 runRankCompareFlow
- 界惴恐（`skills/界惴恐.ts`）→ 改用 runRankCompareFlow
- 制霸/天义等拼点技 → 同上

### 回归测试点

1. 拼点扣置 → 非扣置者看不到牌面
2. 拼点亮出 → 所有人看到牌面
3. 点数相同 → 双方都没赢
4. 结果正确传递给调用方

---

## 模块 H：判定时机补全（问题 ⑧）

### 现状

`判定.ts`：apply 翻牌 → afterApply 改判 → afterHooks 消费+移弃牌堆。
缺"判定时"独立 hook（咒缚）。"生效后获得判定牌"与"消费方读牌"混在 afterHooks。

### 新增 atom 类型

```typescript
| { type: '判定时'; player: number; judgeType: string }
| { type: '判定牌生效前'; player: number; judgeType: string; cardId: string }
| { type: '判定牌生效后'; player: number; judgeType: string; cardId: string }
```

### 编排函数

```typescript
export async function runJudgeFlow(
  state: GameState,
  player: number,
  judgeType: string,
): Promise<string> {
  // 时机1：判定时（咒缚可替换判定牌来源）
  await applyAtom(state, { type: '判定时', player, judgeType });

  // 翻判定牌（底层操作）
  const cardId = drawTopCardAsJudge(state, player);
  await applyAtom(state, { type: '判定', player, judgeType });

  // 时机2：判定牌生效前（鬼才/鬼道 改判）
  await applyAtom(state, { type: '判定牌生效前', player, judgeType, cardId });
  // runJudgeModifiers 在此 atom 的 afterApply 中调用

  // 时机3：判定牌生效后（天妒/洛神 获得判定牌 / 屯田 置武将牌上 / 闪电/乐不思蜀 读牌执行）
  await applyAtom(state, { type: '判定牌生效后', player, judgeType, cardId });

  // 若未被天妒获得，移入弃牌堆
  if (!isCardTaken(state, cardId)) {
    await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
  }

  return cardId;
}
```

### hook 迁移

| 技能 | 原 | 新 |
|------|----|----|
| 咒缚 | 无（缺失） | `判定时` before-hook modify |
| 鬼才 | runJudgeModifiers | `判定牌生效前` before-hook modify（改判牌） |
| 鬼道 | runJudgeModifiers | `判定牌生效前` before-hook modify（改判牌） |
| 天妒 | `判定` after-hook | `判定牌生效后` after-hook（标记牌已获得，阻止入弃牌堆） |
| 洛神 | `判定` after-hook | `判定牌生效后` after-hook |
| 屯田 | `判定` after-hook | `判定牌生效后` after-hook |

### 回归测试点

1. 鬼才改判 → 新牌生效
2. 天妒获得 → 判定牌不入弃牌堆
3. 咒缚替换 → 替换后的牌作为判定牌

---

## 模块 I：判定阶段多锦囊循环（问题 ⑨）

### 现状

`use-card.ts:283`：`find()` 只取第一个延时锦囊，无循环。多锦囊只结算一个。

### 修改

```typescript
// use-card.ts registerDelayedTrickHooks 判定阶段 before-hook 重构

registerBeforeHook(state, '延时锦囊', -1, '阶段开始', async (ctx) => {
  const atom = ctx.atom;
  if (atom.type !== '阶段开始' || atom.phase !== '判定') return;
  const player = atom.player;
  const self = ctx.state.players[player];
  if (!self) return;

  const DELAYED_TRICKS = ['乐不思蜀', '兵粮寸断', '闪电'];

  // 循环：直到判定区无延时锦囊
  while (true) {
    // 取最后置入的延时锦囊（规则：结算最后置入的）
    const trick = [...self.pendingTricks]
      .reverse()
      .find((t) => DELAYED_TRICKS.includes(t.name));
    if (!trick) break;

    // 询问无懈 → resumeDelayedSettlement
    const cancelled = await 询问无懈可击(ctx.state, player);
    if (cancelled) {
      await applyAtom(ctx.state, {
        type: '移除延时锦囊', player, trickName: trick.name,
      });
      continue; // 继续循环处理下一个
    }
    await resumeDelayedSettlement(
      ctx.state, trick.source, player, trick.name, trick.card.id,
    );
    // resumeDelayedSettlement 内部会移除结算完的延时锦囊
  }
});
```

### 回归测试点

1. 判定区有乐不思蜀+闪电 → 先结算最后置入的，再结算另一个
2. 闪电被无懈 → 移除后继续结算乐不思蜀
3. 无延时锦囊 → 正常跳过判定阶段

---

## 模块 J：阶段间时机（问题 ⑩）

### 现状

`回合管理.ts`：阶段结束 after-hook 直接 apply `阶段开始(next)`，无独立"阶段间"atom。
裸衣挂在 `摸牌` before-hook 而非"判定与摸牌阶段间"。

### 新增 atom 类型

```typescript
| { type: '阶段间'; player: number; from: string; to: string }
```

标记型。`from`/`to` 为相邻阶段名。

### 修改

```typescript
// 回合管理.ts 阶段推进重构

async function nextPhase(state: GameState, player: number): Promise<void> {
  const currentPhase = state.turn.phase;
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);
  const nextIdx = currentIdx + 1;
  const nextPhaseName = PHASE_ORDER[nextIdx];

  // 阶段结束
  await applyAtom(state, { type: '阶段结束', player, phase: currentPhase });

  if (nextIdx < PHASE_ORDER.length) {
    // 阶段间时机（神速①/裸衣/放权/克己 等）
    await applyAtom(state, {
      type: '阶段间', player, from: currentPhase, to: nextPhaseName,
    });

    // 下一阶段开始
    await applyAtom(state, { type: '阶段开始', player, phase: nextPhaseName });
  } else {
    // 回合结束
    await applyAtom(state, { type: '回合结束', player });
    // → 下一玩家
  }
}
```

### hook 迁移

| 技能 | 原 | 新 |
|------|----|----|
| 裸衣 | `摸牌` before-hook | `阶段间` after-hook（from='判定' && to='摸牌'） |
| 神速① | skipPhase 机制 | `阶段间` after-hook（from='准备' && to='判定'，选择跳过判定） |
| 神速② | skipPhase 机制 | `阶段间` after-hook（from='摸牌' && to='出牌'） |
| 放权 | skipPhase 机制 | `阶段间` after-hook（from='摸牌' && to='出牌'） |
| 克己 | skipPhase 机制 | `阶段间` after-hook（from='出牌' && to='弃牌'） |
| 巧变 | skipPhase 机制 | `阶段间` after-hook（各阶段间，弃牌跳过） |

### 兼容性

裸衣的 `摸牌` before-hook 逻辑迁移到 `阶段间` after-hook 后，
询问时机从"摸牌阶段开始时"变为"判定与摸牌阶段间"——语义更准确。
skipPhase 机制保留（阶段间 after-hook 可调用 skipPhase 跳过下一阶段）。

### 回归测试点

1. 裸衣 → 在判定与摸牌阶段间询问，少摸一张+加伤
2. 神速① → 准备与判定间选择跳过判定
3. 克己 → 出牌与弃牌间选择跳过弃牌

---

## 模块 K：杀次数额定/额外双层计数（问题 ⑱）

### 现状

`slash-quota.ts`：单一 `slashMax = 基础1 + Σ提供者` + `slashUsed` 计数。
未区分额定 vs 额外。

### 设计

```typescript
// slash-quota.ts 重构

/** 额定次数提供者：返回该来源贡献的额定次数（默认基础1） */
export type SlashQuotaProvider = (state: GameState, player: number) => number;

/** 额外次数提供者：返回该来源贡献的额外次数（天义拼点赢 +1） */
export type SlashExtraProvider = (state: GameState, player: number) => number;

/** 无限出杀提供者（连弩） */
export type SlashUnlimitedProvider = (state: GameState, player: number) => boolean;

// state-bound 注册表
interface SlashRegistry {
  quotaProviders: Map<number, SlashQuotaProvider>;     // 额定（默认基础1）
  extraProviders: Map<number, SlashExtraProvider>;     // 额外
  unlimitedProviders: Map<number, SlashUnlimitedProvider>; // 无限
  blockers: Map<number, SlashBlocker>;
  exemptors: Map<number, SlashExemptor>;
}

/** 额定上限 = max(各提供者) —— 覆盖型（如某技能设额定=2） */
export function slashQuotaMax(state: GameState, player: number): number {
  const reg = getSlashRegistry(state);
  let max = 1; // 基础1
  for (const provider of reg.quotaProviders.values()) {
    max = Math.max(max, provider(state, player));
  }
  return max;
}

/** 额外上限 = Σ(各提供者) —— 叠加型 */
export function slashExtraMax(state: GameState, player: number): number {
  const reg = getSlashRegistry(state);
  let sum = 0;
  for (const provider of reg.extraProviders.values()) {
    sum += provider(state, player);
  }
  return sum;
}

/** 是否无限出杀 */
export function isSlashUnlimited(state: GameState, player: number): boolean {
  const reg = getSlashRegistry(state);
  for (const provider of reg.unlimitedProviders.values()) {
    if (provider(state, player)) return true;
  }
  return false;
}

/** 总上限 = 无限 ? Infinity : 额定 + 额外 */
export function slashMax(state: GameState, player: number): number {
  if (isSlashUnlimited(state, player)) return Infinity;
  return slashQuotaMax(state, player) + slashExtraMax(state, player);
}

/** 已用额定次数 */
export function slashQuotaUsed(state: GameState): number {
  return state.turn.vars['杀/quotaUsed'] as number ?? 0;
}

/** 已用额外次数 */
export function slashExtraUsed(state: GameState): number {
  return state.turn.vars['杀/extraUsed'] as number ?? 0;
}

/** 总已用 */
export function slashUsed(state: GameState): number {
  return slashQuotaUsed(state) + slashExtraUsed(state);
}

/** 记录一次出杀——优先消耗额定，再消耗额外 */
export function incSlashUsed(state: GameState): void {
  const quotaRemaining = slashQuotaMax(state, state.currentPlayerIndex) - slashQuotaUsed(state);
  if (quotaRemaining > 0) {
    state.turn.vars['杀/quotaUsed'] = slashQuotaUsed(state) + 1;
  } else {
    state.turn.vars['杀/extraUsed'] = slashExtraUsed(state) + 1;
  }
}

/** 是否还能出杀 */
export function canSlash(state: GameState, player: number, cardId?: string): boolean {
  if (isSlashBlocked(state, player)) return false;
  if (isSlashExempted(state, player, cardId)) return true;
  if (isSlashUnlimited(state, player)) return true;
  return slashUsed(state) < slashMax(state, player);
}
```

### 受影响技能迁移

| 技能 | 原 | 新 |
|------|----|----|
| 诸葛连弩 | SlashMaxProvider 返回 Infinity | SlashUnlimitedProvider 返回 true |
| 天义 | （无直接交互） | SlashExtraProvider 返回 +1（拼点赢时注册） |
| 将驰 | （如有限制） | SlashQuotaProvider 返回 2（覆盖额定） |

### 回归测试点

1. 连弩 → 无限出杀
2. 天义赢 → 额外+1，基础1用完后用额外
3. 天义赢+连弩 → 连弩无限覆盖
4. 将驰 → 额定变2

---

## 模块 L：摸牌数修正顺序（问题 ⑪）

### 现状

英姿/好施/裸衣都挂 `摸牌` before-hook modify count，执行顺序由 hook 注册序决定。

### 设计

规则允许"任意顺序叠加"——但实现中 before-hook 的 modify 是折叠式的（按注册序依次叠加），
对纯加减法（英姿+1, 裸衣-1）结果不受顺序影响。好施的"手牌>5分牌"条件依赖修正后手牌数，
但好施在摸牌**后**才判断手牌数，不依赖修正顺序。

**结论**：当前实现的修正顺序问题在**绝大多数情况下不影响结果**（加减法交换律）。
真正需要玩家选择顺序的场景极少（如同时有"多摸后弃"和"少摸后增伤"的复合修正）。

**方案（轻量）**：在 `摸牌` atom 的 before-hook 链中，对多个 modify 按座次逆序排列
（而非注册序），使座次靠后的玩家技能先生效。这近似规则的"当前回合角色起逆时针"。

```typescript
// create-engine.ts applyAtom before-hook 排序增强
// 对 '摸牌' atom 的 before-hook，按 ownerId 逆时针排列（当前回合角色起）
function sortBeforeHooks(state: GameState, hooks: BeforeHook[], atomType: string): BeforeHook[] {
  if (atomType !== '摸牌') return hooks; // 仅摸牌特殊处理
  const cur = state.currentPlayerIndex;
  const n = state.players.length;
  return [...hooks].sort((a, b) => {
    const distA = (a.ownerId - cur + n) % n;
    const distB = (b.ownerId - cur + n) % n;
    return distA - distB;
  });
}
```

### 回归测试点

1. 英姿+裸衣 → 摸2张（+1-1=0修正，基础2+0=2）
2. 好施+英姿 → 摸4张，手牌>5时分牌

---

## 模块 M：回复/失去体力独立时机（问题 ⑫⑬）

### 现状

`回复体力.ts`/`失去体力.ts`：单 atom + after-hook 近似。
救援（回复前修正数值）无独立"确定数值"hook。扣减体力（decreaselife.md）的三时机未独立建模。

### 新增 atom 类型

```typescript
// 回复体力
| { type: '确定回复数值时'; target: number; amount: number; source?: number }
| { type: '回复体力后'; target: number; amount: number; source?: number }

// 失去体力
| { type: '失去体力时'; target: number; amount: number }
| { type: '失去体力后'; target: number; amount: number }

// 扣减体力（decreaselife.md，被 runDamageFlow 和 runLoseLifeFlow 共用）
| { type: '扣减体力前'; target: number; amount: number }
| { type: '扣减体力时'; target: number; amount: number }
| { type: '扣减体力后'; target: number; amount: number }
```

### 编排函数

```typescript
// 回复体力
export async function runRecoverLifeFlow(
  state: GameState, target: number, amount: number, source?: number,
): Promise<void> {
  // 时机1：确定回复数值（救援可修正）
  await applyAtom(state, { type: '确定回复数值时', target, amount, source });
  amount = readModifiedAmount(state);

  // 实质回复
  await applyAtom(state, { type: '回复体力', target, amount, source });

  // 时机2：回复体力后（伤逝/淑慎/恩怨①）
  await applyAtom(state, { type: '回复体力后', target, amount, source });
}

// 失去体力
export async function runLoseLifeFlow(
  state: GameState, target: number, amount: number,
): Promise<void> {
  // 时机1：失去体力时（黄巾天兵符②）
  await applyAtom(state, { type: '失去体力时', target, amount });

  // 扣减体力子流程
  await runDecreaseLifeFlow(state, target, amount);

  // 时机2：失去体力后（诈降）
  await applyAtom(state, { type: '失去体力后', target, amount });
}

// 扣减体力（共用底层流程）
export async function runDecreaseLifeFlow(
  state: GameState, target: number, amount: number, source?: number,
): Promise<void> {
  // 时机1：扣减体力前（酒诗②/连环条件检测/重置）
  await applyAtom(state, { type: '扣减体力前', target, amount });

  // 时机2：扣减体力时（不屈）
  await applyAtom(state, { type: '扣减体力时', target, amount });

  // 实质扣减
  await applyAtom(state, { type: '扣减体力', target, amount });

  // 时机3：扣减体力后（伤逝）
  await applyAtom(state, { type: '扣减体力后', target, amount });

  // 濒死检查（health <= 0 → runDyingFlow）
  if (state.players[target].health <= 0 && state.players[target].alive) {
    if (source !== undefined) state.localVars['死亡/killer'] = source;
    await runDyingFlow(state, target);
  }
}
```

### 体力上限（问题 ⑬）

`设上限.ts` 拆分为编排函数：

```typescript
export async function runSetMaxHealthFlow(
  state: GameState, target: number, newMax: number,
): Promise<void> {
  const oldMax = state.players[target].maxHealth;
  await applyAtom(state, { type: '设上限', player: target, amount: newMax });

  if (newMax < oldMax) {
    // 减上限：若体力=上限则同步降体力
    if (state.players[target].health > newMax) {
      await runDecreaseLifeFlow(state, target, state.players[target].health - newMax);
    }
    // 减上限后（伤逝/威重）
    await applyAtom(state, { type: '减上限后', player: target });
  } else if (newMax > oldMax) {
    // 加上限后（无特定技能，但预留时机）
    await applyAtom(state, { type: '加上限后', player: target });
  }

  // 上限为0则死亡
  if (newMax <= 0) {
    await runDeathFlow(state, target);
  }
}
```

### hook 迁移

| 技能 | 原 | 新 |
|------|----|----|
| 救援 | `回复体力` before-hook | `确定回复数值时` before-hook modify |
| 伤逝 | `弃置`/`造成伤害` after-hook | `扣减体力后` + `回复体力后` after-hook |
| 淑慎 | `回复体力` after-hook | `回复体力后` after-hook |
| 诈降 | `失去体力` after-hook | `失去体力后` after-hook |
| 不屈 | `陷入濒死` after-hook | `扣减体力时` after-hook |
| 酒诗② | `造成伤害` after-hook | `扣减体力前` after-hook |

### 回归测试点

1. 救援 → 回复前修正数值
2. 伤逝 → 扣减后/回复后均触发
3. 失去体力 → 不触发反馈/奸雄（独立流程）
4. 减上限=0 → 死亡
5. 减上限同步降体力 → 触发濒死

---

## 模块 N：翻面/额外回合公共化（问题 ⑭⑮）

### 翻面公共化

```typescript
// engine/face-down.ts（新文件）

/** 翻面（翻成背面朝上） */
export async function flipFaceDown(
  state: GameState, player: number, source: string,
): Promise<void> {
  await applyAtom(state, { type: '加标签', player, tag: `${source}/翻面` });
  await applyAtom(state, { type: '翻面后', player, faceDown: true });
}

/** 翻回正面 */
export async function flipFaceUp(
  state: GameState, player: number, source: string,
): Promise<void> {
  await applyAtom(state, { type: '去标签', player, tag: `${source}/翻面` });
  await applyAtom(state, { type: '翻面后', player, faceDown: false });
}

/** 检查是否处于翻面状态 */
export function isFaceDown(state: GameState, player: number): boolean {
  return state.players[player].tags.some((t) => t.endsWith('/翻面'));
}

/** 跳过整回合（翻面的系统效果）——统一逻辑 */
export async function performSkipTurn(
  state: GameState, player: number,
): Promise<void> {
  // 清过期标记
  await applyAtom(state, { type: '清过期标记', player });
  // 推进到下一玩家
  await applyAtom(state, { type: '下一玩家' });
  // 回合结束
  await applyAtom(state, { type: '回合结束', player });
}
```

### 额外回合公共化

```typescript
// engine/turn-flow.ts（新文件，或放 create-engine.ts）

/** 启动一个新回合（额外回合入口） */
export async function startTurn(
  state: GameState, player: number,
): Promise<void> {
  // 清除上一回合的 per-turn 状态
  clearPerTurnState(state);

  // 回合开始
  await applyAtom(state, { type: '回合开始', player });

  // 准备阶段开始
  await applyAtom(state, { type: '阶段开始', player, phase: '准备' });

  // 触发准备阶段结束 → 回合管理接管后续阶段推进
  await applyAtom(state, { type: '阶段结束', player, phase: '准备' });
  // 回合管理的 阶段结束 after-hook 会自动推进到判定→摸牌→出牌→弃牌→回合结束
}
```

### 受影响技能迁移

| 技能 | 原实现 | 新实现 |
|------|--------|--------|
| 放逐 | 内联翻面+skipAll+手动end-turn | flipFaceDown + 阶段开始before-hook消费→performSkipTurn |
| 悲歌 | 内联翻面+skipAll+手动end-turn | 同上 |
| 界仁心 | 内联翻面+skipAll+手动end-turn | 同上 |
| 界伏枥 | 内联翻面+skipAll+手动end-turn | 同上 |
| 据守 | 内联翻面 | flipFaceDown |
| 放权 | 内联cancel回合结束+clearPerTurnState+startTurn | cancel回合结束 + startTurn（公共） |
| 界凿险 | 内联startTurn | startTurn（公共） |
| 博图 | 内联startTurn | startTurn（公共） |

### 回归测试点

1. 放逐翻面 → 下一回合跳过，翻回正面
2. 放权额外回合 → 正常走完整回合流程
3. 翻面后翻回 → 不跳过

---

## 模块 O：打出牌清理收口（问题 ⑯ 剩余部分）

### 现状

`runPlayFlow` 置处理区后不负责移入弃牌堆。闪/无懈走 runUseFlow 已自洽。
杀对南蛮/决斗的 respond 走 runPlayFlow 或默认 resolver，仍靠调用方清理。

### 方案

```typescript
// play-card.ts runPlayFlow 增加清理

export async function runPlayFlow(
  state: GameState, player: number, cardId: string,
): Promise<void> {
  await applyAtom(state, { type: '声明打出时', player, cardId });
  await applyAtom(state, {
    type: '移动牌', cardId,
    from: { zone: '手牌', player },
    to: { zone: '处理区' },
  });
  await applyAtom(state, { type: '打出牌时', player, cardId });

  // 新增：打出牌的清理——调用方不再需要手动移入弃牌堆
  // 注意：需确认调用方（询问闪/询问杀 resolver）是否依赖牌留在处理区
  // 若调用方在 resolve 后检查处理区，则清理须在调用方完成后
  // 设计：runPlayFlow 不自动清理，改由 询问闪/询问杀 的 resolver 统一清理
}
```

**实际方案**：不在 runPlayFlow 内清理（打出牌的清理时机取决于调用方逻辑），
而是把清理统一到 `询问闪`/`询问杀` 的 resolver 中：

```typescript
// 询问闪/询问杀 resolver 统一清理
async function resolvePlayResponse(state: GameState, player: number, cardId: string): Promise<void> {
  await runPlayFlow(state, player, cardId);
  // 统一清理：处理区→弃牌堆
  if (frameCards(state).includes(cardId)) {
    await applyAtom(state, {
      type: '移动牌', cardId,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });
  }
}
```

### 回归测试点

1. 南蛮入侵 → 杀响应后牌入弃牌堆
2. 万箭齐发 → 闪走 runUseFlow，牌入弃牌堆
3. 决斗 → 杀响应后牌入弃牌堆

---

## 模块 P：逆时针触发顺序（问题 ⑰）

### 现状

applyAtom before/after-hook 按注册序+座次序执行。多处规则要求"当前回合角色起逆时针"。

### 方案

为需要逆时针顺序的 atom 类型，在 `runAfterHooks` 中按 ownerId 逆时针排列：

```typescript
// create-engine.ts runAfterHooks 增强

const CLOCKWISE_REQUIRED_TYPES = new Set([
  '伤害结算结束后',  // 连环传导
  // 无懈可击的广播询问已在 询问抵消 内部处理顺序
]);

function sortAfterHooks(state: GameState, hooks: AfterHook[], atomType: string): AfterHook[] {
  if (!CLOCKWISE_REQUIRED_TYPES.has(atomType)) return hooks;
  const cur = state.currentPlayerIndex;
  const n = state.players.length;
  return [...hooks].sort((a, b) => {
    const distA = (a.ownerId - cur + n) % n;
    const distB = (b.ownerId - cur + n) % n;
    return distA - distB;
  });
}
```

### 范围

- 连环传导（`伤害结算结束后` after-hook）→ 逆时针
- 无懈可击广播 → 已在 `询问抵消` 内部处理
- 濒死求桃 → 已在 `runDyingFlow` 内部处理（模块 C 修正为逆时针）

### 回归测试点

1. 连环传导 → A受伤害后传导，多目标时按逆时针顺序触发

---

## 实施路线图

### 阶段一：P0 核心流程（伤害+死亡+濒死+状态变更）

1. **模块 A（伤害拆分）** —— 影响最大，先做
   - 新增 7 个时机 atom + runDamageFlow
   - 迁移 ~18 个技能 hook
   - 迁移 ~8 个调用方
   - 全量回归测试

2. **模块 M（扣减体力子流程）** —— A 的依赖
   - 新增扣减体力三时机 + runDecreaseLifeFlow
   - runDamageFlow 调用 runDecreaseLifeFlow

3. **模块 B（死亡拆分）** —— A 的下游
   - 新增 5 个时机 atom + runDeathFlow
   - runDyingFlow 末尾改调 runDeathFlow

4. **模块 C（濒死修正）** —— B 的上游
   - 修正 runDyingFlow 起点+方向+重置
   - 新增 2 个时机 atom

5. **模块 E（状态变更）** —— 独立
   - 新增 5 个时机 atom
   - 翻面公共化（依赖模块 N）

### 阶段二：P1 中等流程

6. **模块 D（多目标时序）** —— 独立
7. **模块 F（移动牌）** —— 独立，调用点多
8. **模块 G（拼点）** —— 独立
9. **模块 I（判定循环）** —— 小改动

### 阶段三：P2 小改动

10. **模块 J（阶段间）** —— 小改动
11. **模块 K（杀次数）** —— 中等
12. **模块 H（判定时机）** —— 小改动
13. **模块 L（摸牌顺序）** —— 小改动

### 阶段四：P3 可维护性

14. **模块 N（翻面/额外回合公共化）**
15. **模块 O（打出牌清理）**
16. **模块 P（逆时针顺序）**

### 跨模块依赖

```
A（伤害）→ M（扣减体力）    A 依赖 M 的 runDecreaseLifeFlow
A（伤害）→ B（死亡）        runDamageFlow → runDyingFlow → runDeathFlow
B（死亡）→ C（濒死）        runDyingFlow 末尾调 runDeathFlow
E（状态变更）→ N（翻面公共化）  翻面后 atom 依赖 flipFaceDown helper
```

### 测试策略

- 每个模块独立提交，配回归测试
- 模块 A 提交前跑全量测试（影响面最大）
- 利用现有 `tests/skill-tests/` 和 `tests/integration/` 目录
- 重点关注多技能叠加场景（裸衣+藤甲、天香+连环等）
