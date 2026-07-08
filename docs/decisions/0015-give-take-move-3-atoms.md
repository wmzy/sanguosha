# ADR 0015 — giveCard / takeCard 3 原子（13+ 技能语义统一）

**状态**: 已接受

**前置依赖**: ADR 0012

## 背景

本 ADR 的背景：13+ 技能（仁德/突袭/反间/好施/黄天/集智/借刀失败/归心/反馈/烈刃/雷击/顺手牵羊/过河拆桥）都涉及“卡牌从 A 到 B”的语义，但代码里用多种方式实现：

- 直接改 `state.players[from].hand` 数组（仁德 `src/src/engine/skills/shu.ts:1-50`）
- 用 `discard` + `gainCard` 组合（突袭 `src/src/engine/skills/wei.ts:200-260`）
- 用 `moveCard` atom

这些方式缺乏统一语义，导致：
1. serverLog payload 字段不一致（`{from, to, cardId}` vs `{cardId, from, to}` vs `{player, cardId, from}`）
2. 钩子监听需要为每种实现单独写
3. 鬼道/鬼才等"读手牌"技能难以判断"卡牌刚到某人手"

## 决策

### 抽 3 个独立 atom

```ts
// src/src/engine/types.ts Atom 联合新增
| { type: 'giveCard'; cardId: Expr<string>; from: Expr<string>; to: Expr<string> }
| { type: 'takeCard'; cardId: Expr<string>; to: Expr<string> }
```

- `giveCard`：从 `from` 手牌移除 + 加入 `to` 手牌，emit `{cardId, from, to}`
- `takeCard`：从 `state.zones.deck` 移除 + 加入 `to` 手牌，emit `{cardId, to}`
- `moveCard` 保留：跨 zone（hand/discardPile/equipment）的移动，emit `cardMoved`（保留 view/reducer 兼容）

### 不引入"强校验"（silent 追加）

`giveCard` 源玩家手牌没 cardId 时静默追加到目标（与 `discard` 同样不校验）。理由：跨 zone 转移（如装备区→手牌）应允许。

### view reducer 暂不处理

`applyGameStateEvent` 当前对 `giveCard` / `takeCard` 是 no-op（fall through to default）。Task 6 范围外。**P1 跟进**（13+ 技能 v3 迁移时必须修，否则 client replay desync）。

## 后果

**正面**:
- 13+ 技能可以统一写 `applyAtoms([{ type: 'giveCard', cardId, from, to }])`
- serverLog payload 一致
- 钩子监听（如 反馈、完杀）可写 filter 检查 giveCard 的 from/to

**负面**:
- view reducer 缺 `giveCard` / `takeCard` case → client replay 静默 desync（潜在 integration bug，仅在实际技能用这些 atom 时暴露）
- silent 追加行为需要文档化

## 验证

- `tests/atoms/give-take-move.test.ts`: 5 测试
  - moveCard: hand → discardPile（用 `cardMoved` 事件名，原行为）
  - giveCard: P1 → P2 双方手牌变化
  - takeCard: deck → P1.hand
  - giveCard: serverLog payload 含 from/to/cardId
  - giveCard: 源玩家缺 cardId 时静默追加（边界行为）
- 全量测试：1306 pass
- `pnpm typecheck`: clean

## 改动文件

**新增**:
- `src/src/engine/atoms/giveCard.ts` (40 行)
- `src/src/engine/atoms/takeCard.ts` (35 行)
- `tests/atoms/give-take-move.test.ts` (5 测试)

**修改**:
- `src/src/engine/atoms/index.ts`: 注册 giveCard + takeCard
- `src/src/engine/types.ts`: Atom 联合 + 2 个变体
- `tests/engine-helpers.ts`: `TestGameOptions` 加 `hand` / `deck` 选项

## 跟进项（P1）

- `src/src/engine/view/reducer.ts:applyGameStateEvent` 加 `case 'giveCard'` / `case 'takeCard'`，mutate `state.players[from/to].hand`
- 13+ 技能 v3 迁移时使用新 atom（`trigger.event` → `registerAtomHook`）

## ADR 关系

- **依赖**: ADR 0012
- **被未来依赖**: 13+ 技能 v3 迁移（P1+）
