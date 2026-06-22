// src/client/engine-imports.ts
// 前端引擎注册聚合点。
//
// 前端需要 atom 注册表(applyView 查找)和 skill 模块解析(defineAction 前端逻辑)。
// 后端的 validate/apply/execute 被 tree-shake,只保留前端用的 applyView/defineAction。
//
// 集中在一个文件 import,避免各前端模块重复触发注册副作用。
import '../engine/atoms';
import '../engine/skills';
