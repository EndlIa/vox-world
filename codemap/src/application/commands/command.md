# command.ts

**职责**：所有编辑命令的纯数据契约。
**接口**：`Command` 是可辨识联合，包含 Scene、Voxel、VoxelTransform、Model 和 Generator 命令族；每个命令只包含 type、payload 和 metadata（id、baseSceneVersion、source）。
**内部**：不可变、可序列化的用户意图；不包含 validate、execute、函数引用、状态引用或渲染对象，也不描述最终补丁。
- Scene 命令在 Object 模式下操作对象/节点；Voxel、VoxelTransform 和 Model 命令在 Edit 模式下必须携带并匹配 `EditorState.activeObjectId`。
- 命令中的体素坐标始终是目标 `VoxObject` 的局部坐标；跨对象操作必须拆成多个命令或显式 Scene 命令。
- `baseSceneVersion` 是当前命令绑定的场景版本，替代旧的单文档 `baseVersion`。

**依赖**：scene-commands、voxel-commands、voxel-transform-command、model-commands、generator-commands、util/math。
