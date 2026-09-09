# voxel-transform-command-handler.ts

**职责**：解释 Edit 模式下的体素选择和 Voxel XFORM 命令，校验活动对象，并生成对象局部补丁。

**接口**：
- `handleSelection(command, context) -> CommandOutcome`：解析五类体素选择策略，返回 VoxelSelection 状态变更描述，不生成体素 Patch。
- `handleTransform(command, context) -> CommandOutcome`：返回 VoxelTransformSession 状态变更描述和/或在 Apply/Delete 时生成的 `ScenePatch`。
- `resolveWorkingPick(token, context) -> TransformEntry`：把 working-pick 结果映射回当前会话 entry。

**内部**：
- 入口门禁：EditorState 必须处于 `edit`，`command.objectId` 必须等于 `activeObjectId` 且对象仍存在；否则返回 `edit-mode-required`、`active-object-mismatch` 或 `object-not-found`。
- 五类选择都只在活动对象的 `VoxelReadView` 上运行：Box 使用局部闭区间；Rectangle 的候选必须由活动对象投影产生并与 surfaceKeys 求交；Color 精确匹配；Island 使用活动对象的 6/26 连通；Visible 返回活动对象的可见体素。
- 使用对称规则时，`bounds` pivot 直接取活动对象局部包围盒中心；`world` pivot 必须通过绑定节点世界变换的逆矩阵解析到对象局部坐标。解析值在 session 开始时冻结，镜像/旋转/半区操作不得在拖动期间重新读取场景变换。
- 所有结果按活动对象局部 `VoxelKey` 去重、稳定排序，并写入 VoxelSelection；不得混入其他对象的键。
- Voxel XFORM 的 source、working position、冲突检测和 Patch 都在活动对象局部网格内；`candidatePosition(entry) = workingPosition + rootDelta`。
- `builder` 提交“移除源键 + 写目标键”；`clone` 保留源键；`new` 不删源。目标键按局部 `VoxelKey` 去重，session 外已有体素冲突采用目标覆盖并返回 `overwritten` 计数。
- 提交前校验 `baseSceneVersion`、活动对象身份和会话版本；成功后返回 `ScenePatch.applyObjectVoxelPatch`，不得直接调用 SceneDocument。
- Cancel、对象切换、退出 Edit、对象删除、场景替换、Worker 失败或版本冲突都保持场景和 working 状态的原状，不写 History、不部分提交。

**依赖**：voxel-transform-command、scene-types、scene-query、scene-patch、scene-document、editor-state、voxel-selection、voxel-transform-session、selection-strategies、symmetry、voxel-query、util/math、util/result。
