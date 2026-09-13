# voxel-selection.ts

**职责**：持有 Uniform voxel object 在内容编辑中的局部体素选择集、选择来源、模式和锚点。

**接口**：
- `VoxelSelectionState`：`sceneObjectId: SceneObjectId`、`keys: readonly VoxelKey[]`、`mode`、`anchor?`、`source`、`version`。
- `set`、`replace`、`add`、`remove`、`toggle`、`clear`、`contains`、`snapshot`、`subscribe`。

**内部**：
- 本状态仅适用于 Uniform voxel object，不是所有 SceneObject 的通用选择状态。这里的 “Uniform voxel object” 是当前 `SceneObjectSnapshot.voxels: VoxelSnapshot` 基线表示，不是一个额外的运行时类名。
- 所有键都只属于 `sceneObjectId` 的局部网格。写入方法必须显式接收目标 `sceneObjectId`，并拒绝与当前绑定不同的对象；应用层负责在调用前保证它等于 `EditorState.activeSceneObjectId`。本状态不 import 其他 state 模块。
- 内部可以用 `Set` 去重，但 snapshot 只返回按稳定键排序的只读数组，不把可变 `Set` 暴露给调用方。只保存稳定体素键，不保存 `VoxelValue`、Transform entry 或渲染对象；颜色、位置和可见性通过活动对象的 Uniform 只读视图读取。
- `replace` 用于新选择手势，`add/subtract` 用于 Uniform Voxel XFORM。同一键幂等；结果按局部 `VoxelKey` 排序。
- EditorSession 必须在活动对象变化、退出内容编辑、对象被删除或场景替换时调用 `clear`；本状态不自行订阅 EditorState。清除选择不隐式提交或取消 Uniform Voxel XFORM。
- 选择变更不修改 SceneDocument、不写 History、不触发渲染提交。

**依赖**：scene-types、voxel/uniform/types、util/packed-int、util/result。
