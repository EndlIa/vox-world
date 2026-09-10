# project.ts

**职责**：项目聚合根。
**接口**：create、snapshot、settings、metadata、version、markDirty、markSaved。
**内部**：组合一个可序列化的 `SceneSnapshot`、由 `domain/animation` 唯一拥有的 `AnimationDocument` 和 `ProjectCameraSettings`/`ProjectRenderSettings` 项目设置；只维护项目数据，不负责编解码、存储、选择、渲染资源或历史。
- 项目必须恰好持有一个场景快照。场景中的多个 `VoxObject` 由 `SceneNode` 组织；项目不保存活动对象、编辑模式、体素选择、XFORM 预览或渲染运行时对象。
- `snapshot()` 返回不可变纯数据，至少包含 `scene`、`animation` 和项目设置；不得泄漏 `SceneDocument`、`VoxObject` 可变条目、Three.js 对象或内部索引。
- `Project.version` 是项目聚合修订号，覆盖场景结构、节点变换、对象可见性、对象局部体素、动画、camera/render 和 Bake Mesh manifest；它不同于 `SceneDocument.version` 的场景并发版本。任一持久字段变化都必须能够推进项目版本并驱动 dirty 状态。
- 项目只持久化 authored/base 场景与动画文档；播放状态、当前时间、`AnimationEvaluation` 和运行时 override 都不是项目字段，不得写回 `SceneDocument`，也不得推进 `Project.version` 或 dirty。
- 打开、新建和保存通过 `SceneSnapshot` 整体流转；不得把多个对象压平成一个全局体素快照。
**依赖**：scene-types、animation、domain/render 的项目设置 DTO。

## 本重构必须补齐

- 项目聚合根必须持有完整的当前 `camera`/`render` 项目设置。
- `settings` 必须返回 `ProjectCameraSettings`/`ProjectRenderSettings` 的不可变普通数据快照；新建、打开、恢复和保存必须通过该契约流转。
- 项目设置变更必须能增加项目版本并驱动 dirty 状态，但不得让领域对象依赖 Three.js、DOM、偏好存储或持久化实现。
- 新建项目必须显式生成默认 `AnimationDocument`、完整的 camera/render 设置和空 Bake Mesh manifest，不能依赖加载器补字段。
