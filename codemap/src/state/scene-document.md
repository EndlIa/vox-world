# scene-document.ts

**职责**：当前项目场景的唯一可变事实来源。

**接口**：
- `getNode`、`getObject`、`objectIds`、`nodeIds`、`snapshot`、`objectSnapshot`、`voxelView`。
- `bounds`、`worldBounds`、`version`、`subscribe`、`applyPatch`、`clear`。

**内部**：
- 内部持有节点/对象索引、每个 `VoxObject` 的稀疏体素 `Map`、按需维护的局部 Octree 和场景版本号。
- `SceneDocument` 是场景结构、对象局部体素和对象/节点变换的唯一可变所有者；不再存在一个覆盖整个项目的单全局 `VoxelDocument`。
- `voxelView(objectId)` 返回绑定该对象局部网格的只读视图；视图不得泄漏内部 `Map`、数组或可变对象，也不能用于查询其他对象。
- `snapshot()` 返回完整 `SceneSnapshot` 普通数据；`objectSnapshot(objectId)` 返回单个对象局部快照，可直接传给 Worker。
- `applyPatch` 只接受已提交的 `ScenePatch`，先校验版本、场景不变量和对象引用，再原子应用；失败时不产生部分修改，也不递增版本。
- 节点变换、节点可见性、对象绑定和对象局部体素变更都通过 `ScenePatch` 进入文档。体素补丁必须带明确 `objectId` 语义，不能直接按全局键提交。
- `clear` 重置为空场景（根节点存在、零个 `VoxObject`）；可重复调用。
- 文档不解释命令、不记录 History、不修改 Selection/EditorState、不触发渲染或 UI。订阅者只收到场景版本和变更对象/节点 ID 的只读通知。

**依赖**：scene-types、scene-query、scene-patch、voxel-types、voxel-query、voxel-patch、util/octree、util/packed-int、util/result。
