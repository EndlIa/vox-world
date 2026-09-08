# project.ts

**职责**：项目聚合根。
**接口**：create、snapshot、settings、metadata、version、markDirty、markSaved。
**内部**：组合可序列化的体素快照、动画和 `ProjectCameraSettings`/`ProjectRenderSettings` 项目设置；只维护项目数据，不负责编解码、存储、迁移、选择、渲染资源或历史。
**依赖**：voxel-types、animation、domain/render 的项目设置 DTO。

## 本重构必须补齐

- 项目聚合根必须持有当前 `camera`/`render` 项目设置，而不是只在旧 codec 中保留兼容字段。
- `settings` 必须返回 `ProjectCameraSettings`/`ProjectRenderSettings` 的不可变普通数据快照；新建、打开、恢复和保存必须通过该契约流转。
- 项目设置变更必须能增加项目版本并驱动 dirty 状态，但不得让领域对象依赖 Three.js、DOM、偏好存储或持久化实现。
