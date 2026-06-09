# `_legacy/` 目录

该目录为迁移期参考代码。新代码请勿引用,具体规则:

1. 该目录下文件的相对 import 路径保持原样(`./types` 仍是 `_legacy/types`)
2. 新代码**禁止** `import` 该目录下任何文件
3. 目标:全部功能在新引擎稳定后,删除整个目录

参考的当前目标: `docs/superpowers/specs/2026-06-09-engine-rewrite-design.md`