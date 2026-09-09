# voxel-selection.ts

**职责**：持有 Edit 模式中活动 `VoxObject` 的局部体素选择集、选择来源、模式和锚点。

**接口**：
- `VoxelSelectionState`：`objectId: VoxObjectId`、`keys: readonly VoxelKey[]`、`mode`、`anchor?`、`source`、`version`。
- `set`、`replace`、`add`、`remove`、`toggle`、`clear`、`contains`、`snapshot`、`subscribe`。

**内部**：
- 所有键都只属于 `objectId` 的局部网格。写入方法必须显式接收目标 `objectId`，并拒绝与当前绑定不同的对象；应用层负责在调用前保证它等于 `EditorState.activeObjectId`。本状态不 import 其他 state 模块。
- 内部可以用 `Set` 去重，但 snapshot 只返回按稳定键排序的只读数组，不把可变 `Set` 暴露给调用方。只保存稳定体素键，不保存 `VoxelValue`、Transform entry 或渲染对象；颜色、位置和可见性通过活动对象的 `VoxelReadView` 读取。
- `replace` 用于新选择手势，`add/subtract` 用于 Voxel XFORM。同一键幂等；结果按局部 `VoxelKey` 排序。
- EditorSession 必须在活动对象变化、退出 Edit 模式、对象被删除或场景替换时调用 `clear`；本状态不自行订阅 EditorState。清除选择不隐式提交或取消 Voxel XFORM。
- 选择变更不修改 SceneDocument、不写 History、不触发渲染提交。

**依赖**：scene-types、voxel-types、util/packed-int、util/result。
