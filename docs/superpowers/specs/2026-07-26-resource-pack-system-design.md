# 资源包系统设计 (Resource Pack System)

**日期**: 2026-07-26
**状态**: 设计稿 (Draft) — 待用户 Review
**作者**: brainstorming session 产出

---

## 1. 背景与动机

三国杀前端目前有三类视听资源，但各自为政，没有统一的"资源"概念，更没有"包"的概念：

| 资源类型 | 加载入口 | 物理目录 | 现状评价 |
|---|---|---|---|
| 图片 | `src/client/assets/imageAssets.ts` 三个函数 | `public/cards-local/{basic,equipment,trick,characters}/` (gitignored) | 目录混乱：武将立绘塞在卡牌目录 (`characters/`) 下 |
| 音频 | `src/client/sounds/soundMap.ts` + `audioEngine.ts` | `public/sounds/` (gitignored) | 刚建成，最规整 |
| 动画 | `effect.animation` 字符串 + `EventBanner.tsx` 仅消费 `flip` | 无独立目录 | 最薄：6 种动画标识符中只有 1 种实现，其余声明但悬空 |

**问题**：

1. 三套机制独立，无统一加载层、无统一 ID 空间。
2. 图片目录命名与 ID 隐式耦合，靠注释口头约定维护。
3. 第三方无法整体替换视听表现（换皮），必须按现有散落约定逐个放文件。
4. 动画系统不完整，且与资源加载完全脱节。

**目标**：建立统一的资源包系统，让第三方能打包"曹操·夜战皮肤包""古典音效包""技能发动特效包"等，通过 manifest 声明 + 优先级覆盖机制，替换或丰富游戏的视听表现。

---

## 2. 范围与非目标

### 范围（做什么）

- 统一的**全局资源 ID** 空间（图片/音频/特效动画共享）。
- **manifest 驱动的资源包**：每个包带 `manifest.json` 声明内含资源。
- **优先级覆盖**机制：多包共存时按 priority 合并，高优先覆盖低优先。
- **玩家启停 UI**：设置面板列出已安装包，toggle 启用/禁用，持久化到 localStorage。
- **统一加载层** `ResourceManager`：收拢现有 `imageAssets.ts` + `soundMap.ts` 两套逻辑。
- **动画分两类**：系统动效（CSS 内置）+ 特效资源（Lottie JSON，可打包）。

### 非目标（不做什么）

- **纯资源换皮**：包里只有图/音/动文件，不带技能逻辑。武将/牌"是否存在"由代码决定，包只能替换它们的视听表现。第三方**不能**加新武将含原创技能（那需要技能系统数据化重构，超出资源管理范畴）。
- 不做序列帧 PNG sprite sheet（统一用 Lottie，跨平台、AE 可视化编辑）。
- 不做 mod 包签名校验、DRM、商店分发（本地安装，信任本地文件）。
- 不做运行时远程下载/热更新（本地放置 + 启用）。

---

## 3. 核心架构

### 3.1 全局资源 ID

所有资源共享一个扁平的全局 ID 空间。包内资源用此 ID 注册，加载层用此 ID 查找：

| ID 前缀 | 例子 | 对应当前代码 |
|---|---|---|
| `card/{名}-{点}-{花色}` | `card/杀-7-♠` | `getCardImage` |
| `card/equipment/{名}` | `card/equipment/丈八蛇矛` | `getEquipCardImage` |
| `character/{名}` | `character/曹操` | `getCharacterImage` |
| `sound/{id}` | `sound/play_card` | `soundMap.resolveSoundUrl` |
| `anim/{id}` | `anim/skill_奸雄` | **新增**（Lottie 特效） |

**关键约定**：武将立绘提升为顶层 `character/` 前缀，不再混在卡牌目录下。火杀/雷杀的牌名仍是 `杀`，靠花色点数组合唯一区分（`card/杀-4-♥` 只可能是火杀）。

### 3.2 包结构

```
my-pack/
  manifest.json                ← 唯一真相:声明包 id/优先级/资源清单
  character/曹操.png           ← 默认与 ID 同构(可省 file 字段)
  sound/play_card.mp3
  anim/skill_奸雄.json
  README.md                    ← 可选,作者说明/署名要求
```

物理目录**默认与 ID 同构**（`character/曹操.png` ↔ ID `character/曹操`），打包者也可按实体组织（`曹操/portrait.png`），只要 manifest 显式写 `file` 指向任意路径，系统照读。规范不强制，但默认推荐按类型分。

### 3.3 manifest.json Schema

