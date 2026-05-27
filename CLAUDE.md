# CLAUDE.md

## 项目概述

三国杀数字卡牌游戏。React + TypeScript + Hono + Vite。

## 命名规则

- 文件名、函数名、变量名：英文
- 业务概念（角色名、技能名、卡牌名）：中文
- 类型接口中与游戏相关的字段：中文（如 `玩家列表`、`手牌`、`体力`）

## 开发规范

- 测试驱动开发（TDD）：先写测试，再写实现
- 每次提交前运行 `pnpm typecheck` 和 `pnpm test`
- 使用 `pnpm lint --fix` 修复代码风格
- 组件使用 named export（不用 default export）
- 服务端状态管理使用 plain object + event emitter，不用状态管理库

## 关键架构决策

- **服务器权威架构**：游戏状态在服务端维护，客户端只接收公开信息
- **数据驱动的技能系统**：角色技能定义为配置对象，引擎运行时解释执行
- **种子化随机数**：使用 Mulberry32 PRNG，相同种子产生相同序列，支持确定性重播
- **Command Log 日志**：记录操作而非状态快照，服务端日志 + 每个玩家视角日志

## 测试

```bash
pnpm test              # 运行所有测试
pnpm test -- tests/unit/state.test.ts  # 运行单个文件
pnpm test:watch        # 监听模式
```

## 文件结构

- `shared/` — 前后端共享的类型和数据
- `engine/` — 游戏引擎（纯逻辑）
- `src/` — 前端 React 应用
- `server/` — 后端服务器
- `tests/` — 测试
- `docs/` — 设计文档和实现计划

## 环境

- Node.js >= 22
- pnpm
- 开发服务器：`pnpm dev`（端口 3930）
