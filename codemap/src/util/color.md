# color.ts

**职责**：颜色解析、转换和调色板比较。
**接口**：parseHex、toHex、linearize、srgbToLinear、equals。
**内部**：领域内使用稳定颜色值；Three.js Color 转换只发生在渲染层。
**依赖**：none。
