# picker-port.ts

**职责**：应用层对拾取实现的抽象。
**接口**：pick、pickMany、setMode、setObjectFilter、invalidate、dispose。
**内部**：
- `setMode("object" | "voxel")` 决定返回对象命中还是体素命中；Edit 模式必须同时设置 `setObjectFilter(activeObjectId)`。
- 过滤在拾取实现内部生效，不能先拾取到其他对象再依赖 UI 忽略；非活动对象即使参与渲染，也不得进入 Edit 模式拾取结果。
- 返回稳定 PickResult，不泄漏 render target、实例 ID 或 GPU 资源。

**依赖**：pick-result、scene-types。