```jsonc
{
  // ── 包元数据 ──
  "manifestVersion": 1,          // schema 版本,当前固定 1
  "id": "caocao-night",          // 全局唯一,kebab-case,用作目录名和引用键
  "name": "曹操·夜战皮肤包",     // 展示名(中文可)
  "version": "1.0.0",            // semver
  "author": "张三",              // 作者(用于 UI 展示和署名)
  "description": "...",          // 可选,UI 展示
  "homepage": "https://...",     // 可选,来源链接(便于追溯协议)

  // ── 合并行为 ──
  "priority": 100,               // 数值,大者覆盖小者;内置 base 包默认 0

  // ── 资源清单 ──
  "resources": [
    // 形态一:省 file,默认 file = 资源 ID 去前缀路径推断扩展名
    {
      "id": "character/曹操",
      "type": "image"            // image | audio | lottie
    },
    // 形态二:显式 file,指向包内任意路径(允许按实体组织目录)
    {
      "id": "character/曹操",
      "type": "image",
      "file": "曹操/portrait.png"
    },
    {
      "id": "sound/play_card",
      "type": "audio"
    },
    {
      "id": "anim/skill_奸雄",
      "type": "lottie"
    }
  ]
}
```

**默认 file 推断规则**（省略 `file` 时）：取 `id` 作为相对路径，扩展名按 `type` 推断：

| type | 扩展名 |
|---|---|
| `image` | `.png`（武将立绘/卡牌 PNG），卡牌 basic 可用 `.jpg`（向后兼容现状，需显式 `file`） |
| `audio` | `.mp3` |
| `lottie` | `.json` |

**资源冲突与覆盖**：多个启用包声明同一 ID 时，按 `priority` 降序，高优先覆盖低优先；同优先级按包 `id` 字典序（确定性兜底）。最终合并为单张 `Map<id, {packId, file}>`。

### 3.4 物理布局

```
public/packs/
  base/                         ← 内置基础包 (priority: 0, **gitignored**, 与现状 cards-local 一致)
    manifest.json
    card/杀-7-♠.jpg
    card/equipment/丈八蛇矛.png
    character/曹操.png
    sound/play_card.mp3
    anim/skill_奸雄.json
  caocao-night/                 ← 第三方/用户包 (gitignored)
    manifest.json
    character/曹操.png          ← 同 ID,priority 100,覆盖 base
```

**gitignore 策略**：`public/packs/` 整体 gitignored（资源与代码分离，与 `gen-card.ts` 产出不入 git 的工作流一致）。仓库只提交加载层代码 + 空目录结构 + 规范文档。克隆后无资源也能跑（全部走 fallback：图片→HTML 牌面/势力色，音频→静默，动画→无）。

### 3.5 合并流程

**关键架构约束**：浏览器端 JS 不能读服务器文件系统目录。包发现统一走一份服务端生成的清单 `/packs/index.json`，前端只 fetch 这一个文件，开发/生产无差异。

```
应用启动
  ↓
fetch('/packs/index.json')              ← 服务端生成的清单(见 5.4)
  列出所有已安装包: [{packId, manifest}, ...]
  ↓
读取 localStorage 'sgs:resource-packs'  (启用的包 id 列表 + 各包 priority 覆盖)
  ↓
对每个启用的包:解析 manifest.resources,收集 {id → {packId, file}}
  ↓
按 priority 降序(同优先级按 id 字典序)合并,高覆盖低
  ↓
ResourceManager 持有最终 Map<id, ResolvedResource>
  ↓
RM.get(id) → '/packs/{packId}/{file}'   (URL 直接指向物理文件)
```

**内置 base 包的优先级默认 0**，所有第三方包 priority > 0 才能覆盖。base 包本身也可在 UI 中禁用（极端情况：玩家想纯用某主题包）。

---

## 4. 动画分两类（关键设计）

动画不是单一概念，强行全部数据化是过度设计。分两类处理：

| 类别 | 例子 | 形态 | 可打包？ |
|---|---|---|---|
| **系统动效** | `flip` 翻牌 / `fade` 淡出 / `shake` 抖动 / `pulse` 脉冲 / `slide` 滑动 / `highlight` 高亮 / `flash` 闪烁 | 前端内置 CSS 类，`effect.animation` 继续是字符串 | **否**（属引擎固有 UI 反馈，与视觉风格强绑） |
| **特效资源** | 技能发动（奸雄/护驾）/ 觉醒 / 大招 / 死亡过场 | Lottie JSON 文件，新增 `effect.vfx` 字段指向 `anim/{id}` | **是**（Lottie 跨平台、AE 可视化编辑） |

