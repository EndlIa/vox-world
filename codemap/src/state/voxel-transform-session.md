# voxel-transform-session.ts

**职责**：拥有 Edit 模式中活动 `VoxObject` 内一次尚未提交的体素 XFORM 会话。

**接口**：
- `begin(objectId, sourceKind, entries, baseSceneVersion, options)`、`addEntries`、`removeEntries`、`setSelectionMode`、`contains`、`entryCount`。
- `setRootDelta`、`flushRootDelta`、`candidatePosition`、`applyEntryTransform`、`previewSnapshot`、`selectionSnapshot`、`snapshot`、`markCommitting`、`commit`、`cancel`、`deleteSelected`、`dispose`。

**内部**：
- 会话绑定唯一的 `objectId`。Scene/Voxel Command Handler 必须在 begin 和每次操作前保证它等于 `EditorState.activeObjectId`；session 本身不 import EditorState，也不读取其他 state 模块。
- `options` 中的 symmetry 必须已经由 Handler 解析为对象局部 pivot；session 不读取 SceneDocument 或世界矩阵，也不得把 world pivot 当作局部原点。
- `sourceKind` 为 `builder`、`clone` 或 `new`，语义限于活动对象内部：移动源体素、复制源体素或插入生成结果；创建/替换整个 `VoxObject` 属于 Scene 命令，不属于本会话。
- 每个 entry 保存 `id`、`sourceKey?`、`sourceKind`、`originalPosition`、`workingPosition`、`color`、`visible`。root 只承载未刷新的局部平移增量。
- 会话开始时捕获 `baseSceneVersion`。提交前由 Handler 校验 `SceneDocument.version`、对象仍存在且仍为活动对象；session 只拒绝自身绑定的 `objectId` 之外的 entry。
- 提交只返回 `ScenePatch.applyObjectVoxelPatch` 所需的局部数据；`builder` 移除源键并写目标，`clone` 保留源键，`new` 不关联源键。目标键按局部 `VoxelKey` 去重，冲突采用目标覆盖。
- Cancel、对象切换、退出 Edit、对象删除、场景替换或 context 重建均丢弃 working 状态，不产生 Patch。

**依赖**：scene-types、scene-patch、voxel-types、voxel-query、util/math、util/result。
