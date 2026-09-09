# scene-types.ts

**职责**：定义场景、场景节点、体素对象、对象局部体素引用和对象变换的纯数据契约。

**接口**：
- `SceneNodeId`、`VoxObjectId`：稳定、不透明、非空字符串身份；不得由名称、数组索引或当前坐标推导。
- `SceneTransform`：`{ position: Vec3; rotation: Quat; scale: Vec3 }`，表示节点局部空间到父空间的变换。
- `SceneNodeSnapshot`：`{ id; parentId; childIds; name; transform; visible; objectId }`。
- `VoxObjectSnapshot`：`{ id; voxels: VoxelSnapshot }`。
- `SceneSnapshot`：`{ rootNodeId; nodes; objects }`。
- `ObjectVoxelRef`：`{ objectId: VoxObjectId; key: VoxelKey }`。
- `SceneValidationError`、`SceneTransformError`。

**内部**：
- `SceneSnapshot` 是场景的纯数据快照。`nodes` 和 `objects` 使用扁平只读数组，避免递归对象、父指针环和重复所有权；节点关系通过 `parentId`/`childIds` 表达。
- 场景必须有且只有一个根节点。根节点的 `parentId` 必须为 `null`，`objectId` 必须为 `null`；第一版根变换固定为单位变换，作为场景坐标系。
- 非根节点必须引用存在的父节点；每个节点最多出现在一个 `childIds` 中；`childIds` 内不得重复；父子关系必须双向一致；整张图不得有环。
- 每个节点最多绑定一个 `VoxObject`，且每个 `VoxObject` 必须由恰好一个节点绑定；`objectId` 非空时必须引用 `objects` 中存在的对象，不得存在未绑定或重复绑定的对象。
- 第一版中，绑定了 `VoxObject` 的节点是叶节点，`childIds` 必须为空。空组节点可以拥有子节点，用于未来层级组织。
- `VoxObjectSnapshot.voxels` 使用该对象自己的局部 `VoxelKey` 网格。`VoxelKey` 不在场景级唯一；跨对象引用必须使用 `ObjectVoxelRef`。
- `SceneTransform.position`、`rotation`、`scale` 必须是有限数值；旋转必须是有效单位四元数；`scale` 三分量不得为零。变换顺序为 `T * R * S`，局部空间到父空间。
- `SceneNodeSnapshot.visible` 只控制节点及其子树的渲染参与。最终有效可见性是自身及所有祖先 `visible` 的逻辑与；它不表示可编辑性，也不删除任何对象或体素。
- 快照只包含普通可序列化数据，可直接结构化克隆给 Worker 或持久化边界；禁止 Three.js、DOM、类实例、函数和可变集合。
- `nodes`、`objects` 和每个 `VoxelSnapshot` 输出必须稳定排序；节点身份和 `childIds` 顺序必须保留显式语义，不依赖对象枚举顺序。
- 可恢复的校验失败返回 `Result` 和具体错误码；不得静默丢弃节点、对象、父子关系或非法变换。

**依赖**：voxel-types、util/math、util/result。