### 4.1 AtomEffect 扩展

```typescript
export interface AtomEffect {
  sound?: string;        // sound/{id} —— 已有,音频标识符
  volume?: number;       // 已有,per-event 音量(0..1),与全局音量相乘
  animation?: string;    // 系统动效名(flip/fade/shake/...) —— 内置 CSS,不可打包
  vfx?: string;          // ★ 新增,Lottie 特效资源 ID,指向 anim/{id},可打包替换
  duration?: number;
  blockUntilDone?: boolean;
  screenEffect?: string;
  particles?: string;
}
```

### 4.2 前端动画补全计划

当前 `effect.animation` 的 6 种标识符只有 `flip` 实现（`EventBanner.tsx`），其余悬空。本设计要求**补全系统动效的 CSS 实现**（与资源包系统并行，不阻塞主链路）：

| animation 名 | 实现方式 | 触发组件 |
|---|---|---|
| `flip` | 已有 CSS 3D 翻转 | `EventBanner` |
| `fade` | CSS opacity transition | 待补 |
| `shake` | CSS keyframes 抖动 | 待补 |
| `pulse` | CSS scale 脉冲 | 待补 |
| `slide` | CSS transform slide-in | 待补（与 `useCardMoveAnimation` 整合） |
| `highlight` | CSS box-shadow pulse | 待补 |
| `flash` | CSS 全屏白闪 | 待补 |

### 4.3 Lottie 特效接入

引入 `lottie-web`（gzip 后约 60KB，动态 import 按需加载）。新增 `useVfxPlayback` hook：

- 监听 `useEventPlayback.ingested`（与音效同源，立即触发）。
- 按 `effect.vfx` 查 `ResourceManager.get('anim/' + id)` 得到 Lottie JSON URL。
- 在专用 `<VfxLayer>`（独立 z-index 层，pointer-events:none）挂载 `<Lottie>` 播放一次。
- 缺失资源（get 返回 null）静默跳过。

Lottie 文件格式要求：标准 Lottie JSON（AE Bodymovin 导出），推荐含 `w`/`h` 字段，建议画布 750×750 以适应中央特效区。

---

## 5. 加载层统一 (ResourceManager)

### 5.1 单一入口

```typescript
// src/client/resources/ResourceManager.ts
class ResourceManager {
  /** 初始化:fetch /packs/index.json、读 localStorage、合并出资源表 */
  async init(): Promise<void>

  /** 按全局 ID 取资源 URL,无则 null(调用方自行 fallback) */
  get(id: string): string | null

  /** 启用/禁用某包,重合并,持久化 localStorage */
  setPackEnabled(packId: string, enabled: boolean): void

  /** 列出所有已发现包(供 UI 展示) */
  listPacks(): PackInfo[]
}
export const resourceManager: ResourceManager  // 单例
```

### 5.2 现有函数迁移（消费点零改动）

现有 `imageAssets.ts` 三个函数和 `soundMap.resolveSoundUrl` 改为薄委托：

```typescript
// 迁移后(签名不变,消费点 6 处不动)
getCharacterImage(name)   →  resourceManager.get(`character/${name}`)
getCardImage(card)        →  resourceManager.get(`card/${card.name}-${card.rank}-${card.suit}`)
getEquipCardImage(name)   →  resourceManager.get(`card/equipment/${name}`)
resolveSoundUrl(id)       →  resourceManager.get(`sound/${id}`)
```

**风险控制**：函数签名和返回类型（`string | null`）保持不变，6 个消费组件（CardFace/CharSelectOverlay/EquipColumn/PlayerCardLarge/PlayerSeatView/CharSelectWaitingOverlay + audioEngine）零改动。

### 5.3 Vite 中间件（404 兜底语义）

现有 `vite-card-local-plugin.ts` 的核心价值：**文件缺失返回 404，不让 Vite SPA fallback 成 index.html**，使 `<object>`/`<img onError>`/audioEngine 负缓存能正确触发兜底。

新方案用通用 `vite-resource-plugin` 替换，拦截 `/packs/` 前缀，逻辑相同：命中文件→stream 返回 + 正确 MIME；未命中→404。MIME 表扩展加入 `.json`（Lottie）和 `.mp3`。

### 5.4 生产构建

`vite build` 自动把 `public/` 复制到 `dist/`，`public/packs/` 随之复制（即使 gitignored，本地构建时仍存在）。无需额外构建步骤。

