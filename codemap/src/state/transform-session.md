# transform-session.ts

**职责**：拥有一次尚未提交的 XFORM 会话、working entries、选择扩展模式和预览根节点状态。

**接口**：
- `begin(sourceKind, entries, baseVersion, options)`、`addEntries`、`removeEntries`、`setSelectionMode`、`contains`、`entryCount`。
- `setRootDelta(delta)`、`flushRootDelta()`、`candidatePosition(entry)`、`applyEntryTransform(kind, axis, pivot)`。
- `previewSnapshot()`、`selectionSnapshot()`、`snapshot()`、`markCommitting`、`commit(entries, final)`、`cancel`、`deleteSelected`、`dispose`。
- `phase: "idle" | "preview" | "committing" | "cancelled"`、`baseVersion`、`isActive`。

**内部**：
- `sourceKind` 为 `builder`、`clone` 或 `new`。`builder` 提交时移除源体素后写目标；`clone` 保留源体素；`new` 表示生成器或 NEW SCENE 放置，不与源体素合并。
- 每个 entry 至少保存 `id`、`sourceKey?`、`sourceKind`、`originalPosition`、`workingPosition`、`color`、`visible`。entry id 在一次 session 内单调递增；source 与 entry 映射不得使用数组索引作为身份。
- 会话开始时捕获 `baseVersion`。任何提交前都校验当前 `VoxelDocument.version === baseVersion`；不一致返回 `stale-version`，保留会话和预览，不生成 Patch、不写 History。
- root 只承载未刷新的平移增量。`candidatePosition(entry) = workingPosition + rootDelta`；所有拾取、投影、Box/Rect/Color/Island 选择和 working pick 映射必须调用该函数。直接读取 `workingPosition` 只允许在 flush/rebase 内部使用。
- 添加 entry 时按 `(sourceKind, candidatePosition)` 去重。Clone 额外以源位置和已有 working 位置去重；普通 builder 会话不得重复加入同一 source。Subtract 只允许移除当前 session 内的 entry，并必须先把 rootDelta flush 到 workingPosition。
- `new` 会话初始 selectionMode 固定为 `add`；不可 Subtract。`clone` 允许在可见 clone 源和 working entry 两侧继续 Add，但重复 candidate 必须过滤；隐藏的 moved-original source 不作为可拾取候选。
- 提交集合可以是全部 entry（Apply）或一个子集（Subtract 确认/分段提交）。提交前 flush；生成“移除源键 + 写入目标键”的原子 Patch 数据。目标键集合内先去重；与 session 外已有体素冲突时采用目标覆盖，并返回 `overwritten` 计数供一次性通知。
- `commit(entries, final)` 只负责状态转换和返回待提交描述，不直接写 `VoxelDocument`、History、渲染器或 UI。成功提交后若 `final` 或 session 为空则 `dispose`；失败则回到 `preview` 且 working entries 不变。
- Apply：提交全部 entry 并结束 session。Cancel：丢弃 working 状态、rootDelta、working pick 映射和预览，不产生 Patch。Delete Selected：builder 会话删除源体素并结束；clone/new 会话只删除未提交 entry，不删除原模型体素。
- `dispose` 必须清空 entry/source 映射、rootDelta、pick token、预览订阅和临时矩阵，并将 phase 置为 idle；可重复调用。
- 会话不序列化进项目。退出、刷新或上下文丢失前由 EditorSession 显式 Apply/Cancel；不得把 working entry 写入项目。

**依赖**：selection、voxel-types、util/math、util/result。
