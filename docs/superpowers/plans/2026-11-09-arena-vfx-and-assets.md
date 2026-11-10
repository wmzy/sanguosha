# 演武场牌桌动效增强与资产台词补充 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 升级演武场观战牌桌的视觉表现（出牌飞入、水墨斩击刀光、统一技能发动横幅、指向性目标高亮与连线、装备区真实卡面呈现），并整理 165 名武将经典台词文档与补全卡面立绘资产。

**Architecture:** 
- 前端动效采用纯 CSS3 + SVG + React 状态机驱动，避免引入重型外部动画引擎；
- 装备区复用既有 `CardFace` 组件渲染紧凑型卡牌；
- 台词整理与资产补齐由脚本提取并产出结构化文档及安装配置。

**Tech Stack:** React 19, TypeScript, CSS3 Animation, SVG, Vitest.

**Spec:** 用户三项指令（牌桌动效优化、台词文档整理、卡牌角色资产补充）。

## Global Constraints

- 严禁破坏现有 4176 项单测基线；
- 动效轻量、平滑，在 `arena-clean` 纯净模式下自动静默；
- 装备卡面展示需自适应座位宽度，保证在移动端与桌面端均不换行错位；
- 遵循 CLAUDE.md 中文命名与类型约定。

## Review Focus

1. 连续快速出牌时，飞牌动画与中心区域卡牌堆叠不穿模、不内存泄露；
2. 刀光与被指向目标连线在 5~8 人不同座次相对位置下的坐标计算正确；
3. 装备区微缩卡面在无对应 cardMap 实体时优雅回退（避免崩溃）；
4. 技能横幅并发弹出时自动排队或平滑淡出，不遮挡中央牌堆；
5. 台词文档结构完整清晰，覆盖全部可用武将。

---

### Task 1: 装备区真实卡面展示升级

**Files:**
- Modify: `src/client/components/arena/ArenaTable.tsx`
- Modify: `src/client/pages/arena.css`
- Test: `tests/arena/table-equip-cardface.test.tsx`

**Interfaces:**
- Consumes: `view.cardMap[id]` (Card object), `CardFace`
- Produces: 装备栏支持完整牌面卡片展示（花色、点数、卡名、武器/防具标签）

- [ ] **Step 1: 编写装备区渲染微缩卡面的单测**
- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 修改 `ArenaTable.tsx`，将装备区纯文字替换为微型 `CardFace` 卡片**
- [ ] **Step 4: 补充 `arena.css` 紧凑型装备槽与悬浮卡面样式**
- [ ] **Step 5: 运行测试验证通过并 commit**

---

### Task 2: 出牌飞入动画与中央展示动效

**Files:**
- Modify: `src/client/components/arena/ArenaTable.tsx`
- Modify: `src/client/pages/arena.css`
- Test: `tests/arena/card-fly-vfx.test.tsx`

**Interfaces:**
- Consumes: `view.currentPlayerIndex`, `view.zones.processing`
- Produces: `arena-flying-card` CSS3 飞牌过渡轨道

- [ ] **Step 1: 编写出牌座次到中心位置的飞牌坐标计算与测试**
- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 在 `ArenaTable.tsx` 中加入 `useRef` 追踪上一次 processing 变化并生成从出牌座位飞入中央的处理动画**
- [ ] **Step 4: 在 `arena.css` 中增加流畅的飞入与光晕 keyframes**
- [ ] **Step 5: 验证测试通过并 commit**

---

### Task 3: 指向性卡牌高亮、连线与刀光斩击动效

**Files:**
- Create: `src/client/components/arena/TargetPointerSvg.tsx`
- Create: `src/client/components/arena/SlashBladeVfx.tsx`
- Modify: `src/client/components/arena/ArenaTable.tsx`
- Modify: `src/client/pages/arena.css`
- Test: `tests/arena/target-slash-vfx.test.tsx`

**Interfaces:**
- Consumes: `view.pending` / `recentEvents` 中的目标指向与伤害事件
- Produces: `<TargetPointerSvg>` 虚线箭头连线，`<SlashBladeVfx>` SVG 水墨金色刀光

- [ ] **Step 1: 编写目标连线与斩击刀光的组件单测**
- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 实现 `TargetPointerSvg`（绘制发起座位到目标座位的 SVG 动态虚线与锁敌红框）**
- [ ] **Step 4: 实现 `SlashBladeVfx`（在受击者头像上播放水墨刀光）**
- [ ] **Step 5: 集成入 `ArenaTable.tsx`，运行测试验证通过并 commit**

---

### Task 4: 统一武将技能发动横幅提醒

**Files:**
- Create: `src/client/components/arena/SkillToastOverlay.tsx`
- Modify: `src/client/components/arena/ArenaTable.tsx`
- Modify: `src/client/pages/arena.css`
- Test: `tests/arena/skill-toast.test.tsx`

**Interfaces:**
- Consumes: `view.log` 中的技能发动条目（如 `使用【界制衡】`、`发动【义绝】`）
- Produces: 浮动水墨金边横幅 `SkillToastOverlay`

- [ ] **Step 1: 编写技能发动监听与横幅触发单测**
- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 实现 `SkillToastOverlay` 并在座次上方渲染金黑渐变水墨横幅**
- [ ] **Step 4: 运行测试验证通过并 commit**

---

### Task 5: 165 名可用武将经典台词整理归档

**Files:**
- Create: `scripts/extract-character-quotes.ts`
- Create: `docs/research/武将经典台词.md`
- Test: `tests/qa/character-quotes.test.ts`

**Interfaces:**
- Consumes: `allCharacters` 及研究档案库
- Produces: 完整的 165 将技能与阵亡语音台词档案

- [x] **Step 1: 编写台词提取脚本与校验单测**
- [x] **Step 2: 运行提取生成 `docs/research/武将经典台词.md`**
- [x] **Step 3: 验证台词完整覆盖率并 commit**

---

### Task 6: 卡牌牌面与武将立绘资产补充

**Files:**
- Modify: `scripts/install-arena-assets.mjs`
- Modify: `src/client/assets/imageAssets.ts`
- Test: `tests/unit/imageAssets.test.ts`

**Interfaces:**
- Consumes: 上游公开素材包
- Produces: 确保 165 将立绘与标准牌面 100% 映射不缺失

- [ ] **Step 1: 运行资产审计脚本找出缺失立绘清单**
- [ ] **Step 2: 扩充 `install-arena-assets.mjs` 增补素材映射与默认回退**
- [ ] **Step 3: 运行 `pnpm typecheck` 与 `pnpm test` 确认全绿并 commit**
