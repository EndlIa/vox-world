# bvh-picker.ts

**职责**：CPU 精确拾取和回退实现。
**接口**：build、pick、pickMany、invalidate。
**内部**：从可见体素表面构建 three-mesh-bvh；用于复杂变换、导出预览和 GPU 拾取失败回退。
**依赖**：three-mesh-bvh。