**包发现清单 `/packs/index.json`**：由 `vite-resource-plugin` 生成，开发/生产统一路径——
- 开发期：插件 middleware 拦截 `GET /packs/index.json`，实时扫描 `public/packs/*/manifest.json` 返回 JSON（用户丢新包后刷新即生效，无需重启）。
- 生产期：`vite build` 的 `closeBundle` 钩子把扫描结果写入 `dist/packs/index.json`，随 `public/packs/` 一起部署。

清单 schema：`{ packs: Array<{ id: string; manifest: Manifest }> }`。前端 `ResourceManager.init()` 只 fetch 这一个 URL，不依赖任何文件系统访问能力。

---

## 6. 资源管理 UI

新增 `PackManagerPanel` 组件，挂在设置入口（先找现有设置入口，没有则放 GameView 的设置抽屉）：

```
┌─ 资源包管理 ─────────────────────────┐
│                                      │
│ ☑ 基础资源包  base         P0  108项 │
│   作者:内置                          │
│                                      │
│ ☑ 曹操·夜战皮肤  caocao-night P100 5项│
│   作者:张三  v1.0.0                  │
│   [来源] https://...                 │
│                                      │
│ ☐ 古典音效包  classic-sound  P50 20项 │
│   作者:李四  v0.9                    │
│                                      │
│ [重新发现]  [打开 packs 目录]        │
└──────────────────────────────────────┘
```

功能：
- toggle 启用/禁用每个包（即时重合并，无需重启）。
- 显示包名/作者/版本/priority/资源数。
- "来源"链接（若有 `homepage`）。
- 重新发现（重新 fetch `/packs/index.json`，用户往 `packs/` 丢新包后点一下）。

localStorage key：`sgs:resource-packs`，结构：
```jsonc
{
  "enabled": ["base", "caocao-night"],   // 启用的包 id 列表
  "priorityOverrides": {                  // 可选,玩家手动调整优先级(未来)
    "caocao-night": 120
  }
}
```

---

## 7. 文件规格表（推荐）

供打包者参考的规格，保持与现状兼容：

### 图片

| 资源 | 推荐尺寸 | 格式 | 说明 |
|---|---|---|---|
| 基本牌图 | 880×1184 (1760×2368 的一半,平衡清晰与体积) | JPG (照片类) / PNG (合成类) | 与 `gen-card.ts` 默认产出一致 |
| 装备/锦囊图 | 880×1184 | PNG | |
| 装备区缩略图 | 240×320 | PNG | 不需区分花色点数 |
| 武将立绘 | 480×640 (竖版,3:4) | PNG (透明背景) | 势力色背景由前端渲染 |

### 音频

| 资源 | 推荐规格 | 格式 | 说明 |
|---|---|---|---|
| 短音效 (UI/出牌/翻牌) | 128kbps, ≤1s | MP3 | 短促,无静音头尾 |
| 中音效 (伤害/死亡) | 128kbps, 1-2s | MP3 | |
| 回合/阶段音 | 128kbps, 1.5-3s | MP3 | |
| 技能特效音 | 192kbps, 1-3s | MP3 | 配合 Lottie 时长 |

### Lottie 动画

| 资源 | 规格 | 说明 |
|---|---|---|
| 技能特效 | 画布 750×750, 时长 1-2s, 含 `w`/`h` | AE Bodymovin 导出标准 JSON |

---

## 8. gen-card.ts 调整

现状：`gen-card.ts` 产出 `public/cards-ai/`（含 `border.png`/`_titles/`/`_ranks/` 共用缓存 + 成品），预览需手动 `cp` 到 `cards-local/`。

调整：保持 `cards-ai/` 作为**生成工作目录**（工具中间产物 + 缓存，继续 gitignored），但把"成品"的**默认安装目标**改为 `public/packs/base/card/`：

- `gen-card.ts` 增加输出路径选项（默认产出到 `cards-ai`，加 `--install` 直接产出到 `packs/base/card/` 并更新 `packs/base/manifest.json`）。
- 或保持现状的"生成后手动安装"，但目标文档改为 `packs/base/card/`。

推荐前者（`--install` 一键到位），减少手工对错目录的风险。具体由实现阶段定。

---

## 9. 现有资源迁移

提供一次性迁移脚本 `scripts/migrate-to-packs.ts`：

