# transform-command.ts

**职责**：定义五种选择入口、XFORM 会话控制和变换提交的纯数据命令。

**接口**：
- `SelectVoxelsCommand`：`{ strategy: SelectionStrategy; mode: "replace" | "add" | "subtract"; includeHidden: boolean; baseVersion }`。strategy 为 Box、Rectangle、Color、Island 或 Visible；Rectangle 另带屏幕候选和表面键，Island 另带种子和 6/26 连通性。
- `BeginTransformCommand`：`{ sourceKind: "builder" | "clone" | "new"; source: { keys } | { strategy, input }; placement: "existing" | "new-scene"; baseVersion }`。Clone 使用 `sourceKind = "clone"`；生成器未开启 NEW SCENE 时使用 `sourceKind = "new"`。
- `SetTransformSelectionModeCommand`：`{ mode: "add" | "subtract"; baseVersion }`。
- `MoveSelectionCommand`：`{ rootDelta: GridPosition; baseVersion }`。`rootDelta` 是尚未刷新的整数平移增量，不是屏幕坐标。
- `RotateSelectionCommand`：`{ axis: "x" | "y" | "z"; direction: "cw" | "ccw"; pivotMode: "bounds" | "world"; baseVersion }`。
- `MirrorSelectionCommand`：`{ axis: "x" | "y" | "z"; pivotMode: "bounds" | "world"; baseVersion }`；只修改 XFORM workingPosition，不写文档。
- `ScaleSelectionCommand`：`{ factors: GridPosition; pivotMode: "bounds" | "world"; baseVersion }`；因子为安全整数，负值和零按 XFORM 校验规则处理。
- `DuplicateSelectionCommand`：`{ sourceKeys: readonly VoxelKey[]; offset?: GridPosition; asClone: true; baseVersion }`；语义等价于以 `sourceKind = "clone"` 开始 XFORM。
- `ApplyTransformCommand`、`CancelTransformCommand`、`DeleteTransformSelectionCommand`、`CommitTransformEntriesCommand`：只携带 `baseVersion` 和可选的显式 entry id 子集。
- 所有命令 metadata 至少包含 `id`、`baseVersion` 和 `source`；命令对象不可变、可序列化。

**内部**：
- 选择命令不携带 `VoxelValue`、数组索引或渲染对象；只携带稳定键、颜色、种子、屏幕候选和只读策略输入。
- `workingPosition` 不是命令字段；命令不得把屏幕位置或 TransformSession entry 直接当作提交坐标。提交坐标必须由 Handler 调用 `candidatePosition(entry)` 解析。
- Add/Subtract 只描述选择意图；重复项过滤、working entry 身份、rootDelta flush 和 session 边界由 Handler/TransformSession 规则处理。
- 按颜色变换使用 `SelectVoxelsCommand(strategy = color)` 后接 `BeginTransformCommand(sourceKind = "builder")`；按颜色复制使用同一选择后接 `sourceKind = "clone"`。颜色组本身不建立额外实体，变换/复制源由选择命令的稳定键解析。
- Apply 表示提交全部 entry 并结束；Cancel 不产生 Patch；Delete Selected 对 builder 删除源体素，对 clone/new 只丢弃未提交条目。`CommitTransformEntriesCommand` 仅用于明确的子集提交，不作为普通 UI 快捷路径。
- Mirror/Rotate 作用于当前 XFORM session 的 working entries；没有活动 session 时由模型级对称命令处理。两者都必须先 flush rootDelta，并只改变 entry 位置。
- NEW SCENE 是 `BeginTransformCommand.placement` 的显式值：该模式不关联源体素，Apply 时把生成/复制结果写入模型；取消时不得修改原模型。
- 命令不直接保存 patch、反向 patch、Three.js 矩阵或函数；事务、历史、预览和渲染同步均由 application/state 层处理。

**依赖**：voxel-types、selection-strategies、symmetry、util/math。
