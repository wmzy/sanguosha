# 演武场牌桌全息动效（飞牌/摸牌/顺拆/锁链/大技能特写/装备触发）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全面构建演武场牌桌的电影级动作反馈与动效系统，包括通用飞牌轨迹（出牌/响应/摸牌/顺手牵走/弃牌）、铁索连环实体锁链缠绕与多目标指向、全屏级水墨黑金技能大特写、以及装备牌触发流光与气泡。

**Architecture:** 
- `FlyingCardLayer.tsx`：统筹管理牌桌所有空间飞牌动画（摸牌：牌堆→座次；出牌/响应：座次→中央；顺手：目标座次→发起座次；弃牌/拆桥：座次→弃牌堆）；
- `IronChainOverlay.tsx`：座次上的实体 SVG 粗铁链金属缠绕动效，配合多目标动态连线；
- `GrandSkillBanner.tsx`：全场可见的电影级黑金大特写（武将切片立绘 + 烫金大字 + 水墨气劲冲击波）；
- `ArenaTable.tsx` & `arena.css`：装备触发流光气泡与事件监听整合。

**Tech Stack:** React 19, TypeScript, CSS3 Animation, SVG, Vitest.

**Spec:** 用户明确指定的 6 项动效反馈需求（顺拆牌飞出/凸显、敌方响应飞出、铁索连环锁链与连线、显式技能大特写、装备触发高亮、摸牌飞入座次）。

## Global Constraints

- 纯 CSS3 + SVG + React 状态机驱动，零外来重型动画库，保持最高性能；
- 动效支持 `arena-clean` 纯净模式与常规模式平滑切换；
- 兼容实时观战与时间轴历史回放（逐帧 scrub 不卡顿、不内存泄露）；
- 保持全量单测通过。

## Review Focus

1. 连续快速出牌与摸牌时，飞牌飞行动画队列自动回收，避免 DOM 节点累积；
2. 铁索连环双目标或多目标同时连线与锁链覆盖在 2~8 人座次下的坐标正确性；
3. 顺手牵羊与过河拆桥针对手牌（暗牌）与装备（明牌）均能准确识别来源座次与目标座次；
4. 技能大特写播放时层级适中，不影响底层牌桌核心点击交互（pointer-events: none）；
5. 装备触发高亮在动画结束后平滑淡出，不阻碍微缩卡面正常悬浮放大。

---

### Task 1: 全息飞牌系统 `FlyingCardLayer.tsx`

**Files:**
- Create: `src/client/components/arena/FlyingCardLayer.tsx`
- Modify: `src/client/components/arena/ArenaTable.tsx`
- Modify: `src/client/pages/arena.css`
- Test: `tests/arena/flying-card-system.test.tsx`

**Interfaces:**
- Consumes: `view.log`, `view.zones`, `view.players` 的牌数与牌区变化
- Produces: 
  - `draw`：中央牌堆 -> 玩家手牌区飞入；
  - `play` / `respond`：玩家座次 -> 中央处理区飞入；
  - `snatch` (顺手)：被选座次 -> 发起座次飞行；
  - `dismantle` (拆桥) / `discard` (弃牌)：座次 -> 弃牌堆飞入并消隐。

- [x] **Step 1: 编写多轨迹飞牌动效的状态检测与单测**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 实现 `FlyingCardLayer.tsx` 动态计算屏幕百分比坐标与飞行轨迹**
- [x] **Step 4: 在 `arena.css` 中增加流畅的 3D 旋转、缩放与残影飞行 keyframes**
- [x] **Step 5: 验证测试通过并 commit**

---

### Task 2: 铁索连环实体锁链缠绕与多目标指向

**Files:**
- Create: `src/client/components/arena/IronChainOverlay.tsx`
- Modify: `src/client/components/arena/TargetPointerSvg.tsx`
- Modify: `src/client/components/arena/ArenaTable.tsx`
- Modify: `src/client/pages/arena.css`
- Test: `tests/arena/iron-chain.test.tsx`

**Interfaces:**
- Consumes: `player.marks` 中 `连环`/`横置` 状态与铁索连环多目标出牌事件
- Produces: 
  - 头像上的金属粗铁链缠绕锁死动画（冷银蓝脉冲流光）；
  - `TargetPointerSvg` 支持一对多（1 对 2）同时绘制指向箭头。

- [x] **Step 1: 编写锁链缠绕与多目标连线测试**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 实现 `IronChainOverlay.tsx`（金属质感粗锁链交叉缠绕 SVG）**
- [x] **Step 4: 扩展 `TargetPointerSvg.tsx` 支持多目标连线与锁定**
- [x] **Step 5: 验证测试通过并 commit**

---

### Task 3: 电影级黑金水墨技能大特写 `GrandSkillBanner.tsx`

**Files:**
- Create: `src/client/components/arena/GrandSkillBanner.tsx`
- Modify: `src/client/components/arena/ArenaTable.tsx`
- Modify: `src/client/pages/arena.css`
- Test: `tests/arena/grand-skill-banner.test.tsx`

**Interfaces:**
- Consumes: `view.log` 中检测到的武将技能发动事件
- Produces: 屏幕中央靠上的震撼黑金特写横幅（武将切片金环立绘 + 烫金大字技能名 + 水墨冲击光晕，持续 1.8s）

- [x] **Step 1: 编写大特写横幅触发与自动淡出单测**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 实现 `GrandSkillBanner.tsx` 与排队展示逻辑**
- [x] **Step 4: 编写 `arena.css` 电影级水墨黑金横幅与气劲扩散动画**
- [x] **Step 5: 验证测试通过并 commit**

---

### Task 4: 装备牌触发流光高亮与提示气泡

**Files:**
- Modify: `src/client/components/arena/ArenaTable.tsx`
- Modify: `src/client/pages/arena.css`
- Test: `tests/arena/grand-vfx.test.tsx`

**Interfaces:**
- Consumes: `view.log` 中的装备触发事件（八卦阵、青龙刀、藤甲、仁王盾、丈八蛇矛、白银狮子等）
- Produces: 触发槽位金色呼吸流光（`is-equip-triggered`）及动态悬浮气泡（`【八卦阵】判定`、`【青龙偃月刀】追杀`）

- [x] **Step 1: 编写装备触发检测与高亮样式的单测**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 在 `ArenaTable.tsx` 中增加装备触发事件监听与高亮气泡渲染**
- [x] **Step 4: 在 `arena.css` 中增加流光溢彩与浮动气泡动画**
- [x] **Step 5: 验证测试通过并 commit**

---

### Task 5: 牌桌全局整合、测试套件回归与联调验证

**Files:**
- Modify: `src/client/components/arena/ArenaTable.tsx`
- Run: `pnpm typecheck`
- Run: `pnpm test`

- [ ] **Step 1: 运行全部新编写的牌桌动效单测**
- [ ] **Step 2: 运行工程类型检查**
- [ ] **Step 3: 运行完整技能测试套件保证零回归**
- [ ] **Step 4: 提交代码并推送到远端仓库**