| 现状路径 | 迁移到 | ID |
|---|---|---|
| `public/cards-local/basic/杀-7-♠.jpg` | `public/packs/base/card/杀-7-♠.jpg` | `card/杀-7-♠` |
| `public/cards-local/equipment/丈八蛇矛.png` | `public/packs/base/card/equipment/丈八蛇矛.png` | `card/equipment/丈八蛇矛` |
| `public/cards-local/trick/无中生有-Q-♣.png` | `public/packs/base/card/无中生有-Q-♣.png` | `card/无中生有-Q-♣` |
| `public/cards-local/characters/曹操.png` | `public/packs/base/character/曹操.png` | `character/曹操` |
| `public/sounds/play_card.mp3` | `public/packs/base/sound/play_card.mp3` | `sound/play_card` |
| `public/cards-ai/*` | **不动** | 工具产物,与资源系统无关 |

迁移后自动生成 `public/packs/base/manifest.json`（遍历目录按约定生成 resources 清单）。**注意**：`.jpg` 文件必须显式写 `file` 字段（否则省略时按 type=image 推断成 `.png` 会找不到）；`.png`/`.mp3`/`.json` 可省略 `file`。

**回退保险**：迁移脚本默认 `mv`（移动），加 `--copy` 选项保留原文件；并在执行前打印 dry-run 预览。

---

## 10. 实现切片建议（供 writing-plans 参考）

按依赖顺序，每个切片可独立验证：

1. **类型与协议**：`AtomEffect` 加 `vfx` 字段；定义 `manifest.json` 的 TS 类型 (`src/client/resources/types.ts`)。
2. **ResourceManager 核心**：合并逻辑 + `get()`，先用硬编码 base 包跑通（不接 UI、不接包发现）。
3. **Vite 插件 `vite-resource-plugin`**：替换 `vite-card-local-plugin`，做两件事——拦截 `/packs/` 文件请求（404 兜底语义）+ 生成 `/packs/index.json`（dev 用 middleware 实时扫描，prod 用 closeBundle 钩子写入 dist）。
4. **加载层迁移**：`imageAssets.ts` 三函数 + `resolveSoundUrl` 改委托 ResourceManager，6 处消费点回归测试。
5. **包发现 + localStorage**：`ResourceManager.init()` fetch `/packs/index.json`、读写 enabled 列表、合并流程打通。
6. **迁移脚本**：`scripts/migrate-to-packs.ts`，迁移现有资源到 `packs/base/` + 生成 manifest。
7. **资源管理 UI**：`PackManagerPanel` 组件。
8. **Lottie 接入**：`useVfxPlayback` + `VfxLayer` + `lottie-web` 动态 import。
9. **系统动效补全**：fade/shake/pulse/slide/highlight/flash 的 CSS 实现（与资源包系统并行，不阻塞）。
10. **gen-card.ts `--install`**：产出直接进 `packs/base/`。

---

## 11. 未来扩展（非本期）

- 资源包远程仓库索引 + 一键下载（需后端支持）。
- 包依赖声明（皮肤包依赖某武将扩展包）。
- 包签名校验（防恶意包）。
- 动画随机变调（同一事件声音不单调）。
- 技能系统数据化（真 mod，量级巨大，另立项）。

---

## 12. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| 迁移破坏现有图片加载 | 6 处消费点图片失效 | 函数签名不变,迁移后回归测试全部组件 |
| 开发/生产包发现机制统一 | 实现遗漏导致生产失效 | 统一走 `/packs/index.json`,dev 由 middleware、prod 由 closeBundle 钩子生成,实现时两端各验证一次 |
| Lottie 引入包体积 | +60KB gzip | 动态 import 按需加载,首屏不阻塞 |
| 优先级冲突玩家难理解 | 多皮肤包互相覆盖 | UI 显示 priority 数值 + "高优先覆盖低优先"提示 |
| 武将立绘改顶层目录 | `characters/` 子目录历史路径失效 | 迁移脚本处理,gen-card 产出路径同步调整 |

---

## 13. 验收标准（整体）

- [ ] 现有图片/音频加载全部回归通过（无新增失败）。
- [ ] `ResourceManager.get` 对所有已迁移资源 ID 返回正确 URL。
- [ ] 放入一个测试包（高 priority 同 ID 覆盖 base），覆盖生效。
- [ ] `PackManagerPanel` toggle 启停某包,资源即时切换。
- [ ] 缺失资源（无文件）所有 fallback 正常触发（图片→HTML 牌面/势力色，音频→静默，动画→无）。
- [ ] `tsc --noEmit` 无新增错误,`vitest run` 不引入新失败。
- [ ] `npm run dev` 起得来,smoke 验证三种模式（multiplayer/debug/replay）资源加载正常。
