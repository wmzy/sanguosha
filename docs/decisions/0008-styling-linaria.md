# ADR 0008 - 使用 Linaria 进行样式管理

**状态**: 已接受

**背景**: 项目原有 241 处内联 `style={{}}`，需要 CSS-in-JS 方案。要求与 Vite 兼容、零运行时 CSS 提取、样式与组件同位置。

**决策**: 使用 Linaria 作为所有组件的样式方案。将内联 `style={{}}` 迁移到 Linaria `css` tagged template。

**后果**:
- **正面**: 零运行时 CSS 提取、静态分析、样式与组件同文件、通过模板插值支持主题
- **负面**: 构建时依赖、测试环境中 CSS 被 mock（`mocked-css-${idx++}`）、测试中 className 顺序脆弱

**参考**: `src/components/Loading.tsx`（静态样式示例）、`src/theme.ts`（主题常量定义）