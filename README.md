# 三国杀

基于 Web 的三国杀多人在线卡牌游戏。

## 技术栈

- **前端:** React 19 + TypeScript + Vite 8
- **后端:** Hono + WebSocket
- **样式:** Linaria CSS-in-JS
- **测试:** Vitest + Playwright
- **包管理:** pnpm

## 快速开始

```bash
pnpm install
pnpm dev          # 启动开发服务器 (http://localhost:3930)
```

## 命令

```bash
pnpm dev          # 开发服务器（前端 + API + WebSocket 共享端口）
pnpm build        # 构建生产版本
pnpm test         # 运行所有测试
pnpm test:watch   # 监听模式运行测试
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint 检查
pnpm format       # Prettier 格式化
pnpm server       # 独立运行后端服务器
```

## 项目结构

```
shared/           # 前后端共享的类型和数据
  types.ts        # 核心类型定义
  characters.ts   # 角色配置（25个标准角色）
  cards.ts        # 卡牌定义（基本牌/锦囊牌/装备牌）
  deck.ts         # 牌组管理
  rng.ts          # 种子化随机数
  log.ts          # 日志类型

engine/           # 游戏引擎（纯逻辑，无 UI 依赖）
  state.ts        # 游戏状态管理
  turn.ts         # 回合阶段执行
  effect.ts       # 卡牌效果解析
  prompt.ts       # 玩家输入提示
  logger.ts       # 游戏日志记录
  replay.ts       # 重播引擎

src/              # 前端 React 应用
  components/     # UI 组件
  hooks/          # 自定义 Hooks
  utils/          # 工具函数

server/           # 后端服务器
  app.ts          # Hono 应用（REST API）
  会话.ts         # 游戏会话管理
  房间.ts         # 房间管理
  协议.ts         # WebSocket 消息协议

tests/            # 测试
  unit/           # 单元测试
  integration/    # 集成测试
```

## 游戏功能

- 25 个标准角色（魏蜀吴群四势力）
- 基本牌：杀、闪、桃
- 锦囊牌：过河拆桥、顺手牵羊、无中生有、决斗、万箭齐发、南蛮入侵、桃园结义、五谷丰登
- 装备牌：8 种武器、2 种防具、6 种马
- 身份局：主公/忠臣/反贼/内奸
- 游戏日志与重播
- 多人联机（WebSocket）

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3930` | 服务器端口 |
| `HOST` | `true` | 绑定地址（`true` = 所有网卡） |
