# voxel-transform-command.ts

**职责**：定义 Edit 模式下活动 `VoxObject` 内部五种体素选择入口、Voxel XFORM 会话控制和提交的纯数据命令。

**接口**：
- `SelectVoxelsCommand`：`{ objectId: VoxObjectId; strategy: SelectionStrategy; mode: "replace" | "add" | "subtract"; includeHidden: boolean; baseSceneVersion }`。strategy 为 Box、Rectangle、Color、Island 或 Visible。
- `BeginTransformCommand`：`{ objectId; sourceKind: "builder" | "clone" | "new"; source: { keys } | { strategy, input }; baseSceneVersion }`。`new` 只表示把生成/复制结果插入当前活动对象，不表示替换场景。
- `SetTransformSelectionModeCommand`、`MoveSelectionCommand`、`RotateSelectionCommand`、`MirrorSelectionCommand`、`ScaleSelectionCommand`、`DuplicateSelectionCommand`：均携带 `objectId` 和 `baseSceneVersion`，坐标/偏移均为活动对象局部网格的整数数据。
- `ApplyTransformCommand`、`CancelTransformCommand`、`DeleteTransformSelectionCommand`、`CommitTransformEntriesCommand`：只携带 `objectId`、`baseSceneVersion` 和可选 entry 子集。
- 所有命令 metadata 至少包含 `id`、`baseSceneVersion` 和 `source`；命令对象不可变、可序列化。

**内部**：
- `objectId` 必须等于 `EditorState.activeObjectId`。命令不得携带其他对象的体素键，也不得通过节点 ID 绕过活动对象约束。
- 选择命令不携带 `VoxelValue`、数组索引或渲染对象；只携带局部稳定键、颜色、种子、屏幕候选和只读策略输入。
- `workingPosition` 不是命令字段；提交坐标必须由 Handler 调用 VoxelTransformSession 的 `candidatePosition` 解析。
- Add/Subtract、rootDelta flush、entry 身份、镜像/旋转/缩放冲突和去重都由 Handler/Session 规则处理。
- `sourceKind = new` 只向活动对象插入体素；创建新对象、替换整个场景或导入项目必须走 SceneCommand。
- Apply 提交全部 entry；Cancel 不产生 Patch；Delete Selected 对 builder 删除源体素，对 clone/new 只丢弃未提交条目。
- 命令不保存 Patch、反向 Patch、Three.js 矩阵或函数；事务、历史、预览和渲染同步由 application/state 层处理。

**依赖**：scene-types、voxel-types、selection-strategies、symmetry、util/math、util/result。
