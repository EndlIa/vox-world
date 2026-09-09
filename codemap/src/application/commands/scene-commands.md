# scene-commands.ts

**职责**：定义 Object/Edit 模式切换、对象选择和场景级结构/变换操作的纯数据命令。

**接口**：
- `SceneCommand` 可辨识联合：`select-object`、`create-vox-object`、`delete-vox-object`、`rename-scene-node`、`set-object-visibility`、`reparent-scene-node`、`begin-object-transform`、`update-object-transform`、`apply-object-transform`、`cancel-object-transform`、`enter-edit-mode`、`exit-edit-mode`、`set-active-object`。
- `SelectObjectCommand`：`{ objectId: VoxObjectId; baseSceneVersion }`。
- `CreateVoxObjectCommand`：`{ parentNodeId; name; transform: SceneTransform; voxels: VoxelSnapshot; baseSceneVersion }`；原子创建一个 `SceneNode` 和一个绑定到它的 `VoxObject`。`transform` 相对 `parentNodeId`，父节点必须是组节点。
- `DeleteVoxObjectCommand`：`{ objectId; baseSceneVersion }`；删除对象及其绑定节点。
- `RenameSceneNodeCommand`：`{ nodeId; name; baseSceneVersion }`。
- `SetObjectVisibilityCommand`：`{ objectId; visible: boolean; baseSceneVersion }`；修改绑定节点的渲染可见性，不修改任何体素。
- `ReparentSceneNodeCommand`：`{ nodeId; newParentNodeId; preserveWorldTransform: boolean; baseSceneVersion }`；第一版只允许不产生环且目标父节点为组节点。`preserveWorldTransform` 默认 `true`：为 `true` 时由 Handler 重算节点局部变换，保持世界姿态；`false` 时保留局部变换，允许世界姿态随父节点变化。
- `BeginObjectTransformCommand`、`UpdateObjectTransformCommand`、`ApplyObjectTransformCommand`、`CancelObjectTransformCommand`：驱动 `ObjectTransformSession`，只修改节点 `SceneTransform`。
- `EnterEditModeCommand`：`{ objectId; baseSceneVersion }`；原子设置 ObjectSelection 和 EditorState.activeObjectId。
- `ExitEditModeCommand`：`{ baseSceneVersion }`；只退出 EditorState，保留 ObjectSelection。
- `SetActiveObjectCommand`：`{ objectId; baseSceneVersion }`；仅 Edit 模式可用，原子同步 ObjectSelection 与 EditorState.activeObjectId。
- 所有命令 metadata 至少包含 `id`、`baseSceneVersion` 和 `source`；命令对象不可变、可序列化。

**内部**：
- Object 模式下才允许选择对象、创建/删除对象、重命名、重挂载、修改对象可见性和对象变换。Edit 模式下这些命令必须返回 `object-mode-required`。
- 对象命令不携带 Three.js 对象、节点实例、数组索引、体素键集合或渲染资源；对象身份只使用稳定 `VoxObjectId`/`SceneNodeId`。
- `CreateVoxObjectCommand` 的体素坐标是对象局部坐标；对象世界位置由新节点的 `transform` 决定。创建和绑定必须原子完成。
- 对象变换只作用于绑定 `SceneNode` 的局部变换；不得改写对象内部体素键。交互拖动使用 Begin/Update/Apply，非交互一次性设置也必须经过同一校验规则。
- 进入 Edit 模式要求目标对象存在且有效可见；隐藏对象可以先在 Object 模式通过 outliner/属性面板显式显示，但第一版不得进入“可编辑但不可见”的状态。退出 Edit 模式时按显式规则处理活动对象的 Selection/XFORM，不能在命令中隐式提交未确认的预览。
- 命令不直接修改 SceneDocument、EditorState、Selection、History 或渲染器；状态效果和补丁由 Handler/Transaction 执行。

**依赖**：scene-types、voxel-types、util/math、util/result。
