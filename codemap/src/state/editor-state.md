# editor-state.ts

**职责**：拥有编辑器的 Object/Edit 模式和唯一的活动编辑对象。

**接口**：
- `EditorMode = "object" | "edit"`。
- `EditorStateSnapshot`：`{ mode; activeObjectId; version }`。
- `enterEdit(objectId)`、`exitEdit`、`setActiveObject(objectId)`、`snapshot`、`subscribe`。

**内部**：
- Object 模式下 `activeObjectId` 必须为 `null`。选中对象只由 `ObjectSelection` 持有，EditorState 不复制它。
- Edit 模式下 `activeObjectId` 必须非空，并且当前场景中必须存在该对象。ObjectSelection 的同步由 Scene Command Handler/EditorSession 保证；EditorState 不依赖也不复制另一个 state 模块。
- 进入 Edit 模式前必须先结束或取消 Object XFORM；退出 Edit 模式前必须先提交或取消 Voxel XFORM，并按显式规则清空活动对象的体素 Selection。
- 切换活动对象时必须清空旧对象的体素 Selection 和 XFORM；不得把对象 A 的局部 `VoxelKey` 带入对象 B。
- 活动对象被删除、场景被替换或项目关闭时，EditorState 必须回到 Object 模式并清空活动对象。
- EditorState 只保存运行时状态，不写入项目快照、不写 History、不修改 SceneDocument。

**依赖**：scene-types、util/result。
